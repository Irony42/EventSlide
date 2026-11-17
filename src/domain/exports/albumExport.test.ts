import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../shared/ids'
import {
  archiveStateOf,
  canDeleteWithoutConfirmation,
  finishOfExport,
  invalidateExport,
  requestExport,
  serveExport,
  settleExport,
  startExport,
  type AlbumExport,
  type ExportSeal,
} from './albumExport'

const EVENT = asEventId('evt-1')
const T = new Date('2026-12-01T10:00:00Z')
const at = (minutes: number): Date => new Date(T.getTime() + minutes * 60_000)

const SEAL: ExportSeal = {
  entries: 3,
  skipped: 0,
  bytes: 900,
  sha256: 'b'.repeat(64),
  expiresAt: at(10_000),
}

const must = <V>(result: { ok: boolean; value?: V }): V => {
  if (!result.ok || result.value === undefined) throw new Error('expected an ok result')
  return result.value
}

const queued = (): AlbumExport => requestExport(EVENT, asUserId('u1'), at(0))
const running = (): AlbumExport => must(startExport(queued(), at(1)))
const sealed = (overrides: Partial<AlbumExport> = {}): AlbumExport => ({
  ...must(settleExport(running(), { kind: 'sealed', seal: SEAL }, at(2))),
  ...overrides,
})

describe('requestExport', () => {
  it('starts from nothing: queued, no figures, no digest, never served', () => {
    expect(queued()).toEqual({
      eventId: EVENT,
      status: 'queued',
      requestedAt: at(0),
      requestedBy: 'u1',
      startedAt: null,
      sealedAt: null,
      expiresAt: null,
      entries: null,
      skipped: null,
      bytes: null,
      sha256: null,
      servedAt: null,
      staleReason: null,
      invalidatedAt: null,
      failure: null,
    })
  })
})

describe('startExport', () => {
  it('moves a queued archive to running and stamps the start', () => {
    expect(running()).toMatchObject({ status: 'running', startedAt: at(1) })
  })

  it('refuses a second claim of a running archive', () => {
    const second = startExport(running(), at(2))

    expect(!second.ok && second.error.code).toBe('export.illegalTransition')
  })
})

describe('settleExport', () => {
  it('seals a running archive with the seal and the instant', () => {
    expect(sealed()).toMatchObject({
      status: 'sealed',
      sealedAt: at(2),
      entries: 3,
      skipped: 0,
      bytes: 900,
      sha256: 'b'.repeat(64),
      expiresAt: at(10_000),
    })
  })

  it('records a failure with its code', () => {
    const failed = must(settleExport(running(), { kind: 'failed', code: 'corrupt' }, at(2)))

    expect(failed).toMatchObject({ status: 'failed', failure: 'corrupt' })
  })

  it('records a stale verdict with its reason', () => {
    const stale = must(settleExport(running(), { kind: 'stale', reason: 'albumChanged' }, at(2)))

    expect(stale).toMatchObject({ status: 'stale', staleReason: 'albumChanged' })
  })

  it.each([
    ['sealed', { kind: 'sealed', seal: SEAL }],
    ['failed', { kind: 'failed', code: 'noRoom' }],
    ['stale', { kind: 'stale', reason: 'albumChanged' }],
  ] as const)('refuses a %s verdict for a row that is not running', (_name, verdict) => {
    const result = settleExport(queued(), verdict, at(2))

    expect(!result.ok && result.error.code).toBe('export.illegalTransition')
  })

  it('makes it stale, not sealed, when a removal landed after the write started', () => {
    const voided = invalidateExport(running(), 'guestErased', at(2))

    const settled = must(settleExport(voided, { kind: 'sealed', seal: SEAL }, at(3)))

    expect(settled).toMatchObject({ status: 'stale', staleReason: 'guestErased', sha256: null })
  })

  it('counts a removal stamped in the very instant the write started as a removal', () => {
    const voided = invalidateExport(running(), 'photoRemoved', at(1))

    const settled = must(settleExport(voided, { kind: 'sealed', seal: SEAL }, at(3)))

    expect(settled.status).toBe('stale')
  })

  it('does not hold against the archive a removal that was recorded before the write started', () => {
    const before = invalidateExport(queued(), 'photoRemoved', at(0))
    const started = must(startExport(before, at(1)))

    const settled = must(settleExport(started, { kind: 'sealed', seal: SEAL }, at(3)))

    expect(settled.status).toBe('sealed')
  })

  it('falls back to photoRemoved when the voiding fact left no reason', () => {
    const voided: AlbumExport = { ...running(), invalidatedAt: at(2), staleReason: null }

    const settled = must(settleExport(voided, { kind: 'sealed', seal: SEAL }, at(3)))

    expect(settled.staleReason).toBe('photoRemoved')
  })
})

