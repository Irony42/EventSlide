import fs from 'node:fs'
import { inspect } from 'node:util'
import { vi } from 'vitest'

/**
 * Every byte that could leave the process on any channel a logger might use, while `run`
 * executes — the same net `pinoLogger.test.ts`'s `anyOutputWhile` casts, because a request
 * runs *two* independent loggers (the app logger and `accessLog`'s own `pino-http`
 * instance), both writing through `sonic-boom` straight to file descriptor 1, below
 * `process.stdout.write`.
 *
 * Shared by the two tests that ask what a real logger writes: the sweep over every mounted
 * route (`logCanary.test.ts`) and the one that follows a password reset from request to
 * confirmation (`passwordResetLogCanary.test.ts`).
 */
export const captureAllOutputWhile = async (run: () => Promise<void>): Promise<string> => {
  const written: string[] = []
  const record = (chunk: unknown): void => {
    written.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
  }
  const asyncWrite = vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
    if (args[0] === 1) record(args[1])
    const callback = args[args.length - 1]
    const size = Buffer.isBuffer(args[1]) ? args[1].length : Buffer.byteLength(String(args[1]))
    if (typeof callback === 'function')
      (callback as (e: Error | null, n: number) => void)(null, size)
  }) as unknown as typeof fs.write)
  const syncWrite = vi.spyOn(fs, 'writeSync').mockImplementation(((...args: unknown[]) => {
    if (args[0] === 1) record(args[1])
    return Buffer.isBuffer(args[1]) ? args[1].length : Buffer.byteLength(String(args[1]))
  }) as unknown as typeof fs.writeSync)
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    record(chunk)
    return true
  }) as unknown as typeof process.stdout.write)
  const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((argument) => inspect(argument)).join(' '))
    }),
  )
  try {
    await run()
    // pino's sonic-boom (and pino-http's own instance) batch the current tick and flush
    // on the next one.
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    asyncWrite.mockRestore()
    syncWrite.mockRestore()
    stdoutWrite.mockRestore()
    for (const spy of consoleSpies) spy.mockRestore()
  }
  return written.join('')
}
