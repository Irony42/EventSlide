import type { RevealDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { awaitsReveal } from '../../../lib/revealGate'
import { useRevealWhen } from '../../../lib/useRevealWhen'
import styles from './GuestRoll.module.css'

export interface GuestRollProps {
  /** Poses left by the phone's count (`posesLeft`), or `null` with no cap. */
  readonly left: number | null
  /** The roll's size, or `null` with no cap. */
  readonly max: number | null
  /** Whether the guest has not used a pose yet: the roll is then "fresh" rather than counted. */
  readonly fresh: boolean
  /** The reveal gate as the server last said it, `null` for a server that predates it. */
  readonly reveal: RevealDto | null
  /** The server's clock less this phone's, for the countdown. */
  readonly offsetMs: number
}

/**
 * The hour line, alone so the countdown's one-second render touches nothing else on the screen.
 * Not a live region: a countdown read out every minute is noise, and the moment that matters (the
 * photographs being developed) is announced once by the list.
 */
function RevealLine({
  reveal,
  offsetMs,
}: {
  readonly reveal: RevealDto
  readonly offsetMs: number
}) {
  const text = useTranslations()
  const when = useRevealWhen(reveal, offsetMs)
  if (when.atMs === null) {
    return (
      <p className={styles['line']} data-testid="guest-reveal">
        {text.reveal.guestManual}
      </p>
    )
  }
  const at = when.today ? text.reveal.guestAt(when.time) : text.reveal.guestOn(when.dateTime)
  const left =
    when.left === 'soon' || when.left === null
      ? text.reveal.guestSoon
      : text.reveal.guestLeft(when.left.hours, when.left.minutes)
  return (
    <p className={styles['line']} data-testid="guest-reveal">
      {at} · {left}
    </p>
  )
}

/**
 * The roll and the hour of a disposable-camera evening, at the top of the upload screen (spec 23).
 *
 * Text, never an icon alone, at the base size and above the 44 px floor of a tap target (it is not
 * one, but it is read at arm's length in a dark room). Nothing at all with no cap and no hour, and
 * nothing at zero poses: the composer says "Pellicule terminée" there, and saying it twice is noise.
 */
export function GuestRoll({ left, max, fresh, reveal, offsetMs }: GuestRollProps) {
  const text = useTranslations()
  const held = awaitsReveal(reveal ?? undefined)
  const showPoses = left !== null && max !== null && left > 0
  if (!showPoses && !held) return null
  return (
    <section className={styles['roll']} data-testid="guest-roll">
      {showPoses ? (
        <p className={styles['poses']} data-testid="guest-poses">
          {fresh ? text.reveal.freshRoll(max) : text.reveal.poses(left)}
        </p>
      ) : null}
      {held && reveal !== null ? <RevealLine reveal={reveal} offsetMs={offsetMs} /> : null}
    </section>
  )
}
