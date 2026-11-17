import type { NoticePublication, RevealDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { awaitsReveal } from '../../../lib/revealGate'
import { useRevealWhen } from '../../../lib/useRevealWhen'

export interface GuestIntroProps {
  /** `immediate` is the notice's word for an event that publishes on arrival. */
  readonly publication: NoticePublication | null
  /** The reveal gate as the server last said it, `null` for a server that predates it. */
  readonly reveal: RevealDto | null
  /** The server's clock less this phone's, for the day of the hour. */
  readonly offsetMs: number
  readonly className?: string | undefined
}

/**
 * What the guest is told under the event's name while the evening is held for its reveal (spec 23b).
 * "They will appear on the screen straight away" is false then, so the sentence is the mode's, with
 * the hour when there is one. Alone so the countdown's one-second render touches nothing else.
 */
function HeldIntro({
  reveal,
  offsetMs,
  className,
}: {
  readonly reveal: RevealDto
  readonly offsetMs: number
  readonly className: string | undefined
}) {
  const text = useTranslations()
  const when = useRevealWhen(reveal, offsetMs)
  const line =
    when.atMs === null
      ? text.reveal.guestIntro
      : when.today
        ? text.reveal.guestIntroAt(when.time)
        : text.reveal.guestIntroOn(when.dateTime)
  return (
    <p className={className} data-testid="guest-intro-held">
      {line}
    </p>
  )
}

/**
 * The sentence under the event's name: the mode's while the evening is held for its reveal, and the
 * usual one — chosen from the notice's publication, as before — for every other evening and once the
 * reveal has come.
 */
export function GuestIntro({ publication, reveal, offsetMs, className }: GuestIntroProps) {
  const text = useTranslations()
  if (awaitsReveal(reveal ?? undefined) && reveal !== null) {
    return <HeldIntro reveal={reveal} offsetMs={offsetMs} className={className} />
  }
  return (
    <p className={className}>
      {publication === 'immediate' ? text.upload.introImmediate : text.upload.intro}
    </p>
  )
}
