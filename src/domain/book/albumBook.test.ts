import { describe, expect, it } from 'vitest'
import { asEventId } from '../shared/ids'
import type { BookPlan } from './bookPlan'
import {
  failBook,
  finishBook,
  finishOf,
  invalidateBook,
  requestBook,
  settleBook,
  recordPlan,
  startBook,
  type AlbumBook,
  type BookOptions,
  type BookResult,
} from './albumBook'

const OPTIONS: BookOptions = {
  title: 'Mariage',
  subtitle: '',
  language: 'fr',
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: true,
  showCaptions: true,
  includeGuestbook: false,
  printVersion: false,
  timeZone: 'Europe/Paris',
}
const T0 = new Date('2026-11-01T10:00:00Z')
const T1 = new Date('2026-11-01T10:05:00Z')
const T2 = new Date('2026-11-01T10:10:00Z')
const RESULT: BookResult = {
  photoCount: 3,
  skippedCount: 1,
  pageCount: 5,
  byteSize: 900,
  selectedCount: 3,
  printByteSize: null,
  printSkipped: null,
  expiresAt: new Date('2026-11-08T10:00:00Z'),
}
const queued = requestBook(asEventId('e1'), OPTIONS, T0)
const unwrap = (r: { ok: boolean; value?: AlbumBook }): AlbumBook => {
  if (!r.ok || r.value === undefined) throw new Error('expected ok')
  return r.value
}
const running = unwrap(startBook(queued, T1))

describe('album book moves', () => {
  it('starts queued, frozen at the request instant, with nothing measured', () => {
    expect(queued).toMatchObject({
      status: 'queued',
      snapshotAt: T0,
      requestedAt: T0,
      photoCount: null,
    })
  })
  it('claims a queued book and refuses to claim a running one', () => {
    expect(running).toMatchObject({ status: 'running', startedAt: T1 })
    expect(startBook(running, T2).ok).toBe(false)
  })
  it('finishes a running book as done with its measures', () => {
    const done = unwrap(finishBook(running, RESULT, T2))
    expect(done).toMatchObject({ status: 'done', doneAt: T2, photoCount: 3, byteSize: 900 })
  })
  it('refuses to finish a book that is not running', () => {
    expect(finishBook(queued, RESULT, T2).ok).toBe(false)
  })
  it('finishes as stale, never done, when a fact voided it after the render started', () => {
    const voided = invalidateBook(running, 'photoRemoved', T2)
    const finished = unwrap(finishBook(voided, RESULT, T2))
    expect(finished).toMatchObject({ status: 'stale', staleReason: 'photoRemoved', doneAt: null })
  })
  it('finishes as stale when the fact is stamped at the very instant the render started', () => {
    const voided = invalidateBook(running, 'captionChanged', T1)
    expect(unwrap(finishBook(voided, RESULT, T2)).status).toBe('stale')
  })
  it('finishes as done when the fact predates the render', () => {
    const before: AlbumBook = { ...queued, invalidatedAt: new Date(T0.getTime() - 1) }
    const started = unwrap(startBook(before, T1))
    expect(unwrap(finishBook(started, RESULT, T2)).status).toBe('done')
  })
  it('defaults the stale reason when the voided book carries none', () => {
    const voided: AlbumBook = { ...running, invalidatedAt: T2, staleReason: null }
    expect(unwrap(finishBook(voided, RESULT, T2)).staleReason).toBe('photoRemoved')
  })
  it('fails a running book with a closed code, and only a running one', () => {
    expect(unwrap(failBook(running, 'tooLarge'))).toMatchObject({
      status: 'failed',
      failureCode: 'tooLarge',
    })
    expect(failBook(queued, 'unexpected').ok).toBe(false)
  })
})

const PLAN: BookPlan = {
  chapters: [],
  pages: [{ template: 'title', slots: [] }],
  selectedCount: 3,
  counts: { photos: 3, photographers: 1, hearts: 0, messages: 0, voices: 0, videos: 0 },
  includedMessages: 0,
  extraMessages: 0,
  hearts: {},
  photographers: [],
  favouritesPage: null,
  guestbookPage: null,
}

