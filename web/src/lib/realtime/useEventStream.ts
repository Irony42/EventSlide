import { useEffect, useRef, useState } from 'react'

/**
 * One server-sent-events connection per page.
 *
 * Two consumers: the projected wall and the moderation console. Both need the same
 * three properties, and 1.0 shipped none of them — its wall opened a fresh
 * `EventSource` on every render, never reconnected after a drop, and read the pushed
 * payload as data.
 *
 * 1. **Signals, never data.** The server sends `{"type":"photo.moderated"}` and the
 *    consumer refetches. Pushing rows would mean two divergent code paths for the same
 *    state and an authorization decision on the push side, where there is no request
 *    to authorize against (docs/API.md section 7).
 * 2. **One connection, cleaned up.** The connection belongs to the effect, so a
 *    navigation away from the console closes it instead of leaving the browser holding
 *    six streams open for the rest of an eight-hour run.
 * 3. **Reconnect, with a cap.** A venue's network drops. A wall nobody is watching has
 *    to come back on its own, and it must not hammer the server while the server is
 *    the thing that is down.
 * 4. **A watchdog.** A connection that is open and silent is indistinguishable from a
 *    healthy one during a quiet spell — and that is the failure mode that costs a whole
 *    evening, because nothing on screen says anything is wrong. The server sends a
 *    heartbeat every fifteen seconds, so silence is measurable: three missed heartbeats
 *    and the stream is closed and reopened.
 */

/**
 * The frame's `event:` name, from `src/interface/http/routes/streamRoutes.ts`.
 */
const SIGNAL_EVENT = 'change'

/**
 * The heartbeat's `event:` name, from the same file.
 *
 * The heartbeat is also a comment frame, which reaches no listener at all — that is what
 * lets it keep a proxy from closing an idle connection without waking the UI. The named
 * half exists only for the watchdog below: it carries no `id:` and no meaning, and it is
 * never delivered to the consumer. Without it a client cannot tell an hour with no
 * photos from a proxy that stopped forwarding an hour ago.
 */
const HEARTBEAT_EVENT = 'ping'

/**
 * How long a connection may say nothing at all before it is assumed dead.
 *
 * Three heartbeats. Two would turn one late frame on a venue's saturated uplink into a
 * reconnect; a minute or more is long enough for a guest to ask why their photo is not
 * on the wall. The trap this closes is recorded in CLAUDE.md section 9.3: SSE dies
 * silently behind a proxy, and the connection that carries nothing looks exactly like
 * the connection that has nothing to carry.
 */
const SILENCE_TIMEOUT_MS = 45_000

/**
 * `EventSource.CLOSED`, spelled as its value.
 *
 * The constant lives on the constructor, and jsdom has no `EventSource` at all — the
 * test setup installs a stand-in — so reading it off the global would be `undefined`
 * in exactly the environment where the reconnect path is asserted.
 */
const READY_STATE_CLOSED = 2

const BASE_DELAY_MS = 1_000

/**
 * The backoff ceiling. Half a minute is long enough not to hammer a server that is
 * restarting, and short enough that a projector nobody is watching rejoins the stream
 * before the next song ends.
 */
const MAX_DELAY_MS = 30_000

/** What the server can emit, from `DomainEvent['type']` in the application layer. */
export const STREAM_SIGNAL_TYPES = [
  'photo.uploaded',
  'photo.moderated',
  'photo.deleted',
  'photo.captionChanged',
  'guest.joined',
  'reaction.added',
  'event.statusChanged',
  'event.settingsChanged',
] as const

export type StreamSignalType = (typeof STREAM_SIGNAL_TYPES)[number]

export interface StreamSignal {
  /**
   * The frame's `type`, as sent. Typed as a plain string on purpose: a newer server
   * may emit a signal this build has never heard of, and an invalidation nobody acts
   * on shows as a stale wall — so an unrecognised type is delivered rather than
   * dropped. Narrow it with {@link isStreamSignalType} when the distinction matters.
   */
  readonly type: string
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(STREAM_SIGNAL_TYPES)

export const isStreamSignalType = (value: string): value is StreamSignalType =>
  KNOWN_TYPES.has(value)

/**
 * The frame body, parsed defensively.
 *
 * The payload crosses a trust boundary like any other server response: a truncated
 * frame, a proxy error page or a future field must leave the page running rather than
 * throw inside an event listener, where nothing would catch it.
 */
const parseSignal = (event: Event): StreamSignal | null => {
  if (!(event instanceof MessageEvent)) return null
  const raw: unknown = event.data
  if (typeof raw !== 'string') return null

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof payload !== 'object' || payload === null || !('type' in payload)) return null
  const { type } = payload
  return typeof type === 'string' ? { type } : null
}

