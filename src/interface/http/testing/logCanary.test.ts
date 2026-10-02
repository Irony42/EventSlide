import fs from 'node:fs'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { buildServerHarness } from './serverHarness'
import { CANARY, CANARY_VALUES, fireLogCanarySweep } from './logCanary'

/**
 * Every byte that could leave the process on any channel a logger might use, while
 * `run` executes — the same net `pinoLogger.test.ts`'s `anyOutputWhile` casts, because
 * the sweep below runs *two* independent loggers (the app logger and `accessLog`'s own
 * `pino-http` instance), both writing through `sonic-boom` straight to file descriptor
 * 1, below `process.stdout.write`.
 */
const captureAllOutputWhile = async (run: () => Promise<void>): Promise<string> => {
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

const INSTANCE_BINDINGS = {
  service: 'eventslide',
  version: 'sweep-test',
  instance: 'sweep-instance',
}

describe('the log canary sweep', () => {
  it('finds none of the canaries anywhere in the log, across every mounted route', async () => {
    // A real logger and a real, *enabled* access log — the point of this test is what a
    // production box actually writes, not what a silenced test harness would.
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE_BINDINGS })
    const harness = buildServerHarness({
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE_BINDINGS } },
    })

    let requestCount = 0
    const output = await captureAllOutputWhile(async () => {
      const result = await fireLogCanarySweep(harness.app)
      requestCount = result.requestCount
    })

    // A sweep of zero routes would pass this suite vacuously. The real server mounts
    // several dozen; this just rules out "the walk found nothing".
    expect(requestCount).toBeGreaterThan(20)

    for (const value of CANARY_VALUES) {
      expect(output).not.toContain(value)
    }
  })

  it('actually wrote something, so "no canary found" is not "nothing was captured"', async () => {
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE_BINDINGS })
    const harness = buildServerHarness({
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE_BINDINGS } },
    })

    const output = await captureAllOutputWhile(async () => {
      await fireLogCanarySweep(harness.app)
    })

    expect(output.length).toBeGreaterThan(0)
    expect(output).toContain(INSTANCE_BINDINGS.instance)
  })

  it('still finds the canary clean with the access log disabled, which is the default test posture', async () => {
    // Belt and braces: the default harness (`accessLog: { enabled: false }`, silent
    // logger) is used by every other HTTP test in this repository, so it had better be
    // canary-clean too — trivially, since it writes nothing at all.
    const harness = buildServerHarness()

    const output = await captureAllOutputWhile(async () => {
      await fireLogCanarySweep(harness.app)
    })

    expect(output).toBe('')
  })
})

describe('CANARY', () => {
  it('is a distinctive value per field, so a match in the log can be attributed', () => {
    const values = Object.values(CANARY)
    expect(new Set(values).size).toBe(values.length)
  })
})