describe('the plan of a book', () => {
  it('starts with none, and is recorded only on a running book', () => {
    expect(queued.plan).toBeNull()
    expect(unwrap(recordPlan(running, PLAN)).plan).toBe(PLAN)
    expect(recordPlan(queued, PLAN).ok).toBe(false)
    expect(recordPlan(unwrap(finishBook(running, RESULT, T2)), PLAN).ok).toBe(false)
  })
  it('is voided by the fact that voids the book, whatever state the book is in', () => {
    const planned = unwrap(recordPlan(running, PLAN))
    expect(invalidateBook(planned, 'messageRemoved', T2).plan).toBeNull()
    const done = unwrap(finishBook({ ...planned, plan: PLAN }, RESULT, T2))
    expect(done.plan).toBe(PLAN)
    expect(invalidateBook(done, 'messageRemoved', T2)).toMatchObject({
      status: 'stale',
      staleReason: 'messageRemoved',
      plan: null,
    })
    expect(invalidateBook({ ...queued, plan: PLAN }, 'photoRemoved', T1).plan).toBeNull()
  })
  it('is dropped with the file when a fact arrived during the render', () => {
    const planned = unwrap(recordPlan(invalidateBook(running, 'photoRemoved', T2), PLAN))
    expect(unwrap(finishBook({ ...planned, plan: PLAN }, RESULT, T2))).toMatchObject({
      status: 'stale',
      plan: null,
    })
  })
  it('keeps what a printer version measured', () => {
    const done = unwrap(
      finishBook(running, { ...RESULT, printByteSize: 70, printSkipped: 'tooLarge' }, T2),
    )
    expect(done).toMatchObject({ selectedCount: 3, printByteSize: 70, printSkipped: 'tooLarge' })
  })
})

describe('invalidateBook', () => {
  const done = unwrap(finishBook(running, RESULT, T2))
  it('turns a done book stale with the reason and the instant', () => {
    expect(invalidateBook(done, 'photoRemoved', T2)).toMatchObject({
      status: 'stale',
      staleReason: 'photoRemoved',
      invalidatedAt: T2,
    })
  })
  it('only records the fact on a queued or running book', () => {
    expect(invalidateBook(queued, 'photoRemoved', T1)).toMatchObject({
      status: 'queued',
      invalidatedAt: T1,
    })
    expect(invalidateBook(running, 'captionChanged', T2)).toMatchObject({
      status: 'running',
      invalidatedAt: T2,
    })
  })
  it('leaves a stale or failed book exactly as it was (idempotent)', () => {
    const stale = invalidateBook(done, 'photoRemoved', T2)
    expect(invalidateBook(stale, 'captionChanged', T2)).toBe(stale)
    const failed = unwrap(failBook(running, 'unexpected'))
    expect(invalidateBook(failed, 'photoRemoved', T2)).toBe(failed)
  })
})

describe('settleBook', () => {
  it('applies a finished verdict to a running book, and a failed one as a failure', () => {
    expect(unwrap(settleBook(running, { kind: 'finished', result: RESULT }, T2)).status).toBe(
      'done',
    )
    expect(unwrap(settleBook(running, { kind: 'failed', code: 'empty' }, T2))).toMatchObject({
      status: 'failed',
      failureCode: 'empty',
    })
  })

  it('refuses either verdict on a book that is not running', () => {
    expect(settleBook(queued, { kind: 'finished', result: RESULT }, T2).ok).toBe(false)
    expect(settleBook(queued, { kind: 'failed', code: 'empty' }, T2).ok).toBe(false)
  })
})

describe('finishOf', () => {
  it('names what was recorded, and treats a book still in progress as superseded', () => {
    expect(finishOf(unwrap(finishBook(running, RESULT, T2)))).toBe('done')
    expect(finishOf({ ...running, status: 'stale' })).toBe('stale')
    expect(finishOf(unwrap(failBook(running, 'empty')))).toBe('failed')
    expect(finishOf(queued)).toBe('superseded')
    expect(finishOf(running)).toBe('superseded')
  })
})
