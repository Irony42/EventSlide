import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Notice } from '../../design-system/components/Notice'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime, formatTime } from '../../lib/format'
import type { Locale } from '../../lib/i18n/locale'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { serverNowFrom, serverOffsetMs } from '../../lib/serverClock'
import type { EventDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'
import { useRevealEvent } from './hooks/useEventActions'
import { countdownParts, revealBandOf, type RevealBand } from './revealBand'
import styles from './RevealPanel.module.css'

export interface RevealPanelProps {
  readonly event: EventDto
  /** The event as the server answered "Révéler maintenant": the page's own copy is replaced. */
  readonly onChanged: (event: EventDto) => void
  /** Read the event again: at the hour nothing is announced, so the band asks. */
  readonly onReload: () => void
  /** The settings page, where the owner moves the hour; a moderator has no such page. */
  readonly settingsPath: string | null
}

/** This machine's clock. A named read: the panel decides when to ask. */
const localNow = (): number => Date.now()

/** The band says whole minutes, so a look at the clock every few seconds is plenty. */
const TICK_MS = 5_000

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
 * What pressing the button does, in the host's words: how many published photographs appear, how
 * many still wait for a decision and stay hidden, and that it cannot be taken back.
 */
const confirmationOf = (
  band: Extract<RevealBand, { kind: 'waiting' }> | null,
  text: UiText,
): string => {
  const pending =
    band !== null && band.pendingCount > 0
      ? ' ' + text.reveal.confirmPending(band.pendingCount)
      : ''
  return (
    text.reveal.confirmPublished(band?.readyCount ?? 0) + pending + ' ' + text.reveal.definitive
  )
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
export function RevealPanel({ event, onChanged, onReload, settingsPath }: RevealPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const toast = useToast()
  const reveal = useRevealEvent()
  const [confirming, setConfirming] = useState(false)

  // The gap between this machine's clock and the server's, taken each time the event is read.
  const serverReadAt = event.reveal?.serverNowMs ?? 0
  const [anchor, setAnchor] = useState(() => ({ server: serverReadAt, local: localNow() }))
  if (anchor.server !== serverReadAt) {
    setAnchor({ server: serverReadAt, local: localNow() })
  }
  const offsetMs = serverOffsetMs(anchor.server, anchor.local, anchor.local)

  const [now, setNow] = useState(localNow)
  const band = revealBandOf(event, serverNowFrom(now, offsetMs))

  const counting = band?.kind === 'waiting' && band.atMs !== null
  useEffect(() => {
    if (!counting) return undefined
    const timer = setInterval(() => setNow(localNow()), TICK_MS)
    return () => clearInterval(timer)
  }, [counting])

  // The hour has come by the clock the page measured: ask the server what it says.
  const due = band?.kind === 'revealed' && event.reveal?.revealed === false
  useEffect(() => {
    if (due) onReload()
  }, [due, onReload])

  if (band === null) return null

  const confirm = () => {
    void reveal.run('reveal', event.slug).then((result) => {
      setConfirming(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      onChanged(result.value)
      const at = result.value.reveal?.atMs
      const time = at === undefined || at === null ? null : formatTime(at, locale)
      toast.show(time === null ? t.reveal.title : t.reveal.revealedAt(time), { tone: 'success' })
    })
  }

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
              <Button
                variant="primary"
                loading={reveal.busy}
                onClick={() => setConfirming(true)}
                aria-haspopup="dialog"
              >
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

      <ConfirmDialog
        open={confirming}
        title={t.reveal.confirmTitle}
        description={confirmationOf(band.kind === 'waiting' ? band : null, t)}
        confirmLabel={t.reveal.revealNow}
        confirmVariant="primary"
        busy={reveal.busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  )
}
