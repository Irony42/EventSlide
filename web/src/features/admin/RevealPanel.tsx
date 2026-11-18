import { Link } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { Notice } from '../../design-system/components/Notice'
import { formatDateTime, formatTime } from '../../lib/format'
import type { Locale } from '../../lib/i18n/locale'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { countdownParts } from '../../lib/revealCountdown'
import type { UiText } from '../../lib/i18n/translations'
import type { RevealControl } from './useRevealControl'
import styles from './RevealPanel.module.css'

export interface RevealPanelProps {
  /** The state the page shares with the banner at its top. */
  readonly control: RevealControl
  /** The settings page, where the owner moves the hour; a moderator has no such page. */
  readonly settingsPath: string | null
}

const countdownText = (leftMs: number, text: UiText): string => {
  const parts = countdownParts(leftMs)
  return parts === 'soon' ? text.reveal.soon : text.reveal.countdown(parts.hours, parts.minutes)
}

/** "Révélé à 23:02", with the day when it was not today. */
const revealedLine = (atMs: number | null, serverNowMs: number, locale: Locale, text: UiText) => {
  if (atMs === null) return text.reveal.title
  const sameDay = new Date(atMs).toDateString() === new Date(serverNowMs).toDateString()
  if (sameDay) return text.reveal.revealedAt(formatTime(atMs, locale) ?? '')
  return text.reveal.revealedOn(formatDateTime(new Date(atMs).toISOString(), locale) ?? '')
}

/**
 * The console's reveal band (spec 23): where the evening stands, and "Révéler maintenant".
 *
 * Surface: the host's laptop, and the moderator's at the evening. Same place and same card as the
 * photo challenge, mounted for the owner and for a moderator alike (the server lets both reveal; the
 * owner alone moves the hour, on the settings page).
 *
 * **Counts down against the server's clock** (`event.reveal.serverNowMs`, measured when the event was
 * read), never the laptop's, and **has no live region**: a countdown that spoke every minute would
 * be a screen reader's noise. The reveal itself is announced once, by the toast the host's own press
 * raises. At the hour the band reads the event again, because the end of the countdown announces
 * nothing (the reveal is a function of the server's clock, there is no sweep to signal it).
 */
export function RevealPanel({ control, settingsPath }: RevealPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { band, offsetMs, now, busy, request } = control

  if (band === null) return null

  return (
    <Card as="h2" title={t.reveal.title}>
      <div className={styles['band']}>
        {band.kind === 'revealed' ? (
          <p className={styles['state']}>{revealedLine(band.atMs, now + offsetMs, locale, t)}</p>
        ) : (
          <>
            <p className={styles['state']}>
              {band.leftMs === null ? t.reveal.manual : countdownText(band.leftMs, t)}
            </p>
            {band.atMs === null ? null : (
              <p className={styles['detail']}>
                {t.reveal.scheduledFor(
                  formatDateTime(new Date(band.atMs).toISOString(), locale) ?? '',
                )}
              </p>
            )}
            <p className={styles['detail']}>{t.reveal.waiting(band.readyCount)}</p>

            {band.closedHeld ? (
              <Notice tone="warning" variant="boxed">
                {t.reveal.closedNotRevealed}
              </Notice>
            ) : band.closesBefore ? (
              <Notice tone="warning" variant="boxed">
                {t.reveal.closesBefore}
              </Notice>
            ) : null}

            <div className={styles['actions']}>
              <Button variant="primary" loading={busy} onClick={request} aria-haspopup="dialog">
                {t.reveal.revealNow}
              </Button>
              {settingsPath === null ? null : (
                <Link className={styles['link']} to={settingsPath}>
                  {t.reveal.editTime}
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
