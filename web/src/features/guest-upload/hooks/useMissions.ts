import { useCallback, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { useLoader } from '../../../lib/useLoader'
import type { GuestMissionDto } from '../../../lib/api/dto'

/**
 * The guest's checklist, from `GET /api/events/:slug/missions/mine` (roadmap §2.1).
 *
 * Two pieces of view-state and no rules: which prompts the host set and which of them
 * this guest has left, plus which one the next upload will be filed under. Whether a
 * prompt is done is the server's answer — `isDoneForGuest` is a domain rule and this hook
 * must never reproduce it, for the reason `useMyPhotos` never recomputes `canDelete`:
 * 1.0's client-side copy of a server rule is why it offered a delete button that 403'd.
 *
 * **It reports no error and no loading state**, unlike every other read on this screen,
 * and that is a decision rather than an omission. The checklist is an invitation, not a
 * report: a guest whose network dropped while it was loading still has to be able to send
 * their photographs, and a spinner or a red sentence above the picker would be the
 * feature getting in the way of the thing the product exists for. A failed read leaves the
 * list as it was (empty, on a first failure), the screen renders as it does for the majority
 * of events that set no prompts, and the next settled upload retries it. The read is
 * `useLoader`'s; this hook takes its answer and drops its `loading` and `error` on purpose.
 */

export interface MissionsState {
  readonly missions: readonly GuestMissionDto[]
  /** The prompt the next upload will be filed under, or `null`. */
  readonly selected: string | null
  /** Passing the id that is already selected clears it — the same tap, twice. */
  readonly toggle: (missionId: string) => void
  readonly refresh: () => void
}

const NO_MISSIONS: readonly GuestMissionDto[] = []

export const useMissions = (slug: string): MissionsState => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal) => (await api.myMissions(slug, signal)).items,
    [api, slug],
  )
  const { data, reload: refresh } = useLoader(load)
  const missions = data ?? NO_MISSIONS
  const [selected, setSelected] = useState<string | null>(null)

  const toggle = useCallback((missionId: string) => {
    setSelected((current) => (current === missionId ? null : missionId))
  }, [])

  /**
   * A selection that no longer names a prompt reads as none.
   *
   * The host can delete a mission mid-evening, and the checklist refetches after every
   * settled upload — so a guest can be holding a selection the server would now refuse
   * with `mission.notFound`, which on venue Wi-Fi costs them the whole batch. Sending
   * untagged instead is the better failure: the photographs arrive, and the row they were
   * meant for is gone anyway.
   *
   * **Derived at read rather than cleaned up in an effect.** An effect that called
   * `setSelected(null)` would be a second render for a value this one already knows, and
   * `react-hooks/set-state-in-effect` refuses it — rightly: between the two renders the
   * page would hold an id no row on screen matches, which is exactly the state this is
   * meant to prevent.
   */
  const live = selected !== null && missions.some((mission) => mission.id === selected)

  return { missions, selected: live ? selected : null, toggle, refresh }
}
