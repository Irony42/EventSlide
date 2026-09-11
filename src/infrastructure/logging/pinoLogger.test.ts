import fs from 'node:fs'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createPinoLogger, silentLogger } from './pinoLogger'
import type { Logger } from '../../application/ports/logger'

/**
 * Ring 3, against real pino.
 *
 * Redaction is the reason this adapter exists rather than passing `pino` around, so it
 * is asserted on the bytes that would leave the process — not on the arguments the
 * adapter was called with. pino writes through `sonic-boom` straight to file
 * descriptor 1, which is below `process.stdout.write`, so the only place to observe
 * the serialised line is `fs.write`/`fs.writeSync`. That spy is an output capture, not
 * a substituted behaviour: the real pino does the real redaction, and this only reads
 * what it produced.
 */

/** A value distinctive enough that finding it anywhere in the output is conclusive. */
const SENTINEL = 'SENTINEL-4f9a1c-must-never-be-logged'

const captureStdout = async (emit: () => void): Promise<string[]> => {
  const written: string[] = []
  const record = (...args: unknown[]): number => {
    const text = Buffer.isBuffer(args[1]) ? args[1].toString('utf8') : String(args[1])
    if (args[0] === 1) written.push(text)
    return Buffer.byteLength(text)
  }
  const asyncWrite = vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
    const size = record(...args)
    const callback = args[args.length - 1]
    if (typeof callback === 'function') {
      ;(callback as (error: Error | null, written: number) => void)(null, size)
    }
  }) as unknown as typeof fs.write)
  const syncWrite = vi
    .spyOn(fs, 'writeSync')
    .mockImplementation(((...args: unknown[]) => record(...args)) as unknown as typeof fs.writeSync)
  try {
    emit()
    // sonic-boom batches the current tick and flushes on the next one.
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    asyncWrite.mockRestore()
    syncWrite.mockRestore()
  }
  return written.join('').split('\n').filter(Boolean)
}

/**
 * Everything printed by any route a logger could take: pino's own `sonic-boom` path
 * (`fs.write`/`fs.writeSync` on fd 1), `process.stdout`, and the `console` methods —
 * which under vitest are routed to the reporter over RPC rather than through
 * `process.stdout`, so they have to be captured in their own right.
 *
 * `silentLogger` needs the wider net. Its promise is that nothing is printed at all,
 * and a version of it left calling `console.log` touches neither `fs.write` nor
 * `process.stdout` in a worker, so the narrower capture above would report it silent.
 * Returned as one string and asserted against a sentinel rather than against
 * emptiness, because the runner writes on these channels too.
 */
const anyOutputWhile = async (emit: () => void): Promise<string> => {
  const written: string[] = []
  const asyncWrite = vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
    const text = Buffer.isBuffer(args[1]) ? args[1].toString('utf8') : String(args[1])
    if (args[0] === 1) written.push(text)
    const callback = args[args.length - 1]
    if (typeof callback === 'function') {
      ;(callback as (error: Error | null, written: number) => void)(null, Buffer.byteLength(text))
    }
  }) as unknown as typeof fs.write)
  const syncWrite = vi.spyOn(fs, 'writeSync').mockImplementation(((...args: unknown[]) => {
    const text = Buffer.isBuffer(args[1]) ? args[1].toString('utf8') : String(args[1])
    if (args[0] === 1) written.push(text)
    return Buffer.byteLength(text)
  }) as unknown as typeof fs.writeSync)
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    written.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
    return true
  }) as unknown as typeof process.stdout.write)
  const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((argument) => inspect(argument)).join(' '))
    }),
  )
  try {
    emit()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    asyncWrite.mockRestore()
    syncWrite.mockRestore()
    stdoutWrite.mockRestore()
    for (const spy of consoleSpies) spy.mockRestore()
  }
  return written.join('')
}

const oneLineFrom = async (logger: Logger, emit: (subject: Logger) => void): Promise<string> => {
  const lines = await captureStdout(() => emit(logger))
  expect(lines).toHaveLength(1)
  return lines[0] ?? ''
}

const parsed = (line: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null) throw new Error(`not a JSON object: ${line}`)
  return value as Record<string, unknown>
}

const aLogger = (level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): Logger =>
  createPinoLogger({ level, pretty: false })

