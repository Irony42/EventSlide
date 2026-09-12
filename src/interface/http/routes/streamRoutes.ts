import { Router, type RequestHandler, type Response } from 'express'
import type { DomainEvent, Unsubscribe } from '../../../application/ports/eventBus'
import type { Logger } from '../../../application/ports/logger'
import type { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventId } from '../../../domain/shared/ids'
import { requireRole, resolvePublicEvent } from '../middleware/authz'
import { streamConnectionLimiter } from '../middleware/rateLimit'
import { errorBody } from '../presenters/send'
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
 *   was away. The id is the bus's delivery sequence, so every client watching one event
 *   sees the *same* number for the same fact — it was minted inside each subscriber's
 *   callback, which gave N clients N id spaces and quietly divided the replay window by
 *   the number of connected screens.
 * - **A refusal is a refusal.** Past the bus's per-event subscriber cap the connection
 *   is answered `503` before a single header is written. Answering `200` and then
 *   nothing is the failure this channel cannot have: the wall keeps saying "connected"
 *   and stops updating for the rest of the evening.
 * - **The payload is an invalidation signal, not the data.** The client refetches.
 *   Pushing rows would mean two divergent code paths for the same state, and an
 *   authorization decision on the push side where there is no request to authorize
 *   against.
 */

/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_MS = 15_000

/**
 * The heartbeat's visible half.
 *
 * A comment frame reaches no client handler at all, which is what makes it safe for
 * keeping a proxy awake — and also means a client cannot tell a quiet wedding from a
 * proxy that has stopped forwarding. So the heartbeat carries a named frame as well: no
 * `id:`, so it never moves a client's `Last-Event-ID` cursor, and no consumer listens
 * to it except the watchdog in `web/src/lib/realtime/useEventStream.ts`, which closes
 * and reconnects a stream that has gone silent.
 */
const HEARTBEAT_EVENT = 'ping'

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

/**
 * A per-event ring buffer, so a reconnecting client can replay what it missed.
 *
 * One entry per **delivered fact**, not per client that saw it. The id is the bus's
 * delivery sequence rather than a counter of this log's own: every connection watching
 * an event records the same fact under the same id, so the first to arrive creates the
 * entry and the rest are handed it back. Numbering here — once per subscriber callback —
 * is what gave six connected screens six private id spaces and a replay window of ten
 * signals instead of sixty-four.
 */
class SignalLog {
  private readonly entries: Signal[] = []

  record(sequence: number, type: DomainEvent['type']): Signal {
    // The bus delivers one announcement to every subscriber synchronously, so the entry
    // a sibling connection just created is necessarily the last one.
    const last = this.entries[this.entries.length - 1]
    if (last !== undefined && last.id === sequence) return last

    const signal: Signal = { id: sequence, type }
    this.entries.push(signal)
    if (this.entries.length > REPLAY_BUFFER) this.entries.shift()
    return signal
  }

  since(lastId: number): readonly Signal[] {
    return this.entries.filter((entry) => entry.id > lastId)
  }
}

/**
 * One event's replay log, and how many connections are holding it open.
 *
 * The count is what bounds the map: an event that is being watched has an entry, and an
 * event nobody is watching has none. The log used to be keyed by event id and kept for
 * the process lifetime, so a purged event left its buffer behind for good — small, but
 * unbounded in the only dimension that matters, and mutable state with no owner.
 */
interface Channel {
  readonly log: SignalLog
  connections: number
}

const channels = new Map<EventId, Channel>()

const acquireChannel = (eventId: EventId): Channel => {
  const existing = channels.get(eventId)
  if (existing !== undefined) {
    existing.connections += 1
    return existing
  }
  const created: Channel = { log: new SignalLog(), connections: 1 }
  channels.set(eventId, created)
  return created
}

const releaseChannel = (eventId: EventId): void => {
  const channel = channels.get(eventId)
  if (channel === undefined) return
  channel.connections -= 1
  if (channel.connections <= 0) channels.delete(eventId)
}