export interface UseEventStreamOptions {
  /** `null` when the page has nothing to subscribe to yet — a slug still resolving. */
  readonly url: string | null
  /** Called with each invalidation signal. Refetch here; do not read a payload. */
  readonly onSignal: (signal: StreamSignal) => void
  readonly enabled?: boolean
}

export interface EventStreamState {
  /** Surfaced by the UI: a host has to know the queue has stopped updating itself. */
  readonly connected: boolean
}

export const useEventStream = ({
  url,
  onSignal,
  enabled = true,
}: UseEventStreamOptions): EventStreamState => {
  const [open, setOpen] = useState(false)

  /**
   * The callback is read through a ref so its identity is not a dependency of the
   * connection. A consumer that refetches on a signal re-renders on every signal, and
   * a new function each render would otherwise tear the stream down and rebuild it —
   * losing `Last-Event-ID` every time a photo arrives.
   */
  const listener = useRef(onSignal)
  useEffect(() => {
    listener.current = onSignal
  }, [onSignal])

  useEffect(() => {
    if (!enabled || url === null) return

    let disposed = false
    let attempt = 0
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined

    const stopWatchdog = () => {
      if (watchdog === undefined) return
      clearTimeout(watchdog)
      watchdog = undefined
    }

    const connect = () => {
      // `withCredentials`, because the moderation stream is authorized by the host's
      // session cookie and the guest surfaces by their device token.
      const stream = new EventSource(url, { withCredentials: true })
      source = stream

      /**
       * Restarted by anything that arrives — a signal, a heartbeat, the connection
       * opening. Measured as a timer rather than against the clock, so a test decides
       * when the silence is over instead of waiting for it, and so a laptop lid closing
       * does not count the hours it slept as silence.
       */
      const heard = () => {
        stopWatchdog()
        watchdog = setTimeout(() => {
          // Open, and carrying nothing, for three heartbeats. The server would have to
          // be refusing to talk to us for this to be honest quiet, so treat it as a
          // connection the browser has not noticed is dead.
          setOpen(false)
          stream.close()
          scheduleReconnect()
        }, SILENCE_TIMEOUT_MS)
      }

      stream.addEventListener('open', () => {
        attempt = 0
        setOpen(true)
        heard()
      })

      stream.addEventListener(SIGNAL_EVENT, (event) => {
        heard()
        const signal = parseSignal(event)
        if (signal !== null) listener.current(signal)
      })

      // Nothing is delivered to the consumer: a heartbeat says the pipe is alive and
      // means nothing else, and refetching on one would be a request every fifteen
      // seconds from every screen in the venue.
      stream.addEventListener(HEARTBEAT_EVENT, heard)

      stream.addEventListener('error', () => {
        setOpen(false)
        /**
         * While the browser leaves the connection in CONNECTING it is retrying by
         * itself, and it is the only party that can resend `Last-Event-ID` — so the
         * replay of what was missed during the drop depends on staying out of its way.
         * Reconnecting by hand is for the case it gives up on: a non-2xx response or a
         * wrong content type, which leaves the stream CLOSED for good.
         *
         * The watchdog stands down for the same reason: a browser that is retrying has
         * already noticed, and stepping in would replace its reconnect — the one that
         * still carries the cursor — with a fresh connection that does not.
         */
        stopWatchdog()
        if (stream.readyState !== READY_STATE_CLOSED) return
        stream.close()
        scheduleReconnect()
      })
    }

    const scheduleReconnect = () => {
      if (disposed) return
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
      attempt += 1
      timer = setTimeout(connect, delay)
    }

    connect()

    return () => {
      disposed = true
      stopWatchdog()
      if (timer !== undefined) clearTimeout(timer)
      source?.close()
    }
  }, [url, enabled])

  // Derived rather than reset in the cleanup: a disabled or slug-less stream is not
  // connected by definition, and setting state on the way out of an effect is how a
  // cascading render gets introduced.
  return { connected: enabled && url !== null && open }
}
