import type { AlbumExportDto } from '../../lib/api/dto'

/**
 * What the event page says about the album's deletion and its archive (spec 22), as plain functions.
 *
 * View-state only, no rule of the product: whether an album may be deleted without typing the word is
 * the server's verdict (`canDeleteWithoutConfirmation`, the domain's `canDeleteWithoutConfirmation`),
 * carried on the archive's answer. What is decided here is which **sentence** the page shows for the
 * state it was handed, and when the band appears at all.
 */

const DAY_MS = 86_400_000

/** The band is on the page from this many days before the album's date, and not before. */
export const BAND_WINDOW_DAYS = 30

export type DeletionMoment =
  | { readonly kind: 'passed' }
  | { readonly kind: 'today' }
  | { readonly kind: 'days'; readonly days: number }

const sameLocalDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() === new Date(b).toDateString()

/**
 * Where the album's date is, measured on the **server's** clock (`serverNowMs`): `null` when there is
 * no band (no date: a live event or an album kept until a person deletes it; or a date further than
 * {@link BAND_WINDOW_DAYS} away, unless the client is being offboarded), otherwise how far it is. A date in the past is `passed` and nothing
 * more: the page never says why the album is still there.
 */
export const deletionMoment = (
  at: string | null,
  serverNowMs: number,
  offboarding = false,
): DeletionMoment | null => {
  if (at === null) return null
  const atMs = Date.parse(at)
  if (!Number.isFinite(atMs)) return null

  const left = atMs - serverNowMs
  // A client being offboarded is told its date from the first day, however far it is.
  if (left > BAND_WINDOW_DAYS * DAY_MS && !offboarding) return null
  if (left <= 0) return { kind: 'passed' }
  if (left < DAY_MS && sameLocalDay(atMs, serverNowMs)) return { kind: 'today' }
  return { kind: 'days', days: Math.max(1, Math.ceil(left / DAY_MS)) }
}

/** What the archive's read says, once it is reduced to what a sentence needs. */
export type AlbumExportRead = AlbumExportDto | 'none'

export type ArchiveView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'working' }
  | {
      readonly kind: 'ready'
      readonly archive: AlbumExportDto
      /** Files that were missing from the server's disk: not in the archive. */
      readonly missing: number
      /** A complete `200` reached the socket after the archive was sealed. */
      readonly sentAt: string | null
    }
  | { readonly kind: 'retired' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'failed'; readonly cause: 'noRoom' | 'tooLarge' | 'other' }

/** The stale reasons that say a photograph was removed: the archive would still hold it. */
const REMOVAL_REASONS: readonly (string | null)[] = [
  'photoRemoved',
  'guestErased',
  'guestbookChanged',
]

export const archiveView = (read: AlbumExportRead | null): ArchiveView => {
  if (read === null) return { kind: 'loading' }
  if (read === 'none') return { kind: 'none' }
  switch (read.status) {
    case 'queued':
    case 'running':
      return { kind: 'working' }
    case 'stale':
      return REMOVAL_REASONS.includes(read.staleReason) ? { kind: 'retired' } : { kind: 'changed' }
    case 'failed':
      return {
        kind: 'failed',
        cause:
          read.failure === 'noRoom' ? 'noRoom' : read.failure === 'tooLarge' ? 'tooLarge' : 'other',
      }
    case 'sealed':
      return {
        kind: 'ready',
        archive: read,
        missing: read.skipped ?? 0,
        // Sent in full after sealing: the server stamps `servedAt` only for a whole `200`, and the
        // domain's verdict below is the one that decides what that allows.
        sentAt: read.servedAt,
      }
  }
}

/** Why "Supprimer maintenant" is not available yet: the sentence the disabled button points at. */
export type DeleteBlock = 'needsArchive' | 'needsDownload' | 'needsComplete'

export type DeleteGate =
  { readonly kind: 'open' } | { readonly kind: 'word'; readonly because: DeleteBlock }

/**
 * Whether the early deletion goes straight to its confirmation, or asks for the word first.
 *
 * Without a band (no date within reach, so no archive on the page) nothing changes: the existing
 * dialog and its address. With one, the server's verdict decides, and until the archive has been read
 * the answer is the cautious one.
 */
export const deleteGate = (bandShown: boolean, read: AlbumExportRead | null): DeleteGate => {
  if (!bandShown) return { kind: 'open' }
  if (read !== null && read !== 'none' && read.canDeleteWithoutConfirmation) return { kind: 'open' }
  if (read !== null && read !== 'none' && read.status === 'sealed') {
    return {
      kind: 'word',
      because: (read.skipped ?? 0) > 0 ? 'needsComplete' : 'needsDownload',
    }
  }
  return { kind: 'word', because: 'needsArchive' }
}

/** Typed word against the expected one, ignoring case and every space. */
export const wordMatches = (typed: string, word: string): boolean => {
  const squash = (value: string): string => value.replace(/\s+/gu, '').toLowerCase()
  return squash(typed).length > 0 && squash(typed) === squash(word)
}
