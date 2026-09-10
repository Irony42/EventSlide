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
 */

/**
 * The frame's `event:` name, from `src/interface/http/routes/streamRoutes.ts`. The
 * heartbeat is a comment frame, so it reaches no listener at all — which is exactly
 * why it can keep a proxy from closing an idle connection without waking the UI.
 */
const SIGNAL_EVENT = 'change'

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

    const connect = () => {
      // `withCredentials`, because the moderation stream is authorized by the host's
      // session cookie and the guest surfaces by their device token.
      const stream = new EventSource(url, { withCredentials: true })
      source = stream

      stream.addEventListener('open', () => {
        attempt = 0
        setOpen(true)
      })

      stream.addEventListener(SIGNAL_EVENT, (event) => {
        const signal = parseSignal(event)
        if (signal !== null) listener.current(signal)
      })

      stream.addEventListener('error', () => {
        setOpen(false)
        /**
         * While the browser leaves the connection in CONNECTING it is retrying by
         * itself, and it is the only party that can resend `Last-Event-ID` — so the
         * replay of what was missed during the drop depends on staying out of its way.
         * Reconnecting by hand is for the case it gives up on: a non-2xx response or a
         * wrong content type, which leaves the stream CLOSED for good.
         */
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
      if (timer !== undefined) clearTimeout(timer)
      source?.close()
    }
  }, [url, enabled])

  // Derived rather than reset in the cleanup: a disabled or slug-less stream is not
  // connected by definition, and setting state on the way out of an effect is how a
  // cascading render gets introduced.
  return { connected: enabled && url !== null && open }
}
