import { cx } from '../../design-system/classNames'
import type { WallChallengeDto, WallResponse } from '../../lib/api/dto'
import { joinCardScale } from './joinCardScale'

/**
 * How long a host's `Q` keeps the corner QR away.
 *
 * Nobody is at the projector to bring it back, and the QR is the one way a late guest gets in:
 * a hiding that outlived the host's attention would cost them their evening, so it undoes
 * itself (MUR-5).
 */
export const QR_HIDDEN_MS = 10 * 60_000

type JoinCardSettings = NonNullable<WallResponse['joinCard']>

/** The card as it always was, for an older server that sends no settings (spec 14). */
export const DEFAULT_JOIN_CARD: JoinCardSettings = {
  visible: true,
  scale: 1,
  placement: 'bottom-end',
}

export interface WallInvitation {
  readonly code: string
  readonly url: string
}

export interface WallChromeInput {
  readonly wall: WallResponse | null
  /** How many photographs the wall has to show: the card and the missions wait for one. */
  readonly itemCount: number
  /** The host put the corner card away (`Q`, or the card's own button). */
  readonly qrHidden: boolean
  /** The id of the challenge whose banner has shown "Défi terminé" for its ten seconds. */
  readonly challengeGone: string | null
}

export interface WallChrome {
  /** The code and link together, or `null`: never half of it. */
  readonly join: WallInvitation | null
  readonly acceptsGuests: boolean
  /** `join`, unless the host has closed the evening. */
  readonly invitation: WallInvitation | null
  readonly challenge: WallChallengeDto | null
  readonly showsChallenge: boolean
  /** `challenge` while its banner is up, `null` otherwise. */
  readonly shownChallenge: WallChallengeDto | null
  readonly challengeRunning: boolean
  readonly placement: JoinCardSettings['placement']
  /** Whether a corner card may exist at all: invited, switched on by the host, wall populated. */
  readonly cardEnabled: boolean
  /** Whether it is drawn now: enabled and not put away, or held on screen by a running challenge. */
  readonly showsOverlay: boolean
  /** The scale drawn: the host's, lifted to the readability floor of this very link. */
  readonly cardScale: number
  readonly stackStart: boolean
  readonly stackEnd: boolean
  /** The `data-wall-chrome` value: the corners the chrome occupies, `''` when none. */
  readonly chrome: string
  /** The challenge whose start brings the card back, once; `null` when none is running. */
  readonly startedChallengeId: string | null
}

/**
 * The wall's chrome rules, in one pure place: which of the invitation, the join card and the
 * challenge banner the room sees. `WallPage` only draws what this says.
 */
export const chromeOf = ({
  wall,
  itemCount,
  qrHidden,
  challengeGone,
}: WallChromeInput): WallChrome => {
  // The code and the link arrive together from one presenter, so there is no deployment in
  // which the server sends one and not the other. Requiring both here is what keeps the
  // browser from inventing the missing half from `window.location.origin`: that is the
  // address this projector was opened on rather than the one a guest's phone can reach, and
  // printing it inside a QR is trap 1 with a different mismatch.
  const join: WallInvitation | null =
    wall?.joinCode !== undefined && wall.joinUrl !== undefined
      ? { code: wall.joinCode, url: wall.joinUrl }
      : null
  // Absent means an older server, which never said otherwise. Once the host has closed the
  // evening the wall keeps playing, but a QR on it leads to "not open" (MUR-3).
  const acceptsGuests = wall?.acceptsGuests !== false
  const invitation = acceptsGuests ? join : null

  // The timed challenge (spec 10) is withheld only when the room can no longer send photographs.
  const challenge = wall?.challenge ?? null
  const showsChallenge = acceptsGuests && challenge !== null && challengeGone !== challenge.id
  const challengeRunning = showsChallenge && challenge.state === 'running'

  const joinCard = wall?.joinCard ?? DEFAULT_JOIN_CARD
  const cardEnabled = invitation !== null && joinCard.visible && itemCount > 0
  const showsOverlay = cardEnabled && (!qrHidden || challengeRunning)
  const cardScale = invitation === null ? 1 : joinCardScale(joinCard.scale, invitation.url)
  const placement = joinCard.placement

  return {
    join,
    acceptsGuests,
    invitation,
    challenge,
    showsChallenge,
    shownChallenge: showsChallenge ? challenge : null,
    challengeRunning,
    placement,
    cardEnabled,
    showsOverlay,
    cardScale,
    stackStart: cardEnabled && placement === 'top-start',
    stackEnd: cardEnabled && placement === 'top-end',
    chrome: cx(showsOverlay && 'corner', showsChallenge && 'top'),
    startedChallengeId: challengeRunning && challenge !== null ? challenge.id : null,
  }
}
