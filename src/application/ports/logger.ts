/**
 * Structured logging.
 *
 * 1.0 used `console.log` with interpolated strings, so there was no request id to
 * correlate on and nothing machine-readable. Here a log line is a message plus a
 * context object.
 *
 * **What must never be logged**, whatever the level: photo bytes, session ids, guest
 * device tokens, password hashes, a full client IP at default level, or a caption (it
 * is guest-authored personal content). See docs/SECURITY.md.
 */

export type LogContext = Readonly<Record<string, unknown>>

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void

  /**
   * A logger that carries the given bindings on every line. Used per request
   * (`requestId`, `eventId`) so a whole upload can be followed through the pipeline.
   */
  child(bindings: LogContext): Logger
}
