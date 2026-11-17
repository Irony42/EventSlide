import type { RevealDto } from './api/dto'
import { formatDateTime, formatTime } from './format'
import { useLocale } from './i18n/useTranslations'
import { countdownParts } from './revealCountdown'
import { useServerCountdown } from './useServerCountdown'

/** What a held evening says about its reveal, in numbers and as the locale writes them. */
export interface RevealWhen {
  /** The hour as an instant, or `null` while the host reveals with the button. */
  readonly atMs: number | null
  /** The hour as a time of day ("23:00"); empty without an hour. */
  readonly time: string
  /** The hour with its day, for a reveal that is not tonight; empty without an hour. */
  readonly dateTime: string
  /** Whether the hour is today by the **server's** clock: "23:00" is then enough. */
  readonly today: boolean
  /** The whole time left, or `null` without an hour. `'soon'` under a minute. */
  readonly left: { readonly hours: number; readonly minutes: number } | 'soon' | null
}

/** An hour no countdown runs on: a reveal by hand has nothing to count down to. */
const NO_HOUR = { id: 'reveal-none', endsAt: new Date(0).toISOString(), state: 'ended' } as const

/**
 * The hour of a reveal and the time left, counted on the server's clock (`offsetMs`, measured at
 * the read) and never on this phone's alone (spec 23): a guest whose clock is five minutes off reads
 * the same countdown as the wall. One render a second while it counts, nothing without an hour, and
 * no live region anywhere: the screen that calls it decides what a screen reader is told.
 */
export const useRevealWhen = (reveal: RevealDto, offsetMs: number): RevealWhen => {
  const { locale } = useLocale()
  const atMs = reveal.atMs
  const { leftMs } = useServerCountdown(
    atMs === null
      ? NO_HOUR
      : { id: `reveal-${atMs}`, endsAt: new Date(atMs).toISOString(), state: 'running' },
    offsetMs,
  )
  if (atMs === null) return { atMs, time: '', dateTime: '', today: false, left: null }
  return {
    atMs,
    time: formatTime(atMs, locale) ?? '',
    dateTime: formatDateTime(new Date(atMs).toISOString(), locale) ?? '',
    today: new Date(atMs).toDateString() === new Date(atMs - leftMs).toDateString(),
    left: countdownParts(leftMs),
  }
}
