import { isInAlbum, type PhotoStatus } from '../photos/photoStatus'

/**
 * What the album's deletion band says about the voice messages the purge is about to take
 * (spec 25, section 10; the band is spec 22's).
 *
 * Two ways a recording is **lost without the host having heard it**, both quiet:
 *
 * - **Still secret.** The host asked for the voices to be kept secret until the party is over and
 *   the event has not been closed (retained by a nearer date: a client's ceiling, an offboarding),
 *   so the album is about to go with recordings nobody listened to.
 * - **Still waiting for a decision.** The wedding model turns the voices on with a manual
 *   moderation, so every recording is a decision, and only a **published** one enters the album and
 *   the archive. A host who has not decided the lot loses the rest at the purge.
 *
 * The band says so **from a week before the date**, no earlier: a month out it would be a worry with
 * no action to go with it, and the 14-day e-mail already tells the host the date. Pure: the
 * repository's rows and the clock arrive as parameters.
 */

/** The band's voice warnings start this many days before the album's deletion date. */
export const VOICE_WARNING_DAYS = 7

/**
 * Whether the band speaks of the voices at all: an album on a clock whose date is between a day
 * and a week away. Asked before the book is read, so the other three weeks cost no read.
 */
export const voiceWarningApplies = (daysLeft: number | null): daysLeft is number =>
  daysLeft !== null && daysLeft > 0 && daysLeft <= VOICE_WARNING_DAYS

export interface VoicesAtRisk {
  /** Published recordings still kept secret: they would leave without having been listened to. */
  readonly secret: number
  /** Recordings waiting for a decision: they will not be in the album. */
  readonly pending: number
}

export const NO_VOICES_AT_RISK: VoicesAtRisk = { secret: 0, pending: 0 }

export interface VoiceAtRiskInput {
  /**
   * Whole days left until the album's date, rounded up (`daysLeftUntil`), or `null` when the album
   * is not on a clock. 0 is a date that has arrived: the purge's business, not a warning's.
   */
  readonly daysLeft: number | null
  /** The recordings that are `ready` (a recording being processed cannot be decided or heard). */
  readonly recordings: readonly { readonly status: PhotoStatus }[]
  /** `isVoiceOpen` for the event: the secret is lifted. */
  readonly secretLifted: boolean
}

export const voicesAtRisk = ({
  daysLeft,
  recordings,
  secretLifted,
}: VoiceAtRiskInput): VoicesAtRisk => {
  if (!voiceWarningApplies(daysLeft)) return NO_VOICES_AT_RISK
  return {
    secret: secretLifted ? 0 : recordings.filter((voice) => isInAlbum(voice.status)).length,
    pending: recordings.filter((voice) => voice.status === 'pending').length,
  }
}
