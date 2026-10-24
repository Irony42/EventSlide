import type { LogContext, Logger } from '../ports/logger'

/**
 * A `Logger` that keeps what it was told, for a test that asserts on a log line.
 *
 * Twenty-seven test files declared their own, in two shapes (a class here, a closure there)
 * with the same three fields, because `src/application/testing/` held no logger. This is the
 * shared one. What is left on it is under `src/interface/http` and the `auth` and `clients` use
 * cases, and the production `silentLogger` that `pinoLogger.ts` still exports for two harnesses. A line is the level, the message and the context the caller passed, and nothing is
 * redacted or reformatted: the production adapter's redaction is `pinoLogger`'s to test, and
 * a double that cleaned a line up would hide exactly what a test looks for.
 *
 * `child` returns the same logger, so a line logged through a child lands in `lines` like
 * every other. Bindings are not recorded: nothing under test asserts on them, and the
 * per-request bindings are the adapter's.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggedLine {
  readonly level: LogLevel
  readonly message: string
  readonly context: LogContext | undefined
}

export class CapturingLogger implements Logger {
  readonly lines: LoggedLine[] = []

  debug(message: string, context?: LogContext): void {
    this.lines.push({ level: 'debug', message, context })
  }

  info(message: string, context?: LogContext): void {
    this.lines.push({ level: 'info', message, context })
  }

  warn(message: string, context?: LogContext): void {
    this.lines.push({ level: 'warn', message, context })
  }

  error(message: string, context?: LogContext): void {
    this.lines.push({ level: 'error', message, context })
  }

  child(_bindings: LogContext): Logger {
    return this
  }

  /** The messages logged at `level`, in order. */
  messages(level: LogLevel): string[] {
    return this.lines.filter((line) => line.level === level).map((line) => line.message)
  }

  /** The line logged with `message`, for a test that asserts on its context. */
  find(message: string): LoggedLine | undefined {
    return this.lines.find((line) => line.message === message)
  }
}

/** A logger that says nothing, for a test that does not care what is logged. */
export const silentLogger = (): Logger => {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  }
  return logger
}
