import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import { serverOffsetMs } from '../../../lib/serverClock'
import { useLoader } from '../../../lib/useLoader'
import type { GuestChallengeDto, GuestMissionDto } from '../../../lib/api/dto'

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
  /** The host's timed challenge, or `null` (spec 10). */
  readonly challenge: GuestChallengeDto | null
  /** This phone's clock to the server's, measured at the last read, for the countdown. */
  readonly offsetMs: number
}

/**
 * How often the phone asks again whether a challenge started (spec 10), while the page is visible.
 *
 * Twenty seconds is a cost choice, not a freshness one: 200 guests are about ten reads a second,
 * each three indexed queries. The alternative, the event stream, is one long connection per phone
 * (`maxStreamsPerClient`, battery), and the guest surface deliberately opens none. A phone may see
 * a challenge up to twenty seconds late; it counts down against the server's clock, so it is
 * never wrong about the time left. The delay carries a jitter of 15 % either way, so two hundred
 * phones that opened together do not read together for the rest of the evening.
 */
export const CHALLENGE_POLL_MS = 20_000
const JITTER = 0.15

const NO_MISSIONS: readonly GuestMissionDto[] = []

export const useMissions = (slug: string): MissionsState => {
  const api = useApi()
  const [offsetMs, setOffsetMs] = useState(0)
  const load = useCallback(
    async (signal: AbortSignal) => {
      const sentAt = Date.now()
      const response = await api.myMissions(slug, signal)
      if (response.serverNowMs !== undefined) {
        setOffsetMs(serverOffsetMs(response.serverNowMs, sentAt, Date.now()))
      }
      return response
    },
    [api, slug],
  )
  const { data, reload: refresh } = useLoader(load)
  const missions = data?.items ?? NO_MISSIONS
  const challenge = data?.challenge ?? null
  const [selected, setSelected] = useState<string | null>(null)

  /**
   * Asked again every twenty seconds, and on coming back to the tab, while the page is on
   * screen. On **every** event since spec 18: a challenge has its own text and needs no mission,
   * so an event with no prompts can run one, and a phone cannot know before it asks. The cost
   * is the one `CHALLENGE_POLL_MS` argues, one more indexed read per phone on those events.
   */
  useEffect(() => {
    let timer: number | undefined
    const schedule = (): void => {
      timer = window.setTimeout(tick, CHALLENGE_POLL_MS * (1 + (Math.random() * 2 - 1) * JITTER))
    }
    const tick = (): void => {
      if (document.visibilityState === 'visible') refresh()
      schedule()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    schedule()
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

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

  return {
    missions,
    selected: live ? selected : null,
    toggle,
    refresh,
    challenge,
    offsetMs,
  }
}
