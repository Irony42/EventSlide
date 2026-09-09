import pino from 'pino'
import type { LogContext, Logger } from '../../application/ports/logger'

/**
 * Structured JSON logging.
 *
 * 1.0 used `console.log` with interpolated strings, so there was nothing to correlate a
 * failed upload with and nothing a log shipper could index. Here every line is an
 * object, and a per-request child logger carries `requestId` and `eventId` so a whole
 * upload can be followed through the pipeline.
 */

export interface PinoLoggerOptions {
  readonly level: pino.Level
  readonly pretty: boolean
}

/**
 * Fields redacted wherever they appear in a context object.
 *
 * The list is the reason this adapter exists rather than passing `pino` around: a
 * caption is guest-authored personal content, a device token is a bearer credential,
 * and a full IP address is personal data that a photo wall has no reason to keep. See
 * docs/SECURITY.md.
 */
const REDACTED = [
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
]

export const createPinoLogger = ({ level, pretty }: PinoLoggerOptions): Logger => {
  const root = pino({
    level,
    redact: {
      paths: [...REDACTED, ...REDACTED.map((field) => `*.${field}`)],
      censor: '[redacted]',
    },
    // Seconds-precision ISO, matching the timestamps stored in the database, so a log
    // line and a row can be lined up by eye.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  })

  const wrap = (instance: pino.Logger): Logger => ({
    // pino takes (mergingObject, message); the port takes (message, context), which
    // reads better at the call site and keeps the message first in the log line.
    debug: (message: string, context?: LogContext) => instance.debug(context ?? {}, message),
    info: (message: string, context?: LogContext) => instance.info(context ?? {}, message),
    warn: (message: string, context?: LogContext) => instance.warn(context ?? {}, message),
    error: (message: string, context?: LogContext) => instance.error(context ?? {}, message),
    child: (bindings: LogContext) => wrap(instance.child(bindings)),
  })

  return wrap(root)
}

/** For tests and for the odd script that wants the port without any output. */
export const silentLogger = (): Logger => {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  }
  return logger
}
