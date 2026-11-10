import { useCallback, useEffect, useState } from 'react'
import type { WallResponse } from '../../../lib/api/dto'
import { QR_HIDDEN_MS, chromeOf, type WallChrome } from '../wallChrome'

export interface WallChromeView extends WallChrome {
  readonly qrHidden: boolean
  readonly hideQr: () => void
  readonly toggleQr: () => void
  /** Stable per challenge, so the banner's ten-second timer is not restarted by every render. */
  readonly leaveChallenge: () => void
}

/**
 * The state behind the wall's chrome (`chromeOf` holds the rules): the corner QR put away by the
 * host, which undoes itself after `QR_HIDDEN_MS` because the projector is unattended, and the
 * challenge banner that has shown its end. One timer, cleared on change and on unmount.
 */
export const useWallChrome = (
  wall: WallResponse | null,
  itemCount: number,
  cornerCard = true,
): WallChromeView => {
  const [qrHidden, setQrHidden] = useState(false)
  const [challengeGone, setChallengeGone] = useState<string | null>(null)
  const [seenChallenge, setSeenChallenge] = useState<string | null>(null)

  useEffect(() => {
    if (!qrHidden) return
    const timer = window.setTimeout(() => setQrHidden(false), QR_HIDDEN_MS)
    return () => window.clearTimeout(timer)
  }, [qrHidden])

  const chrome = chromeOf({ wall, itemCount, qrHidden, challengeGone, cornerCard })

  const challengeId = chrome.challenge?.id ?? null
  const leaveChallenge = useCallback(() => setChallengeGone(challengeId), [challengeId])
  const hideQr = useCallback(() => setQrHidden(true), [])
  const toggleQr = useCallback(() => setQrHidden((hidden) => !hidden), [])

  // The join card comes back when a challenge starts, even if `Q` put it away: a challenge with
  // no way to join it means nothing. Adjusted while rendering, once per challenge, so the host
  // can still put it away afterwards.
  if (chrome.startedChallengeId !== null && chrome.startedChallengeId !== seenChallenge) {
    setSeenChallenge(chrome.startedChallengeId)
    setQrHidden(false)
  }

  return { ...chrome, qrHidden, hideQr, toggleQr, leaveChallenge }
}
