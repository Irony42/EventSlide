import { describe, expect, it } from 'vitest'
import { anAlbumExport } from '../../testing/renderWithProviders'
import {
  archiveView,
  BAND_WINDOW_DAYS,
  deleteGate,
  deletionMoment,
  wordMatches,
} from './albumDeletion'

const DAY = 86_400_000
const NOW = new Date(2026, 11, 2, 12, 0, 0).getTime()
const inMs = (ms: number): string => new Date(NOW + ms).toISOString()

describe('deletionMoment', () => {
  it('has no band without a date', () => {
    expect(deletionMoment(null, NOW)).toBeNull()
  })

  it('has the band for an offboarding client whatever the distance', () => {
    expect(deletionMoment(inMs(90 * DAY), NOW, true)).toEqual({ kind: 'days', days: 90 })
    expect(deletionMoment(inMs(90 * DAY), NOW, false)).toBeNull()
    expect(deletionMoment(null, NOW, true)).toBeNull()
  })

  it('has no band for a date that cannot be read', () => {
    expect(deletionMoment('later', NOW)).toBeNull()
  })

  it('has a band at the window’s edge and none beyond it', () => {
    expect(BAND_WINDOW_DAYS).toBe(30)
    expect(deletionMoment(inMs(30 * DAY), NOW)).toEqual({ kind: 'days', days: 30 })
    expect(deletionMoment(inMs(30 * DAY + 1), NOW)).toBeNull()
  })

  it('rounds a part of a day up: a day and an hour is two days, never one', () => {
    expect(deletionMoment(inMs(DAY + 3_600_000), NOW)).toEqual({ kind: 'days', days: 2 })
    expect(deletionMoment(inMs(DAY), NOW)).toEqual({ kind: 'days', days: 1 })
  })

  it('says today for a date later on the same day, and passed from the instant it arrives', () => {
    expect(deletionMoment(inMs(2 * 3_600_000), NOW)).toEqual({ kind: 'today' })
    expect(deletionMoment(inMs(0), NOW)).toEqual({ kind: 'passed' })
    expect(deletionMoment(inMs(-5 * DAY), NOW)).toEqual({ kind: 'passed' })
  })

  it('says in one day, not today, for the same hour tomorrow', () => {
    expect(deletionMoment(inMs(23 * 3_600_000), NOW)).toEqual({ kind: 'days', days: 1 })
  })
})

describe('archiveView', () => {
  it('waits for the read, and knows there is none', () => {
    expect(archiveView(null)).toEqual({ kind: 'loading' })
    expect(archiveView('none')).toEqual({ kind: 'none' })
  })

  it.each(['queued', 'running'] as const)('is working while %s', (status) => {
    expect(archiveView(anAlbumExport({ status }))).toEqual({ kind: 'working' })
  })

  it('counts the files a sealed archive lacks, and when it was sent', () => {
    const archive = anAlbumExport({ skipped: 3, servedAt: '2026-12-02T14:21:00.000Z' })

    expect(archiveView(archive)).toEqual({
      kind: 'ready',
      archive,
      missing: 3,
      sentAt: '2026-12-02T14:21:00.000Z',
    })
  })

  it('separates what a removal voided from what a reopening did', () => {
    expect(archiveView(anAlbumExport({ status: 'stale', staleReason: 'photoRemoved' }))).toEqual({
      kind: 'retired',
    })
    expect(archiveView(anAlbumExport({ status: 'stale', staleReason: 'guestErased' }))).toEqual({
      kind: 'retired',
    })
    expect(archiveView(anAlbumExport({ status: 'stale', staleReason: 'reopened' }))).toEqual({
      kind: 'changed',
    })
    expect(archiveView(anAlbumExport({ status: 'stale', staleReason: 'takenDown' }))).toEqual({
      kind: 'changed',
    })
  })

  it('names the failures that have their own sentence and lumps the rest', () => {
    const failed = (failure: string) => archiveView(anAlbumExport({ status: 'failed', failure }))

    expect(failed('noRoom')).toEqual({ kind: 'failed', cause: 'noRoom' })
    expect(failed('tooLarge')).toEqual({ kind: 'failed', cause: 'tooLarge' })
    expect(failed('corrupt')).toEqual({ kind: 'failed', cause: 'other' })
  })
})

describe('deleteGate', () => {
  it('changes nothing when no band is on the page', () => {
    expect(deleteGate(false, null)).toEqual({ kind: 'open' })
    expect(deleteGate(false, 'none')).toEqual({ kind: 'open' })
  })

  it('goes straight to the confirmation when the server says so', () => {
    expect(deleteGate(true, anAlbumExport({ canDeleteWithoutConfirmation: true }))).toEqual({
      kind: 'open',
    })
  })

  it('asks for the word, and says what is missing', () => {
    expect(deleteGate(true, null)).toEqual({ kind: 'word', because: 'needsArchive' })
    expect(deleteGate(true, 'none')).toEqual({ kind: 'word', because: 'needsArchive' })
    expect(deleteGate(true, anAlbumExport({ status: 'running' }))).toEqual({
      kind: 'word',
      because: 'needsArchive',
    })
    expect(deleteGate(true, anAlbumExport())).toEqual({ kind: 'word', because: 'needsDownload' })
    expect(deleteGate(true, anAlbumExport({ skipped: 1 }))).toEqual({
      kind: 'word',
      because: 'needsComplete',
    })
  })

  it('does not take its own view of what the server decided: a sent archive the server refuses stays closed', () => {
    const sentButRefused = anAlbumExport({
      servedAt: '2026-12-02T14:21:00.000Z',
      canDeleteWithoutConfirmation: false,
    })

    expect(deleteGate(true, sentButRefused).kind).toBe('word')
  })
})

describe('wordMatches', () => {
  it('ignores case and every space', () => {
    expect(wordMatches(' supp rimer ', 'SUPPRIMER')).toBe(true)
    expect(wordMatches('Supprimer', 'SUPPRIMER')).toBe(true)
  })

  it('refuses another word, a part of it and nothing at all', () => {
    expect(wordMatches('supprim', 'SUPPRIMER')).toBe(false)
    expect(wordMatches('supprimers', 'SUPPRIMER')).toBe(false)
    expect(wordMatches('', 'SUPPRIMER')).toBe(false)
    expect(wordMatches('   ', '')).toBe(false)
  })
})
