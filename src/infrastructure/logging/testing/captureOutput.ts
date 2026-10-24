import fs from 'node:fs'
import { inspect } from 'node:util'
import { vi } from 'vitest'

/**
 * What a test reads to learn what a real logger wrote, below the logger.
 *
 * The same net was cast four times, line for line: in `pinoLogger.test.ts` (twice), in
 * `container.test.ts` and in `src/interface/http/testing/captureOutput.ts`, whose comment said
 * "the same net `pinoLogger.test.ts`'s `anyOutputWhile` casts". It lived under `src/interface`,
 * so a test of an adapter could not import it (layering), hence the copies. It lives beside the
 * adapter whose output it reads now, and the HTTP canaries import it from here.
 *
 * Two nets, because they answer different questions:
 *
 * - {@link captureDescriptorOutputWhile}: what pino's `sonic-boom` writes to file descriptor 1
 *   (`fs.write`, `fs.writeSync`), which is where a production boot's JSON lines leave the process
 *   and what an operator's log shipper collects.
 * - {@link captureAllOutputWhile}: that, plus `process.stdout` and the `console` methods. A
 *   request runs *two* independent loggers (the app's and `accessLog`'s own `pino-http`
 *   instance), and a logger that fell back on `console.log` touches neither `fs.write` nor
 *   `process.stdout` under vitest, where `console` is routed to the reporter over RPC, so the
 *   narrow net would report it silent.
 *
 * Both return one string and are meant to be asserted against a sentinel, not against
 * emptiness: the runner writes on these channels too. The spies are an output capture, not a
 * substituted behaviour: the real pino does the real redaction and this only reads what it wrote.
 */

type Run = () => void | Promise<void>

const textOf = (chunk: unknown): string =>
  Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)

/** Replaces `fs.write` and `fs.writeSync` so a write to descriptor 1 is kept and goes nowhere. */
const interceptDescriptorWrites = (record: (text: string) => void): (() => void) => {
  const asyncWrite = vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
    const text = textOf(args[1])
    if (args[0] === 1) record(text)
    const callback = args[args.length - 1]
    if (typeof callback === 'function') {
      ;(callback as (error: Error | null, written: number) => void)(null, Buffer.byteLength(text))
    }
  }) as unknown as typeof fs.write)
  const syncWrite = vi.spyOn(fs, 'writeSync').mockImplementation(((...args: unknown[]) => {
    const text = textOf(args[1])
    if (args[0] === 1) record(text)
    return Buffer.byteLength(text)
  }) as unknown as typeof fs.writeSync)
  return () => {
    asyncWrite.mockRestore()
    syncWrite.mockRestore()
  }
}

/** sonic-boom (and pino-http's own instance) batch the current tick and flush on the next one. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export const captureDescriptorOutputWhile = async (run: Run): Promise<string> => {
  const written: string[] = []
  const restore = interceptDescriptorWrites((text) => written.push(text))
  try {
    await run()
    await flush()
  } finally {
    restore()
  }
  return written.join('')
}

export const captureAllOutputWhile = async (run: Run): Promise<string> => {
  const written: string[] = []
  const restoreDescriptors = interceptDescriptorWrites((text) => written.push(text))
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    written.push(textOf(chunk))
    return true
  }) as unknown as typeof process.stdout.write)
  const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((argument) => inspect(argument)).join(' '))
    }),
  )
  try {
    await run()
    await flush()
  } finally {
    restoreDescriptors()
    stdoutWrite.mockRestore()
    for (const spy of consoleSpies) spy.mockRestore()
  }
  return written.join('')
}