/** Test-only: start from a known state. The server never calls this. */
export const resetSignalLogs = (): void => {
  channels.clear()
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
 *
 * Returns the teardown on success, and the reason on failure — **having written
 * nothing at all** in that case, so the caller can still choose a status. The order of
 * the first two statements is the whole point: subscribe, then write the headers. Once
 * `200` and `text/event-stream` have gone out there is no way left to say no, and the
 * client will sit on a connection that can never carry a frame.
 */
export const openStream = ({
  deps,
  logger,
  eventId,
  lastEventId,
  res,
}: StreamOptions): Result<Unsubscribe, DomainError> => {
  let closed = false
  const channel = acquireChannel(eventId)

  const subscription = deps.bus.subscribe(eventId, (domainEvent, delivery) => {
    if (closed || res.writableEnded) return
    writeSignal(res, channel.log.record(delivery.sequence, domainEvent.type))
  })

  if (!subscription.ok) {
    releaseChannel(eventId)
    logger.warn('stream refused, the event is at its subscriber limit', { eventId })
    return err(subscription.error)
  }

  // Nothing can have been written above: the bus delivers synchronously and there is no
  // await between subscribing and this line, so no publish can interleave.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  // Send the headers now rather than with the first frame: a client waits for them
  // before reporting the connection open, and the first photo may be minutes away.
  res.flushHeaders()

  for (const missed of channel.log.since(parseLastEventId(lastEventId))) writeSignal(res, missed)

  // A comment frame straight away, so a client behind a buffering proxy learns
  // immediately that bytes flow.
  res.write(`: connected\n\n`)

  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) return
    // One block, two jobs. The comment line is invisible to every client handler and is
    // what keeps a proxy from closing an idle connection; the named frame carries no
    // `id:`, so it moves no cursor, and is the only thing that lets a client tell a
    // quiet evening from a pipe that has stopped delivering.
    res.write(`: keep-alive\nevent: ${HEARTBEAT_EVENT}\ndata: {}\n\n`)
  }, HEARTBEAT_MS)

  // Must not hold the process open during a graceful shutdown.
  heartbeat.unref()

  const cleanup = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    subscription.value()
    releaseChannel(eventId)
  }

  res.on('close', cleanup)
  res.on('error', (error: unknown) => {
    logger.debug('stream closed with an error', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    })
    cleanup()
  })

  return ok(cleanup)
}

/**
 * How long a refused client is asked to wait.
 *
 * Long enough that two hundred rejected connections do not become two hundred
 * connections a second, short enough that a projector rejoins within a song once the
 * screens that were hogging the channel have gone.
 */
const RETRY_AFTER_SECONDS = '30'

/**
 * Opens the channel for the event the middleware in front resolved.
 *
 * One handler for both channels, because the frames are identical and the only
 * difference is the authorization decision mounted ahead of it — writing it twice is how
 * the two would drift.
 *
 * The 404 is unreachable behind `resolvePublicEvent` or `requireRole`, which is the
 * point: a route that ever loses its authorization decision must fail closed rather than
 * dereference an absent event. A `!` here would turn that wiring bug into a `TypeError`
 * on a projector at 22:00, answered as a 500 after the fact. Exported so the guard can
 * be exercised without a route in front of it, as `publicRoutes.withPublicEvent` is.
 *
 * The `503` is the other half: a stream that cannot be opened is refused as a request,
 * not accepted as a connection that carries nothing. `503` rather than the `500` the
 * error's kind maps to, for the same reason `/api/ready` answers `503` — this is a
 * correct answer about a temporary state, and the client's own backoff is built for it.
 */
export const streamHandler =
  (deps: HttpDeps): RequestHandler =>
  (req, res) => {
    const event = req.context.event
    if (event === undefined) {
      res.status(404).end()
      return
    }

    const opened = openStream({
      deps,
      logger: req.context.logger,
      eventId: event.id,
      lastEventId: req.get('last-event-id'),
      res,
    })

    if (opened.ok) return

    res.setHeader('Retry-After', RETRY_AFTER_SECONDS)
    res.status(503).json(errorBody(opened.error))
  }

export const streamRoutes = (deps: HttpDeps): Router => {
  const router = Router()

  /**
   * These are the only two routes that hold a resource for hours rather than
   * milliseconds — a socket, an interval and a set entry each — so they are limited by
   * how many are *open at once* per client, which is the quantity that runs out. A
   * requests-per-minute limiter would let one client hold two hundred connections
   * forever as long as it opened them slowly.
   */
  const connections = streamConnectionLimiter()

  /** The wall's channel. Public, for an event that serves its wall. */
  router.get(
    '/events/:eventSlug/stream',
    connections,
    resolvePublicEvent(deps),
    streamHandler(deps),
  )

  /** The moderation console's channel. Same frames, moderator authorization. */
  router.get(
    '/events/:eventSlug/moderation/stream',
    connections,
    requireRole('moderator', deps),
    streamHandler(deps),
  )

  return router
}