describe('finishOfExport', () => {
  it.each(['sealed', 'stale', 'failed'] as const)('reports a %s row as itself', (status) => {
    expect(finishOfExport({ ...queued(), status })).toBe(status)
  })

  it.each(['queued', 'running'] as const)('reports a %s row as superseded', (status) => {
    expect(finishOfExport({ ...queued(), status })).toBe('superseded')
  })
})

describe('invalidateExport', () => {
  it('voids a sealed archive at once, with the instant and the reason', () => {
    expect(invalidateExport(sealed(), 'takenDown', at(5))).toMatchObject({
      status: 'stale',
      invalidatedAt: at(5),
      staleReason: 'takenDown',
    })
  })

  it.each(['queued', 'running'] as const)('only records the instant for a %s archive', (status) => {
    const archive = { ...queued(), status }

    expect(invalidateExport(archive, 'reopened', at(5))).toEqual({
      ...archive,
      invalidatedAt: at(5),
      staleReason: 'reopened',
    })
  })

  it.each(['stale', 'failed'] as const)('leaves a %s archive exactly as it was', (status) => {
    const archive = { ...queued(), status }

    expect(invalidateExport(archive, 'reopened', at(5))).toBe(archive)
  })
})

describe('serveExport', () => {
  it('stamps the send and moves the expiry of a sealed archive', () => {
    expect(must(serveExport(sealed(), at(7), at(9)))).toMatchObject({
      servedAt: at(7),
      expiresAt: at(9),
    })
  })

  it.each(['queued', 'running', 'stale', 'failed'] as const)(
    'refuses to mark a %s archive as served',
    (status) => {
      const result = serveExport({ ...queued(), status }, at(7), at(9))

      expect(!result.ok && result.error.code).toBe('export.illegalTransition')
    },
  )
})

describe('canDeleteWithoutConfirmation (spec 22, rule 4)', () => {
  const served = (overrides: Partial<AlbumExport> = {}): AlbumExport =>
    sealed({ servedAt: at(3), ...overrides })

  it('allows it for a complete archive sent in full after it was sealed', () => {
    expect(canDeleteWithoutConfirmation(served())).toBe(true)
  })

  it('allows it when the send is in the very instant of the seal', () => {
    expect(canDeleteWithoutConfirmation(served({ servedAt: at(2) }))).toBe(true)
  })

  it('refuses it when files were missing from the disk', () => {
    expect(canDeleteWithoutConfirmation(served({ skipped: 2 }))).toBe(false)
  })

  it('refuses it when the send is older than the seal', () => {
    expect(canDeleteWithoutConfirmation(served({ servedAt: at(1) }))).toBe(false)
  })

  it('refuses it when the archive was never sent', () => {
    expect(canDeleteWithoutConfirmation(sealed())).toBe(false)
  })

  it.each(['stale', 'queued', 'running', 'failed'] as const)(
    'refuses it for a %s archive, whatever else it says',
    (status) => {
      expect(canDeleteWithoutConfirmation(served({ status }))).toBe(false)
    },
  )

  it('refuses it when there is no archive', () => {
    expect(canDeleteWithoutConfirmation(null)).toBe(false)
  })

  it('refuses it when the figures were never written', () => {
    expect(canDeleteWithoutConfirmation(served({ skipped: null }))).toBe(false)
    expect(canDeleteWithoutConfirmation(served({ sealedAt: null }))).toBe(false)
  })
})

describe('archiveStateOf (the purge log)', () => {
  it('is none when no archive was ever prepared, and for work that never finished', () => {
    expect(archiveStateOf(null)).toBe('none')
    expect(archiveStateOf(queued())).toBe('none')
    expect(archiveStateOf(running())).toBe('none')
    expect(archiveStateOf({ ...queued(), status: 'failed' })).toBe('none')
  })

  it('is stale for an archive withdrawn because the album changed', () => {
    expect(archiveStateOf({ ...queued(), status: 'stale' })).toBe('stale')
  })

  it('is sealed for an archive that was never sent in full', () => {
    expect(archiveStateOf(sealed())).toBe('sealed')
    expect(archiveStateOf(sealed({ servedAt: at(1) }))).toBe('sealed')
  })

  it('is incomplete when files were missing, even if it was sent', () => {
    expect(archiveStateOf(sealed({ skipped: 1 }))).toBe('incomplete')
    expect(archiveStateOf(sealed({ skipped: 1, servedAt: at(3) }))).toBe('incomplete')
  })

  it('is served for a complete archive sent in full', () => {
    expect(archiveStateOf(sealed({ servedAt: at(3) }))).toBe('served')
  })

  it('is sealed, not incomplete, when the figure was never written', () => {
    expect(archiveStateOf(sealed({ skipped: null }))).toBe('sealed')
  })
})
