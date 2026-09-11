import { EventEmitter } from 'node:events'
import type { Response } from 'express'

/**
 * An in-memory stand-in for the small part of `Response` that an SSE stream writes to.
 *
 * `streamRoutes.test.ts` drives the real routes over a real socket, which is the honest
 * way to assert what a projector receives. What a socket cannot do is arrive at a
 * particular moment: a heartbeat fires on a fifteen-second interval, and the guards that
 * refuse to write to a response whose socket has already gone exist for a race a test
 * cannot schedule. This sink makes both deterministic — the interval under
 * `vi.useFakeTimers()`, and "the socket is gone" as a property a test sets.
 *
 * It is a fake, not a mock: it records what was written and behaves like the real thing
 * for those five members. Nothing here asserts that a method was called.
 */
export class SseSink extends EventEmitter {
  readonly frames: string[] = []
  status = 0
  sentHeaders: Readonly<Record<string, string>> = {}
  headersFlushed = false
  writableEnded = false

  writeHead(status: number, headers: Readonly<Record<string, string>>): this {
    this.status = status
    this.sentHeaders = headers
    return this
  }

  flushHeaders(): void {
    this.headersFlushed = true
  }

  write(chunk: string): boolean {
    this.frames.push(chunk)
    return true
  }

  /** Everything written so far, as the client would have read it. */
  get text(): string {
    return this.frames.join('')
  }

  /** What a socket that has gone away looks like from inside a handler. */
  endWriting(): void {
    this.writableEnded = true
  }
}

/**
 * The one cast in this file, and the reason it is confined here.
 *
 * `Response` is a large Express interface; {@link SseSink} implements the members
 * `openStream` actually uses. Narrowed through `unknown` rather than `any`, so nothing
 * downstream loses its types — a test still holds an `SseSink` and reads `frames` off it
 * with full checking.
 */
export const asResponse = (sink: SseSink): Response => sink as unknown as Response
