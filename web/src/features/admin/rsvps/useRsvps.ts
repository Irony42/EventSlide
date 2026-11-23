import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RsvpListResponseDto, RsvpSettingsDto } from '../../../lib/api/dto'
import { useReadScheduler } from '../../../lib/realtime/useReadScheduler'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import { useApi } from '../../../lib/useApi'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import { useRevalidateWhenVisible } from '../hooks/useRevalidateWhenVisible'

/**
 * The replies page's read, kept live (spec 30): the moderation stream says **that** the replies
 * changed (`rsvp.changed`, no content), and the list is read again, coalesced over a short window so
 * a burst of replies is one read. The stream is the console's own, so the page opens no connection
 * of its own beyond it.
 *
 * Reading the page is **seeing it**: while the page is open and the answer holds replies the host
 * has not seen, they are marked seen (once per answer), and the menu's badge is told to read again.
 * A reply that lands while the page is open is therefore seen at once and never counted.
 */

/** A burst of replies (a guest's two edits, three guests at the same table) is one read. */
export const RSVP_SIGNAL_DEBOUNCE_MS = 400

export interface RsvpsState extends LoaderState<RsvpListResponseDto> {
  /** Swaps the settings in, from the answer of "Fermer" or "Rouvrir". */
  readonly adoptSettings: (rsvpForm: RsvpSettingsDto) => void
}

export const useRsvps = (slug: string, onSeen: () => void): RsvpsState => {
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.rsvps(slug, signal), [api, slug])
  const state = useLoader(load)
  const { data: loaded, reload } = state
  // What "Fermer" or "Rouvrir" answered, laid over the answer it was made against; a newer read replaces it.
  const [adopted, setAdopted] = useState<{
    readonly over: RsvpListResponseDto | null
    readonly rsvpForm: RsvpSettingsDto
  } | null>(null)
  const data = useMemo(
    () =>
      loaded !== null && adopted !== null && adopted.over === loaded
        ? { ...loaded, rsvpForm: adopted.rsvpForm }
        : loaded,
    [loaded, adopted],
  )

  const refresh = useCallback(() => reload(), [reload])
  useRevalidateWhenVisible(refresh)

  const reads = useReadScheduler(refresh, {
    debounceMs: RSVP_SIGNAL_DEBOUNCE_MS,
    tracksSettlement: false,
  })
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (signal.type === 'rsvp.changed') reads.request()
    },
    [reads],
  )
  // Nothing says what happened while the stream was down: the list is read at once when it is back.
  const onReconnect = useCallback(() => reads.request({ immediate: true }), [reads])
  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  const { connected } = useEventStream({ url: streamUrl, onSignal, onReconnect })
  // The first connection says nothing of what came in between the read and its opening: read once more.
  const wasConnected = useRef(false)
  useEffect(() => {
    if (!connected || wasConnected.current) return
    wasConnected.current = true
    reads.request({ immediate: true })
  }, [connected, reads])

  // Seen: once per answer that holds replies the host had not seen.
  const seen = useRef<RsvpListResponseDto | null>(null)
  useEffect(() => {
    if (loaded === null || loaded.unseen === 0 || seen.current === loaded) return
    seen.current = loaded
    void api.markRsvpsSeen(slug).then(
      () => {
        // A reply may have come between the read and the mark: read once more, so what is marked is shown.
        reload()
        onSeen()
      },
      () => undefined,
    )
  }, [api, slug, loaded, reload, onSeen])

  const adoptSettings = useCallback(
    (rsvpForm: RsvpSettingsDto) => {
      setAdopted({ over: loaded, rsvpForm })
      // A reply that came in during the act is read, not lost: the settings are laid over, the list is read again.
      reload()
    },
    [loaded, reload],
  )

  return { ...state, data, adoptSettings }
}