describe('createPinoLogger', () => {
  describe('redaction', () => {
    it.each([
      'password',
      'newPassword',
      'passwordHash',
      'token',
      'guestToken',
      'sessionId',
      'sid',
      'cookie',
      'authorization',
      'caption',
      'secret',
      'sessionSecret',
      'guestTokenSecret',
      'ip',
      'remoteAddress',
    ])('never writes the value of %s to the log stream', async (field) => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.info('upload rejected', { [field]: SENTINEL }),
      )

      expect(line).not.toContain(SENTINEL)
    })

    it('replaces a redacted value with a marker, so the operator can see the field was present', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.info('login failed', { password: SENTINEL }),
      )

      expect(parsed(line)['password']).toBe('[redacted]')
    })

    it('redacts a secret nested one level down, which is how a request context arrives', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.warn('guest refused', { request: { guestToken: SENTINEL } }),
      )

      expect(line).not.toContain(SENTINEL)
    })

    it('redacts a session id carried in a child logger binding, not only one passed per call', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.child({ sessionId: SENTINEL }).info('session regenerated'),
      )

      expect(line).not.toContain(SENTINEL)
    })

    it('leaves a field that is not on the redaction list alone, so a log line is still worth reading', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.info('photo stored', { eventId: 'mariage', photoId: 'p1' }),
      )

      expect(parsed(line)).toMatchObject({ eventId: 'mariage', photoId: 'p1' })
    })
  })

  describe('the level comes from configuration', () => {
    it.each(['debug', 'info'] as const)(
      'writes nothing for a %s line when the configured level is warn',
      async (method) => {
        const lines = await captureStdout(() => aLogger('warn')[method]('suppressed'))

        expect(lines).toEqual([])
      },
    )

    it.each(['warn', 'error'] as const)(
      'writes a %s line when the configured level is warn',
      async (method) => {
        const line = await oneLineFrom(aLogger('warn'), (logger) => logger[method]('kept'))

        expect(parsed(line)['msg']).toBe('kept')
      },
    )

    it.each(['debug', 'info', 'warn', 'error'] as const)(
      'labels a %s line with its level name rather than pino numeric code, so a shipper needs no mapping',
      async (method) => {
        const line = await oneLineFrom(aLogger(), (logger) => logger[method]('a line'))

        expect(parsed(line)['level']).toBe(method)
      },
    )
  })

  describe('the levels LOG_LEVEL offers', () => {
    it('writes a debug line at level trace, the lowest LOG_LEVEL accepts', async () => {
      // `fatal` and `trace` are in the LOG_LEVEL enum but have no port method, so they
      // only ever reach pino through this constructor. pino throws on a level it does
      // not know, which would turn a valid LOG_LEVEL into a crash at boot.
      const line = await oneLineFrom(
        createPinoLogger({ level: 'trace', pretty: false }),
        (logger) => logger.debug('a line'),
      )

      expect(parsed(line)['msg']).toBe('a line')
    })

    it('suppresses even an error line at level fatal, so an operator asking for near-silence gets it', async () => {
      const lines = await captureStdout(() =>
        createPinoLogger({ level: 'fatal', pretty: false }).error('suppressed'),
      )

      expect(lines).toEqual([])
    })
  })

  describe('the port shape', () => {
    it('puts the message under msg and the context alongside it, reversing pino argument order', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.info('photo published', { photoId: 'p1' }),
      )

      expect(parsed(line)).toMatchObject({ msg: 'photo published', photoId: 'p1' })
    })

    it('accepts a message with no context at all', async () => {
      const line = await oneLineFrom(aLogger(), (logger) => logger.debug('server ready'))

      expect(parsed(line)['msg']).toBe('server ready')
    })

    it('carries a child logger binding on every line, so one upload can be followed by requestId', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.child({ requestId: 'req-1' }).error('render failed'),
      )

      expect(parsed(line)).toMatchObject({ requestId: 'req-1', msg: 'render failed' })
    })

    it('merges the bindings of a child of a child, so a per-event logger keeps its request id', async () => {
      const line = await oneLineFrom(aLogger(), (logger) =>
        logger.child({ requestId: 'req-1' }).child({ eventId: 'mariage' }).info('ingest started'),
      )

      expect(parsed(line)).toMatchObject({ requestId: 'req-1', eventId: 'mariage' })
    })

    it('leaves the parent logger unbound when a child adds bindings', async () => {
      const logger = aLogger()
      logger.child({ requestId: 'req-1' })

      const line = await oneLineFrom(logger, (subject) => subject.info('unrelated'))

      expect(parsed(line)['requestId']).toBeUndefined()
    })

    it('timestamps every line in the same ISO form the database stores, not pino epoch milliseconds', async () => {
      const line = await oneLineFrom(aLogger(), (logger) => logger.info('a line'))

      // `rowMapping.toIsoText` is `Date.prototype.toISOString`, so millisecond
      // precision is what makes a log line and a row comparable by eye.
      expect(parsed(line)['time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('pretty rendering', () => {
    it('sends development output through the pino-pretty transport instead of writing JSON to stdout itself', async () => {
      const pretty = createPinoLogger({ level: 'info', pretty: true })

      const lines = await captureStdout(() => pretty.info('a line for a human'))

      // The transport runs in a worker thread with its own descriptor, so nothing that
      // this process writes to fd 1 is the raw JSON line — which is what distinguishes
      // the development logger from the production one.
      expect(lines).toEqual([])
    })
  })
})

describe('silentLogger', () => {
  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'prints no trace of a %s line through any stdout channel, so a test harness produces no output',
    async (method) => {
      const output = await anyOutputWhile(() => silentLogger()[method](SENTINEL, { a: SENTINEL }))

      expect(output).not.toContain(SENTINEL)
    },
  )

  it('returns a child that is silent too, so a request-scoped logger in a test cannot start printing', async () => {
    const output = await anyOutputWhile(() =>
      silentLogger().child({ requestId: SENTINEL }).error(SENTINEL),
    )

    expect(output).not.toContain(SENTINEL)
  })
})
