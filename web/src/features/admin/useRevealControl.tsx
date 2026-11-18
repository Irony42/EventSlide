import { useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { useToast } from '../../design-system/components/useToast'
import { formatTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { serverNowFrom, serverOffsetMs } from '../../lib/serverClock'
import type { EventDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'
import { useRevealEvent } from './hooks/useEventActions'
import { revealBandOf, type RevealBand } from './revealBand'

export interface RevealControlOptions {
  /** `null` while the page has no event yet. */
  readonly event: EventDto | null
  /** The event as the server answered "Révéler maintenant": the page's own copy is replaced. */
  readonly onChanged: (event: EventDto) => void
  /** Read the event again: at the hour nothing is announced, so the band asks. */
  readonly onReload: () => void
}

/**
 * What the console's reveal controls share (spec 23, 23b): the band as the server's clock reads it,
 * and the one way to ask for "Révéler maintenant". One value for the banner at the top and the
 * section lower down, so there is one clock, one confirmation and one request rather than two copies.
 */
export interface RevealControl {
  /** `null` when the mode is off or the server did not say: nothing to draw. */
  readonly band: RevealBand | null
  /** The server's clock less this machine's, as of the last read of the event. */
  readonly offsetMs: number
  /** This machine's clock as of the last tick. */
  readonly now: number
  /** The reveal call is in the air. */
  readonly busy: boolean
  /** Opens the confirmation; the call goes only once the host confirms it. */
  readonly request: () => void
  /** The confirmation itself, rendered once on the page: every button that asks opens this one. */
  readonly dialog: ReactNode
}

/** This machine's clock. A named read: the control decides when to ask. */
const localNow = (): number => Date.now()

/** The band says whole minutes, so a look at the clock every few seconds is plenty. */
const TICK_MS = 5_000

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
 * The console's one reveal state (spec 23, 23b), called once by the page and handed to the banner and
 * the section, which both draw it.
 *
 * **Counts down against the server's clock** (`event.reveal.serverNowMs`, measured when the event was
 * read), never the laptop's. At the hour it reads the event again, because the end of a countdown
 * announces nothing (the reveal is a function of the server's clock, there is no sweep to signal it):
 * once, however many places draw the band. And it owns the confirmation, so the banner's button and
 * the section's are the same question with the same answer and the same call.
 */
export function useRevealControl({
  event,
  onChanged,
  onReload,
}: RevealControlOptions): RevealControl {
  const t = useTranslations()
  const { locale } = useLocale()
  const toast = useToast()
  const reveal = useRevealEvent()
  const [confirming, setConfirming] = useState(false)

  // The gap between this machine's clock and the server's, taken each time the event is read.
  const serverReadAt = event?.reveal?.serverNowMs ?? 0
  const [anchor, setAnchor] = useState(() => ({ server: serverReadAt, local: localNow() }))
  if (anchor.server !== serverReadAt) {
    setAnchor({ server: serverReadAt, local: localNow() })
  }
  const offsetMs = serverOffsetMs(anchor.server, anchor.local, anchor.local)

  const [now, setNow] = useState(localNow)
  const band = event === null ? null : revealBandOf(event, serverNowFrom(now, offsetMs))

  const counting = band?.kind === 'waiting' && band.atMs !== null
  useEffect(() => {
    if (!counting) return undefined
    const timer = setInterval(() => setNow(localNow()), TICK_MS)
    return () => clearInterval(timer)
  }, [counting])

  // The hour has come by the clock the page measured: ask the server what it says.
  const due = band?.kind === 'revealed' && event?.reveal?.revealed === false
  useEffect(() => {
    if (due) onReload()
  }, [due, onReload])

  const confirm = () => {
    if (event === null) return
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

  const dialog =
    band === null ? null : (
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
    )

  return { band, offsetMs, now, busy: reveal.busy, request: () => setConfirming(true), dialog }
}
