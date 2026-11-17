import { Button } from '../../design-system/components/Button'
import { formatDateTime, formatTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { countdownParts } from '../../lib/revealCountdown'
import type { RevealControl } from './useRevealControl'
import styles from './RevealBanner.module.css'

export interface RevealBannerProps {
  /** The state the page shares with the section lower down. */
  readonly control: RevealControl
}

/**
 * The reveal at the top of the event page (spec 23b): what the host needs at the hour, without
 * scrolling to the section under the guestbook. "Appareil jetable · Révélation à 22:00 · dans 1 h 33 ·
 * 14 photos attendent", and "Révéler maintenant".
 *
 * It reads the same state as the section (`useRevealControl`): the same `reveal` block, the same clock,
 * the same confirmation and the same call, and no request of its own. Once the evening is revealed it
 * is gone, and the section says when it happened. No live region, for the reason the section has none.
 */
export function RevealBanner({ control }: RevealBannerProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { band, offsetMs, now, busy, request } = control

  if (band === null || band.kind !== 'waiting') return null

  const parts: string[] = [t.reveal.title]
  if (band.atMs === null) {
    parts.push(t.reveal.bannerManual)
  } else {
    // The day only when the hour is not today by the server's clock: "à 22:00" is enough tonight.
    const today = new Date(band.atMs).toDateString() === new Date(now + offsetMs).toDateString()
    parts.push(
      today
        ? t.reveal.guestAt(formatTime(band.atMs, locale) ?? '')
        : t.reveal.guestOn(formatDateTime(new Date(band.atMs).toISOString(), locale) ?? ''),
    )
    const left = band.leftMs === null ? null : countdownParts(band.leftMs)
    if (left !== null) {
      parts.push(
        left === 'soon' ? t.reveal.guestSoon : t.reveal.guestLeft(left.hours, left.minutes),
      )
    }
  }
  if (band.readyCount > 0) parts.push(t.reveal.bannerWaiting(band.readyCount))

  return (
    <section className={styles['banner']} data-testid="reveal-banner">
      <p className={styles['line']}>{parts.join(' · ')}</p>
      <Button variant="primary" loading={busy} onClick={request} aria-haspopup="dialog">
        {t.reveal.revealNow}
      </Button>
    </section>
  )
}
