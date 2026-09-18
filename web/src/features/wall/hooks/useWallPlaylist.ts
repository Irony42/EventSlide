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
 * Everything on a wall response that is **not** the playlist, compared.
 *
 * `revision` fingerprints `items` and nothing else, which is exactly right for deciding
 * whether the room's photos moved — and exactly wrong for deciding whether the response
 * is worth keeping. A host who changes a setting produces `event.settingsChanged`, the
 * wall refetches, and every field below comes back different while `revision` does not.
 *
 * That was a real defect in per-event theming (roadmap 2.2): a host picking a colour saw
 * nothing happen on the projector until somebody reloaded it — and on the empty wall,
 * which is the screen they are looking at while they choose, `revision` never changes at
 * all, so it would never have arrived. The same staleness applied to the slide interval
 * and to `reactionsEnabled` before that; it is fixed here for all of them rather than for
 * the field that happened to expose it.
 */
/**
 * Exported for the test that enumerates the response rather than trusting this list.
 *
 * Hand-written comparisons are complete today and silently incomplete the day another
 * field is added — which is exactly the defect the docblock above describes, reappearing
 * one field later. `useWallPlaylist.settings.test.ts` walks `WallResponse` and fails naming
 * any key that is neither compared here nor deliberately exempted.
 *
 * **It walks the theme's own keys as well, and that is roadmap 11.5's correction rather
 * than a tidy-up.** The enumeration only ever saw the response's top level, and the theme
 * arrives as one object there — so `material` was added to the wire, compared nowhere, and
 * the guard written to catch exactly this stayed green. The symptom would have been a host
 * changing only the material while a projector was already running and the wall keeping the
 * stale answer until the next photograph moved `revision`.
 */
export const SETTINGS_EXEMPT: readonly string[] = ['items', 'revision']

export const sameSettings = (kept: WallResponse, fresh: WallResponse): boolean =>
  kept.joinCode === fresh.joinCode &&
  kept.slideIntervalMs === fresh.slideIntervalMs &&
  kept.kenBurnsDurationMs === fresh.kenBurnsDurationMs &&
  kept.layout === fresh.layout &&
  kept.reactionsEnabled === fresh.reactionsEnabled &&
  kept.event.name === fresh.event.name &&
  kept.theme?.accentHue === fresh.theme?.accentHue &&
  kept.theme?.fonts === fresh.theme?.fonts &&
  kept.theme?.frame === fresh.theme?.frame &&
  kept.theme?.material === fresh.theme?.material

/**
 * The wall's playlist, kept current over SSE.
 *
 * Two rules make this survive an eight-hour evening:
 *
 * 1. **The revision decides where the photos are.** A signal is an invalidation, not
 *    data, so every signal on the event's channel — a guest joining, a photo submitted
 *    for moderation, a settings change — provokes one refetch. Most come back with the
 *    same `revision`, and an unchanged revision leaves the playlist untouched, so React
 *    bails out and the room sees nothing at all. Without that check the wall would jump
 *    every time anything happened at the event.
 *
 *    It decides the *playlist* and nothing else, though: `revision` fingerprints `items`,
 *    so everything else on the response is compared separately by `sameSettings` and
 *    taken fresh when it moved. A wall that discarded those would never learn that the
 *    host had just changed the event's colour.
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
          const kept = previous.wall
          if (kept !== null && kept.revision === response.revision) {
            // Same playlist. Returning the identical object is what makes this a
            // non-event for React — and what keeps the cursor, the slide clock and the
            // Ken Burns animation exactly where they were.
            if (sameSettings(kept, response)) {
              if (!previous.loading && previous.error === null) return previous
              return { wall: kept, loading: false, error: null }
            }
            // The photos did not move but something the room reads did. The fresh
            // response is taken whole **except** for `items`, which keeps its identity
            // so the slideshow does not restart under a host who only changed a colour.
            return { wall: { ...response, items: kept.items }, loading: false, error: null }
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
