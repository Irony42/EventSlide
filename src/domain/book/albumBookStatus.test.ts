import { describe, expect, it } from 'vitest'
import {
  ALBUM_BOOK_STATUSES,
  BOOK_FAILURE_CODES,
  BOOK_STALE_REASONS,
  canTransition,
  hasFile,
  isActive,
  isAlbumBookStatus,
  isBookFailureCode,
  isBookStaleReason,
  type AlbumBookStatus,
} from './albumBookStatus'

const ALLOWED: ReadonlyArray<readonly [AlbumBookStatus, AlbumBookStatus]> = [
  ['queued', 'running'],
  ['running', 'queued'],
  ['running', 'done'],
  ['running', 'failed'],
  ['running', 'stale'],
  ['done', 'stale'],
  ['done', 'queued'],
  ['failed', 'queued'],
  ['stale', 'queued'],
]

describe('album book status machine', () => {
  it.each(ALLOWED)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it('refuses every transition that is not listed, a no-op included', () => {
    for (const from of ALBUM_BOOK_STATUSES) {
      for (const to of ALBUM_BOOK_STATUSES) {
        const listed = ALLOWED.some(([a, b]) => a === from && b === to)
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(listed)
      }
    }
  })

  it('treats queued and running as active, and only done as having a file', () => {
    expect(ALBUM_BOOK_STATUSES.filter(isActive)).toEqual(['queued', 'running'])
    expect(ALBUM_BOOK_STATUSES.filter(hasFile)).toEqual(['done'])
  })

  it('recognises its own closed lists and nothing else', () => {
    expect(ALBUM_BOOK_STATUSES.every(isAlbumBookStatus)).toBe(true)
    expect(isAlbumBookStatus('reserved')).toBe(false)
    expect(isAlbumBookStatus(3)).toBe(false)
    expect(BOOK_FAILURE_CODES.every(isBookFailureCode)).toBe(true)
    expect(isBookFailureCode('disk full: /var/x')).toBe(false)
    expect(BOOK_STALE_REASONS.every(isBookStaleReason)).toBe(true)
    expect(isBookStaleReason(undefined)).toBe(false)
  })
})
