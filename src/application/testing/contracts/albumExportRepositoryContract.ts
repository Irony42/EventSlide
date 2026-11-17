import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  requestExport,
  type AlbumExport,
  type ExportSeal,
} from '../../../domain/exports/albumExport'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { AlbumExportRepository } from '../../ports/albumExportRepository'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const HOST = asUserId('user-host')

/** What the subject must hold for the contract (the SQLite one seeds it). */
export const ALBUM_EXPORT_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userId: 'user-host',
} as const

const T = new Date('2026-12-01T10:00:00.000Z')
const at = (minutes: number): Date => new Date(T.getTime() + minutes * 60_000)

const SEAL: ExportSeal = {
  entries: 12,
  skipped: 0,
  bytes: 4096,
  sha256: 'a'.repeat(64),
  expiresAt: at(60 * 24 * 7),
}

export interface AlbumExportRepositorySubject {
  readonly repo: AlbumExportRepository
  readonly dispose?: () => Promise<void>
}

export const albumExportRepositoryContract = (
  name: string,
  makeSubject: () => Promise<AlbumExportRepositorySubject>,
): void => {
  describe(`AlbumExportRepository contract: ${name}`, () => {
    let repo: AlbumExportRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })
    afterEach(async () => {
      await dispose?.()
    })

    const request = async (eventId = WEDDING, minutes = 0): Promise<AlbumExport> => {
      const archive = requestExport(eventId, HOST, at(minutes))
      await repo.request(archive)
      return archive
    }

    /** Requested, claimed and sealed: the archive a host can download. */
    const seal = async (
      eventId = WEDDING,
      minutes = 0,
      sealed: ExportSeal = SEAL,
    ): Promise<void> => {
      await request(eventId, minutes)
      await repo.claimNext(at(minutes + 1))
      expect(await repo.finish(eventId, { kind: 'sealed', seal: sealed }, at(minutes + 2))).toBe(
        'sealed',
      )
    }

    it('finds nothing for an event that never asked', async () => {
      expect(await repo.find(WEDDING)).toBeNull()
    })

    it('stores a request as queued and answers it back', async () => {
      const archive = await request()

      expect(await repo.find(WEDDING)).toEqual(archive)
      expect((await repo.find(WEDDING))?.status).toBe('queued')
      expect((await repo.find(WEDDING))?.requestedBy).toBe(HOST)
    })

    it('keeps one archive per event: a new request replaces the row', async () => {
      await seal()
      const again = await request(WEDDING, 30)

      expect(await repo.find(WEDDING)).toEqual(again)
      expect((await repo.find(WEDDING))?.sha256).toBeNull()
    })

    it('looks at the oldest queued archive without claiming it', async () => {
      expect(await repo.findNextQueued()).toBeNull()
      await request(GALA, 5)
      await request(WEDDING, 1)

      expect((await repo.findNextQueued())?.eventId).toBe(WEDDING)
      expect((await repo.findNextQueued())?.status).toBe('queued')
    })

    it('claims the oldest queued archive, running, and never the same one twice', async () => {
      await request(GALA, 5)
      await request(WEDDING, 1)

      const first = await repo.claimNext(at(10))
      const second = await repo.claimNext(at(11))
      const third = await repo.claimNext(at(12))

      expect(first?.eventId).toBe(WEDDING)
      expect(first?.status).toBe('running')
      expect(first?.startedAt).toEqual(at(10))
      expect(second?.eventId).toBe(GALA)
      expect(third).toBeNull()
    })

    it('seals a running archive with the figures of the file', async () => {
      await seal()

      const stored = await repo.find(WEDDING)
      expect(stored).toMatchObject({
        status: 'sealed',
        entries: 12,
        skipped: 0,
        bytes: 4096,
        sha256: 'a'.repeat(64),
        servedAt: null,
      })
      expect(stored?.sealedAt).toEqual(at(2))
      expect(stored?.expiresAt).toEqual(SEAL.expiresAt)
    })

    it('records a failure with its closed code', async () => {
      await request()
      await repo.claimNext(at(1))

      expect(await repo.finish(WEDDING, { kind: 'failed', code: 'corrupt' }, at(2))).toBe('failed')

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'failed', failure: 'corrupt' })
    })

    it('records an album that changed under the write as stale, with the reason', async () => {
      await request()
      await repo.claimNext(at(1))

      expect(await repo.finish(WEDDING, { kind: 'stale', reason: 'albumChanged' }, at(2))).toBe(
        'stale',
      )

      expect(await repo.find(WEDDING)).toMatchObject({
        status: 'stale',
        staleReason: 'albumChanged',
      })
    })

    it('refuses a verdict for a row that is not running, and writes nothing', async () => {
      await request()

      expect(await repo.finish(WEDDING, { kind: 'sealed', seal: SEAL }, at(2))).toBe('superseded')
      expect((await repo.find(WEDDING))?.status).toBe('queued')
      expect(await repo.finish(GALA, { kind: 'sealed', seal: SEAL }, at(2))).toBe('superseded')
    })

    it('does not let a build seal a row the host re-requested meanwhile', async () => {
      await request()
      await repo.claimNext(at(1))
      const replacement = await request(WEDDING, 2)

      expect(await repo.finish(WEDDING, { kind: 'sealed', seal: SEAL }, at(3))).toBe('superseded')
      expect(await repo.find(WEDDING)).toEqual(replacement)
    })

    it('turns a build into a stale archive when a removal landed while it ran', async () => {
      await request()
      await repo.claimNext(at(1))
      await repo.invalidate(WEDDING, 'guestErased', at(2))

      expect(await repo.finish(WEDDING, { kind: 'sealed', seal: SEAL }, at(3))).toBe('stale')

      expect(await repo.find(WEDDING)).toMatchObject({
        status: 'stale',
        staleReason: 'guestErased',
        sha256: null,
      })
    })

    it('voids a sealed archive at once, with the reason, and is idempotent', async () => {
      await seal()

      const first = await repo.invalidate(WEDDING, 'photoRemoved', at(10))
      const second = await repo.invalidate(WEDDING, 'takenDown', at(11))

      expect(first).toMatchObject({ status: 'stale', staleReason: 'photoRemoved' })
      expect(second).toMatchObject({ status: 'stale', staleReason: 'photoRemoved' })
      expect((await repo.find(WEDDING))?.invalidatedAt).toEqual(at(10))
    })

    it('only records the instant for an archive still queued, and answers null for none', async () => {
      await request()

      const after = await repo.invalidate(WEDDING, 'reopened', at(5))

      expect(after).toMatchObject({ status: 'queued', staleReason: 'reopened' })
      expect(await repo.invalidate(GALA, 'reopened', at(5))).toBeNull()
    })

    it('stamps served_at and moves the expiry for a sealed archive only', async () => {
      await seal()

      expect(await repo.markServed(WEDDING, at(20), at(30))).toBe(true)

      const stored = await repo.find(WEDDING)
      expect(stored?.servedAt).toEqual(at(20))
      expect(stored?.expiresAt).toEqual(at(30))
    })

    it('does not mark a stale, queued or missing archive as served', async () => {
      await seal()
      await repo.invalidate(WEDDING, 'photoRemoved', at(5))
      expect(await repo.markServed(WEDDING, at(6), at(7))).toBe(false)
      expect((await repo.find(WEDDING))?.servedAt).toBeNull()

      await request(GALA)
      expect(await repo.markServed(GALA, at(6), at(7))).toBe(false)

      await repo.delete(WEDDING)
      expect(await repo.markServed(WEDDING, at(6), at(7))).toBe(false)
    })

    it('puts a running archive back in the queue after a crash', async () => {
      await request()
      await repo.claimNext(at(1))

      expect(await repo.recoverRunning()).toBe(1)

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'queued', startedAt: null })
      expect(await repo.recoverRunning()).toBe(0)
    })

    it('counts the requests of one event in a window, a deleted archive’s included', async () => {
      await request(WEDDING, 0)
      await request(WEDDING, 60)
      await request(GALA, 61)
      await repo.delete(WEDDING)

      expect(await repo.countRequestsSince(WEDDING, at(-1))).toBe(2)
      expect(await repo.countRequestsSince(WEDDING, at(30))).toBe(1)
      expect(await repo.countRequestsSince(GALA, at(-1))).toBe(1)
      expect(await repo.firstRequestSince(WEDDING, at(30))).toEqual(at(60))
      expect(await repo.firstRequestSince(WEDDING, at(61))).toBeNull()
    })

    it('lists the sealed archives whose expiry has passed, and only those', async () => {
      await seal(WEDDING, 0, { ...SEAL, expiresAt: at(100) })
      await seal(GALA, 5, { ...SEAL, expiresAt: at(500) })

      expect(await repo.listExpired(at(99))).toEqual([])
      expect(await repo.listExpired(at(100))).toEqual([WEDDING])
      expect([...(await repo.listExpired(at(500)))].sort()).toEqual([GALA, WEDDING])
    })

    it('does not list a stale or queued archive as expired', async () => {
      await seal(WEDDING, 0, { ...SEAL, expiresAt: at(100) })
      await repo.invalidate(WEDDING, 'photoRemoved', at(10))
      await request(GALA, 5)

      expect(await repo.listExpired(at(1000))).toEqual([])
    })

    it('lists the events by what their archive is, and adds up the sealed bytes', async () => {
      await seal(WEDDING, 0, { ...SEAL, bytes: 100 })
      await request(GALA, 5)

      expect(await repo.listSealedEventIds()).toEqual([WEDDING])
      expect(await repo.listActiveEventIds()).toEqual([GALA])
      expect(await repo.sealedBytes()).toBe(100)

      await repo.invalidate(WEDDING, 'photoRemoved', at(9))
      expect(await repo.sealedBytes()).toBe(0)
    })

    it('deletes one event’s row only, and deleting nothing is fine', async () => {
      await request(WEDDING)
      await request(GALA, 1)

      await repo.delete(WEDDING)
      await repo.delete(WEDDING)

      expect(await repo.find(WEDDING)).toBeNull()
      expect(await repo.find(GALA)).not.toBeNull()
    })
  })
}
