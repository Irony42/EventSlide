import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { readNoticeState, rememberPrivacyNotice } from '../../../lib/guestSession'
import { ApiError } from '../../../lib/http'
import type { PrivacyNoticeState } from '../../../lib/api/dto'

/**
 * The privacy notice on the upload screen, as view-state (roadmap §5.1).
 *
 * **No rule lives here.** Whether this device must read the notice is the server's answer
 * — `acknowledgement`, computed by `Guest.noticeAcknowledgementFor` against the notice the
 * event's settings produce now — and this hook only holds the latest one, the way
 * `useMyPhotos` holds `canDelete` without recomputing it.
 *
 * Three sources of that answer, in the order they arrive:
 *
 * 1. **The session the join wrote**, so the first frame already knows whether to show the
 *    picker or the notice. A `sessionStorage` read is synchronous; a round trip on venue
 *    Wi-Fi is not.
 * 2. **A fresh read when the screen opens, and whenever it comes back into view.** The
 *    join is a snapshot, and a host who changes retention at 22:00 has changed what
 *    happens to the next photo of a guest who joined at 19:00 — who finds out when they
 *    next take the phone out of their pocket, before they pick anything.
 * 3. **The acknowledgement's own answer.**
 *
 * ## A tap that did not land
 *
 * "J'ai compris" is applied at once, before the request answers: the guest has read the
 * notice, and making them wait on a saturated access point to see the picker would charge
 * them for the network. If the request is lost the tap is kept in memory and replayed the
 * next time a read says the same notice is still unread, so a guest who acknowledged
 * offline is not asked again when the signal comes back. It is **not** written to the
 * session: the session mirrors what the server holds, so a reload with the request still
 * lost asks again rather than claiming a record that does not exist.
 *
 * `409 privacyNotice.outdated` is the other outcome: the host changed a setting while the
 * guest was reading, and the answer is to show them the new notice rather than to record
 * that they agreed to the old one.
 */

export interface PrivacyNoticeView {
  /**
   * The notice and this device's standing, or `null` while nothing is known — a session
   * written before notices existed whose first read has not answered.
   */
  readonly state: PrivacyNoticeState | null
  /**
   * Whether the notice stands between this guest and the picker.
   *
   * `false` while `state` is `null`, deliberately. That case is only ever a guest whose
   * tab joined before this build shipped, who has been sending photos all evening; taking
   * the picker away from them until a request answers — or for good, if they are
   * offline — would be the notice getting in the way of the thing it describes.
   */
  readonly mustAcknowledge: boolean
  readonly acknowledge: () => void
}

export const usePrivacyNotice = (
  slug: string,
  initial: PrivacyNoticeState | null,
): PrivacyNoticeView => {
  const api = useApi()
  const [state, setState] = useState<PrivacyNoticeState | null>(initial)
  const [attempt, setAttempt] = useState(0)

  /**
   * Bumped by every acknowledgement, so a read that set off before the tap cannot land
   * after it and put the notice back on screen.
   */
  const generation = useRef(0)
  /** The revision a lost acknowledgement was for. See "A tap that did not land". */
  const unsent = useRef<string | null>(null)

  const refresh = useCallback(() => setAttempt((current) => current + 1), [])

  const send = useCallback(
    (revision: string) => {
      generation.current += 1
      const mine = generation.current

      api.acknowledgePrivacyNotice(slug, revision).then(
        (received) => {
          unsent.current = null
          const answer = readNoticeState(received)
          if (answer !== null) rememberPrivacyNotice(slug, answer)
          if (generation.current === mine) setState(answer)
        },
        (cause: unknown) => {
          if (cause instanceof ApiError && cause.code === 'privacyNotice.outdated') {
            // What the guest read is no longer what happens to their photo. Nothing to
            // replay: the next read brings the new notice, and it is shown as unread.
            unsent.current = null
            refresh()
            return
          }
          // Lost, or refused for a reason the rest of the screen will already be showing
          // (a revoked guest, a closed event). Kept, and replayed by the next read.
          unsent.current = revision
        },
      )
    },
    [api, refresh, slug],
  )

  useEffect(() => {
    const controller = new AbortController()
    const mine = generation.current
    let current = true

    api.privacyNotice(slug, controller.signal).then(
      (received) => {
        if (!current || generation.current !== mine) return
        // Narrowed like the stored copy. A notice this bundle cannot word — an audience it
        // has no sentence for, because the server is newer — is shown as none rather than
        // as a shorter one, and the picker stays, as for a tab older than the notice. The
        // next load of the page brings a bundle that can say it.
        const fresh = readNoticeState(received)
        if (fresh === null) {
          setState(null)
          return
        }
        // A tap for this very notice was lost on the way: the guest has read it, so send
        // it again instead of asking them twice.
        if (fresh.acknowledgement !== 'current' && unsent.current === fresh.notice.revision) {
          send(fresh.notice.revision)
          return
        }
        rememberPrivacyNotice(slug, fresh)
        setState(fresh)
      },
      () => {
        // Silent, like the checklist: a failed read leaves the last answer on screen, and
        // the next time the page comes into view asks again.
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [api, attempt, send, slug])

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const acknowledge = useCallback(() => {
    if (state === null) return
    setState({ ...state, acknowledgement: 'current' })
    send(state.notice.revision)
  }, [send, state])

  return {
    state,
    mustAcknowledge: state !== null && state.acknowledgement !== 'current',
    acknowledge,
  }
}
