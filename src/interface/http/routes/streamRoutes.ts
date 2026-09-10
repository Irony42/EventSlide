import { Router, type Response } from 'express'
import type { DomainEvent } from '../../../application/ports/eventBus'
import type { Logger } from '../../../application/ports/logger'
import type { EventId } from '../../../domain/shared/ids'
import { requireRole, resolvePublicEvent } from '../middleware/authz'
import type { HttpDeps } from '../types'

/**
 * Server-sent events, one channel per event.
 *
 * Every rule below is load-bearing, and 1.0 broke most of them:
 *
 * - **Per-event channels.** The bus filters by event id before a listener is called.
 *   1.0 had a single global `EventEmitter` and each connection compared party names
 *   *inside* its own callback, with a fallback to the string `'myParty'` — so every
 *   projector received every event's activity and was trusted to ignore what was not
 *   its own.
 * - **`flushHeaders()` immediately**, plus `X-Accel-Buffering: no`. Without them nginx
 *   buffers the response and the wall looks frozen while photos are in fact arriving.
 * - **A heartbeat comment frame.** Proxies and mobile networks close an idle
 *   connection after 30–60 seconds. 1.0 sent nothing between events, so a quiet spell
 *   silently ended the stream and the wall stopped updating for the rest of the night
 *   with no visible failure.
 * - **An `id:` on every frame, and `Last-Event-ID` honoured.** A projector whose
 *   connection drops for thirty seconds must not miss the photos published while it
 *   was away.
 * - **The payload is an invalidation signal, not the data.** The client refetches.
 *   Pushing rows would mean two divergent code paths for the same state, and an
 *   authorization decision on the push side where there is no request to authorize
 *   against.
 */

/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_MS = 15_000

/**
 * How many recent signals to keep per event for `Last-Event-ID` replay.
 *
 * Small on purpose: a signal carries no data, so replaying "something changed" a few
 * extra times is harmless and the client refetches once. The buffer closes the gap
 * during a reconnect; it is not a durable log.
 *
 * Note what that implies: the log is appended when a signal is **delivered**, so
 * nothing is recorded for an event with no connected client. A projector that
 * disconnects while it is the only client therefore gets no replay when it comes back.
 * That is deliberate and harmless — the client refetches the wall on every (re)connect,
 * so replay is an optimisation that saves a redundant fetch during a brief drop, never
 * the mechanism by which state stays correct. Appending regardless of subscribers
 * would mean holding a buffer for every event the process has ever seen, for no gain.
 */
const REPLAY_BUFFER = 64

interface Signal {
  readonly id: number
  readonly type: DomainEvent['type']
}

/** A per-event ring buffer, so a reconnecting client can replay what it missed. */
class SignalLog {
  private nextId = 1
  private readonly entries: Signal[] = []

  append(type: DomainEvent['type']): Signal {
    const signal: Signal = { id: this.nextId, type }
    this.nextId += 1
    this.entries.push(signal)
    if (this.entries.length > REPLAY_BUFFER) this.entries.shift()
    return signal
  }

  since(lastId: number): readonly Signal[] {
    return this.entries.filter((entry) => entry.id > lastId)
  }
}

/**
 * Keyed by event id and held for the process lifetime.
 *
 * Bounded by the number of events a single deployment serves, and each entry is at
 * most {@link REPLAY_BUFFER} small objects — so this is not the unbounded growth an
 * eight-hour run has to worry about.
 */
const logs = new Map<EventId, SignalLog>()

const logFor = (eventId: EventId): SignalLog => {
  const existing = logs.get(eventId)
  if (existing) return existing
  const created = new SignalLog()
  logs.set(eventId, created)
  return created
}

/** Test-only: start from a known state. The server never calls this. */
export const resetSignalLogs = (): void => {
  logs.clear()
}

const writeSignal = (res: Response, signal: Signal): void => {
  res.write(`id: ${signal.id}\nevent: change\ndata: ${JSON.stringify({ type: signal.type })}\n\n`)
}

const parseLastEventId = (raw: string | undefined): number => {
  if (raw === undefined) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export interface StreamOptions {
  readonly deps: HttpDeps
  readonly logger: Logger
  readonly eventId: EventId
  readonly lastEventId: string | undefined
  readonly res: Response
}

/**
 * Opens the stream. Exported so a test can drive it without a route, and so both the
 * public wall channel and the moderator channel share exactly one implementation —
 * the authorization difference is decided by the middleware in front, never here.
 */
export const openStream = ({
  deps,
  logger,
  eventId,
  lastEventId,
  res,
}: StreamOptions): (() => void) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  // Send the headers now rather than with the first frame: a client waits for them
  // before reporting the connection open, and the first photo may be minutes away.
  res.flushHeaders()

  const log = logFor(eventId)

  for (const missed of log.since(parseLastEventId(lastEventId))) writeSignal(res, missed)

  // A comment frame straight away, so a client behind a buffering proxy learns
  // immediately that bytes flow.
  res.write(`: connected\n\n`)

  let closed = false

  const unsubscribe = deps.bus.subscribe(eventId, (domainEvent) => {
    if (closed || res.writableEnded) return
    writeSignal(res, log.append(domainEvent.type))
  })

  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) return
    // A comment frame: no event name, no data, invisible to the client's handlers, but
    // enough traffic to stop a proxy closing an idle connection.
    res.write(`: keep-alive\n\n`)
  }, HEARTBEAT_MS)

  // Must not hold the process open during a graceful shutdown.
  heartbeat.unref()

  const cleanup = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
  }

  res.on('close', cleanup)
  res.on('error', (error: unknown) => {
    logger.debug('stream closed with an error', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    })
    cleanup()
  })

  return cleanup
}

export const streamRoutes = (deps: HttpDeps): Router => {
  const router = Router()

  /** The wall's channel. Public, for an event that serves its wall. */
  router.get('/events/:eventSlug/stream', resolvePublicEvent(deps), (req, res) => {
    const event = req.context.event
    if (!event) {
      // `resolvePublicEvent` always populates it; this keeps the type honest without a
      // non-null assertion.
      res.status(404).end()
      return
    }
    openStream({
      deps,
      logger: req.context.logger,
      eventId: event.id,
      lastEventId: req.get('last-event-id'),
      res,
    })
  })

  /** The moderation console's channel. Same frames, moderator authorization. */
  router.get('/events/:eventSlug/moderation/stream', requireRole('moderator', deps), (req, res) => {
    const event = req.context.event
    if (!event) {
      res.status(404).end()
      return
    }
    openStream({
      deps,
      logger: req.context.logger,
      eventId: event.id,
      lastEventId: req.get('last-event-id'),
      res,
    })
  })

  return router
}
