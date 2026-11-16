import { DISCREET_GAP_MS, type AnnouncementKind } from './announcementRules'

/**
 * Where an announcement is in time, what the public wall may be told of it, and when two of them
 * collide (spec 21, rules 5 to 7 and 20).
 *
 * **Time is derived, never ticked.** Nothing on the server fires when an announcement starts or
 * ends: no timer, no job, no write. The wall is handed the three integers and the server's clock
 * and works the phase out for itself, so a restart in the middle changes nothing and two
 * projectors agree to the second.
 */

/** What every function here needs of an announcement: the aggregate satisfies it. */
export interface AnnouncementTiming {
  readonly kind: AnnouncementKind
  readonly at: Date
  readonly durationSeconds: number
  readonly countdownSeconds: number
}

export type AnnouncementPhase =
  | { readonly phase: 'upcoming' }
  | { readonly phase: 'counting'; readonly remainingMs: number }
  | { readonly phase: 'showing'; readonly remainingMs: number }
  | { readonly phase: 'over' }

/**
 * `upcoming` before the countdown starts, `counting` from `at - countdown` to `at` (never, for a
 * zero countdown), `showing` from `at` for `duration`, `over` from `at + duration` on. Every
 * boundary belongs to the later phase.
 */
export const announcementPhaseAt = (
  announcement: Pick<AnnouncementTiming, 'at' | 'durationSeconds' | 'countdownSeconds'>,
  nowMs: number,
): AnnouncementPhase => {
  const atMs = announcement.at.getTime()
  const countingFromMs = atMs - announcement.countdownSeconds * 1000
  const endsMs = atMs + announcement.durationSeconds * 1000

  if (nowMs < countingFromMs) return { phase: 'upcoming' }
  if (nowMs < atMs) return { phase: 'counting', remainingMs: atMs - nowMs }
  if (nowMs < endsMs) return { phase: 'showing', remainingMs: endsMs - nowMs }
  return { phase: 'over' }
}

/**
 * How long before the countdown starts the text may leave the server (rule 6). `/wall` is
 * public and has no principal: a surprise ("Demande en mariage à 22 h") must not be readable on
 * the wall's URL at six in the evening.
 */
export const TEXT_LEAD_MS = 60_000

/** How long before the first apparition the wall is told to read again. */
export const READ_LEAD_MS = 30_000

/** The longest the wall goes without reading again while an announcement is pending. */
export const MAX_READ_INTERVAL_MS = 15 * 60_000

/**
 * The announcements whose text the wall may be given at `nowMs`: from {@link TEXT_LEAD_MS} before
 * the countdown starts (before it, **nothing**, not even an identifier) until the end. Ordered by
 * time, then by id, so every reader sees the same list.
 */
export const visibleAnnouncements = <T extends AnnouncementTiming & { readonly id: string }>(
  rows: readonly T[],
  nowMs: number,
): T[] =>
  rows
    .filter((row) => {
      const atMs = row.at.getTime()
      const opensMs = atMs - row.countdownSeconds * 1000 - TEXT_LEAD_MS
      return nowMs >= opensMs && nowMs < atMs + row.durationSeconds * 1000
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/**
 * When the wall should read again, or `null` when no announcement is still to come or on screen.
 *
 * The earlier of {@link MAX_READ_INTERVAL_MS} from now (it re-measures the clock offset, and the
 * server never says to the minute when the next announcement is) and {@link READ_LEAD_MS} before
 * the first apparition of an announcement whose text is not served yet. That moment falls inside
 * the text window, so the read brings the text with half a minute to spare.
 */
export const nextReadAtMs = (rows: readonly AnnouncementTiming[], nowMs: number): number | null => {
  let pending = false
  let next = nowMs + MAX_READ_INTERVAL_MS

  for (const row of rows) {
    const atMs = row.at.getTime()
    if (nowMs >= atMs + row.durationSeconds * 1000) continue
    pending = true

    const apparitionMs = atMs - row.countdownSeconds * 1000
    if (nowMs < apparitionMs - TEXT_LEAD_MS) next = Math.min(next, apparitionMs - READ_LEAD_MS)
  }

  return pending ? next : null
}

/**
 * The span an announcement keeps to itself among those **of its kind** (rule 7): a fullscreen
 * card `[at, at + duration)`, a discreet one `[at, at + duration + 60 s)` so two are never
 * chained into a bar that never goes away (rule 20).
 */
export const occupiedSpan = (
  announcement: AnnouncementTiming,
): { readonly fromMs: number; readonly toMs: number } => {
  const fromMs = announcement.at.getTime()
  const gap = announcement.kind === 'discreet' ? DISCREET_GAP_MS : 0
  return { fromMs, toMs: fromMs + announcement.durationSeconds * 1000 + gap }
}

/**
 * Whether two announcements collide. Only two of the **same kind** can: a fullscreen card may
 * cover a discreet one, they are different layers. Spans are half-open, so a card that starts
 * the second the previous one ends is fine.
 */
export const announcementsOverlap = (a: AnnouncementTiming, b: AnnouncementTiming): boolean => {
  if (a.kind !== b.kind) return false
  const first = occupiedSpan(a)
  const second = occupiedSpan(b)
  return first.fromMs < second.toMs && second.fromMs < first.toMs
}

/**
 * How far back the wall's read goes, and how many rows it takes: the longest a discreet
 * announcement stays (30 minutes) plus the minute of gap that follows it, and a handful of rows,
 * so the query a public endpoint can provoke is bounded here and not by a request.
 */
export const WALL_LOOKBACK_MS = 31 * 60_000
export const WALL_READ_LIMIT = 20

/**
 * Whether an announcement **of this kind**, other than `exceptId`, is on screen at `nowMs`: the
 * reason a launch is refused with `announcement.showing` (rule 12) rather than with an overlap.
 */
export const anotherShowing = (
  rows: readonly (AnnouncementTiming & { readonly id: string })[],
  kind: AnnouncementKind,
  nowMs: number,
  exceptId: string | null,
): boolean =>
  rows.some(
    (row) =>
      row.kind === kind &&
      row.id !== exceptId &&
      announcementPhaseAt(row, nowMs).phase === 'showing',
  )
