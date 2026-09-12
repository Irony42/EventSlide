import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../../app/useApi'
import type { WallResponse } from '../../../lib/api/dto'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'

export interface WallPlaylistState {
  /** `null` only until the first answer arrives. */
  readonly wall: WallResponse | null
  readonly loading: boolean
  readonly error: Error | null
  /** The stream is not delivering. The photos already loaded keep playing. */
  readonly offline: boolean
  /**
   * How many `reaction.added` signals have arrived on this connection. A counter
   * rather than a list because the frame is an invalidation signal and carries no
   * reaction — the wall knows that something was felt, not by whom.
   */
  readonly reactionPulse: number
  readonly refresh: () => void
}

interface Fetched {
  readonly wall: WallResponse | null
  readonly loading: boolean
  readonly error: Error | null
}

const INITIAL: Fetched = { wall: null, loading: true, error: null }

/**
 * How long the wall waits before asking again after a failed read.
 *
 * Nobody is going to press anything: the projector is in a corner and the host is at
 * the reception. A wall that fails its first read while the server is restarting has to
 * come back by itself, and ten seconds is short enough that the room barely sees it and
 * long enough not to hammer a server that is the thing which is down.
 */
const RETRY_DELAY_MS = 10_000

/**
 * The wall's playlist, kept current over SSE.
 *
 * Two rules make this survive an eight-hour evening:
 *
 * 1. **The revision decides.** A signal is an invalidation, not data, so every signal
 *    on the event's channel — a guest joining, a photo submitted for moderation, a
 *    settings change — provokes one refetch. Most of them come back with the same
 *    `revision`, and an unchanged revision leaves the state object untouched, so React
 *    bails out and the room sees nothing at all. Without that check the wall would
 *    jump every time anything happened at the event.
 * 2. **A failure never blanks the screen.** A refetch that fails keeps the playlist it
 *    already has and reports the error alongside it. A venue's network drops for
 *    thirty seconds several times an evening, and the correct behaviour is to carry on
 *    showing the photos the projector already holds.
 */
export const useWallPlaylist = (slug: string): WallPlaylistState => {
  const api = useApi()
  const [state, setState] = useState<Fetched>(INITIAL)
  const [attempt, setAttempt] = useState(0)
  const [reactionPulse, setReactionPulse] = useState(0)

  /**
   * A refresh does not raise `loading`.
   *
   * `loading` is what the page uses to decide whether it has anything to show; raising
   * it on a refetch would replace a wall full of photos with a spinner every time a
   * guest joined.
   */
  const refresh = useCallback(() => setAttempt((current) => current + 1), [])

  const onSignal = useCallback(
    (signal: StreamSignal) => {
      // A reaction changes no photo, so it must not provoke a playlist read: during a
      // first dance the hearts arrive faster than the wall endpoint should be asked.
      if (signal.type === 'reaction.added') {
        setReactionPulse((pulse) => pulse + 1)
        return
      }
      refresh()
    },
    [refresh],
  )

  const { connected } = useEventStream({
    url: slug === '' ? null : api.streamUrl(slug),
    onSignal,
  })

  useEffect(() => {
    if (slug === '') return

    const controller = new AbortController()
    let live = true

    api.wall(slug, controller.signal).then(
      (response) => {
        if (!live) return
        setState((previous) => {
          if (previous.wall !== null && previous.wall.revision === response.revision) {
            // Same playlist. Returning the identical object is what makes this a
            // non-event for React — and what keeps the cursor, the slide clock and the
            // Ken Burns animation exactly where they were.
            if (!previous.loading && previous.error === null) return previous
            return { wall: previous.wall, loading: false, error: null }
          }
          return { wall: response, loading: false, error: null }
        })
      },
      (cause: unknown) => {
        if (!live) return
        // The abort came from this effect's own cleanup — StrictMode mounts twice — and
        // is not a failure the room needs to hear about.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState((previous) => ({
          wall: previous.wall,
          loading: false,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        }))
      },
    )

    return () => {
      live = false
      controller.abort()
    }
  }, [api, slug, attempt])

  useEffect(() => {
    if (state.error === null) return
    // Each failure is a new Error, so this re-arms once per failed attempt and the
    // timer is cleared on unmount — an eight-hour run accumulates nothing.
    const timer = window.setTimeout(refresh, RETRY_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state.error, refresh])

  return {
    wall: state.wall,
    // A slug-less route is not loading, it is broken: the page then shows its error
    // state rather than a spinner that never stops, which is the one thing the room
    // must never be left looking at.
    loading: slug !== '' && state.loading,
    error: state.error,
    offline: !connected,
    reactionPulse,
    refresh,
  }
}
