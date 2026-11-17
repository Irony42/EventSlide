import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { EXPORT_SERVED_GRACE_MS } from '../../../domain/exports/exportExpiry'
import { requestExport, type ExportSeal } from '../../../domain/exports/albumExport'
import { aClient, anEvent, atPlus } from '../../testing/builders'
import {
  EXPORT_EVENT,
  EXPORT_HOST,
  ExportScene,
  DEFAULT_EXPORT_POLICY,
} from '../../testing/exportScene'
import { makeDownloadAlbumExport, type DownloadAlbumExport } from './downloadAlbumExport'
import { makeGetAlbumExport, type GetAlbumExport } from './getAlbumExport'

/**
 * Reading the archive's state and downloading it (spec 22): who may, what is served, and what a
 * complete send changes. The `404` is one answer for every reason there is nothing to give.
 */

const DAY = 86_400_000
let scene: ExportScene
let get: GetAlbumExport
let download: DownloadAlbumExport

const BYTES = new Uint8Array([10, 11, 12, 13, 14, 15])
const SHA = 'c'.repeat(64)

const wire = (event?: Event, clients: Parameters<typeof aClient>[0][] = []): void => {
  scene = new ExportScene(DEFAULT_EXPORT_POLICY, event, clients.map(aClient))
  get = makeGetAlbumExport({
    events: scene.events,
    clients: scene.clients,
    exports: scene.exports,
    clock: scene.clock,
  })
  download = makeDownloadAlbumExport({
    events: scene.events,
    clients: scene.clients,
    exports: scene.exports,
    exportFiles: scene.exportFiles,
    bus: scene.bus,
    clock: scene.clock,
    policy: { ttlDays: 7, capNoticeDays: 30 },
  })
}

/** A sealed archive with its file, sealed at `sealedAt` and expiring at `expiresAt`. */
const seal = async (sealedAt = atPlus(0), expiresAt = new Date(sealedAt.getTime() + 7 * DAY)) => {
  await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, sealedAt))
  await scene.exports.claimNext(sealedAt)
  const sealing: ExportSeal = {
    entries: 3,
    skipped: 0,
    bytes: BYTES.byteLength,
    sha256: SHA,
    expiresAt,
  }
  await scene.exports.finish(EXPORT_EVENT, { kind: 'sealed', seal: sealing }, sealedAt)
  scene.exportFiles.seed(EXPORT_EVENT, BYTES)
}

const drain = async (stream: AsyncIterable<Uint8Array> | null): Promise<number[]> => {
  const out: number[] = []
  for await (const chunk of stream ?? []) out.push(...chunk)
  return out
}

beforeEach(() => wire())

describe('getAlbumExport', () => {
  it('answers null for an event that never asked', async () => {
    const result = await get({ eventId: EXPORT_EVENT })

    expect(result.ok && result.value).toBeNull()
  })

  it('answers the row, whatever its state', async () => {
    await seal()

    const result = await get({ eventId: EXPORT_EVENT })

    expect(result.ok && result.value?.status).toBe('sealed')
  })

  it('answers null for a sealed archive past its expiry, before the sweep has removed it', async () => {
    await seal(atPlus(0), atPlus(1_000))
    scene.clock.advance(60 * 60_000)

    const result = await get({ eventId: EXPORT_EVENT })

    expect(result.ok && result.value).toBeNull()
  })

  it('still tells a stale archive why: it was withdrawn', async () => {
    await seal()
    await scene.exports.invalidate(EXPORT_EVENT, 'photoRemoved', atPlus(5))

    const result = await get({ eventId: EXPORT_EVENT })

    expect(result.ok && result.value).toMatchObject({
      status: 'stale',
      staleReason: 'photoRemoved',
    })
  })

  it('answers an unknown event, and one the operator took down, as not found', async () => {
    const unknown = await get({ eventId: 'nope' as typeof EXPORT_EVENT })
    await scene.events.setTakenDown(EXPORT_EVENT, atPlus(0))
    const down = await get({ eventId: EXPORT_EVENT })

    expect(!unknown.ok && unknown.error.code).toBe('event.notFound')
    expect(!down.ok && down.error.code).toBe('event.notFound')
  })

  it('refuses a suspended client with client.suspended, unless it is being offboarded', async () => {
    const suspended = (): Event =>
      Event.restore({
        ...anEvent({ id: 'event-1', status: 'closed', clientId: 'client-1' }).toProps(),
        clientSuspendedAt: atPlus(0),
      })
    wire(suspended(), [{ id: 'client-1', suspendedAt: atPlus(0), purgeAfter: null }])
    const refused = await get({ eventId: EXPORT_EVENT })
    wire(suspended(), [{ id: 'client-1', suspendedAt: atPlus(0), purgeAfter: atPlus(30 * DAY) }])
    const allowed = await get({ eventId: EXPORT_EVENT })

    expect(!refused.ok && refused.error.code).toBe('client.suspended')
    expect(allowed.ok).toBe(true)
  })
})

describe('downloadAlbumExport', () => {
  it('serves a sealed archive: its size, its digest and its bytes, whole or by range', async () => {
    await seal()

    const result = await download({ eventId: EXPORT_EVENT })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.byteSize).toBe(6)
    expect(result.value.sha256).toBe(SHA)
    expect(await drain(await result.value.open())).toEqual([...BYTES])
    expect(await drain(await result.value.open({ start: 1, end: 3 }))).toEqual([11, 12, 13])
  })

  const notFound = async (): Promise<void> => {
    const result = await download({ eventId: EXPORT_EVENT })
    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'notFound',
      'export.notFound',
    ])
  }

  it('answers export.notFound when no archive was ever asked for', notFound)

  it.each(['queued', 'running', 'failed'] as const)(
    'answers export.notFound for a %s archive',
    async (status) => {
      await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(0)))
      if (status !== 'queued') await scene.exports.claimNext(atPlus(1))
      if (status === 'failed') {
        await scene.exports.finish(EXPORT_EVENT, { kind: 'failed', code: 'noRoom' }, atPlus(2))
      }
      scene.exportFiles.seed(EXPORT_EVENT, BYTES)

      await notFound()
    },
  )

  it('answers export.notFound for a stale archive even when its file is still on the disk', async () => {
    await seal()
    await scene.exports.invalidate(EXPORT_EVENT, 'guestErased', atPlus(5))
    scene.exportFiles.seed(EXPORT_EVENT, BYTES)

    await notFound()
  })

  it('answers export.notFound for an archive past its expiry', async () => {
    await seal(atPlus(0), atPlus(1_000))
    scene.clock.advance(60 * 60_000)

    await notFound()
  })

  it('answers export.notFound when the row says sealed and the file is gone', async () => {
    await seal()
    await scene.exportFiles.delete(EXPORT_EVENT)

    await notFound()
  })

  it('answers an event the operator took down as not found, whatever the archive is', async () => {
    await seal()
    await scene.events.setTakenDown(EXPORT_EVENT, atPlus(0))

    const result = await download({ eventId: EXPORT_EVENT })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers an unknown event as not found', async () => {
    const result = await download({ eventId: 'nope' as typeof EXPORT_EVENT })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a suspended client without an offboarding with client.suspended, and keeps its file', async () => {
    wire(
      Event.restore({
        ...anEvent({ id: 'event-1', status: 'closed', clientId: 'client-1' }).toProps(),
        clientSuspendedAt: atPlus(0),
      }),
      [{ id: 'client-1', suspendedAt: atPlus(0), purgeAfter: null }],
    )
    await seal()

    const result = await download({ eventId: EXPORT_EVENT })

    expect(!result.ok && result.error.code).toBe('client.suspended')
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(true)
  })

  describe('markServed: what a complete send changes', () => {
    it('stamps the send and moves the end of the archive to 48 hours later when that is sooner', async () => {
      await seal()
      scene.clock.advance(5 * 60_000)
      const result = await download({ eventId: EXPORT_EVENT })
      if (!result.ok) throw new Error('expected a file')

      await result.value.markServed()

      const row = await scene.exports.find(EXPORT_EVENT)
      expect(row?.servedAt).toEqual(scene.clock.now())
      expect(row?.expiresAt).toEqual(new Date(scene.clock.now().getTime() + EXPORT_SERVED_GRACE_MS))
      expect(scene.bus.published.at(-1)).toEqual({ type: 'export.changed', eventId: EXPORT_EVENT })
    })

    it('never moves the end later than it was: a send does not extend a life', async () => {
      // Sealed with a little over an hour left: the 48 hours after a send would be later.
      await seal(atPlus(0), atPlus(2 * 60 * 60_000))
      scene.clock.advance(5 * 60_000)
      const result = await download({ eventId: EXPORT_EVENT })
      if (!result.ok) throw new Error('expected a file')

      await result.value.markServed()

      expect((await scene.exports.find(EXPORT_EVENT))?.expiresAt).toEqual(atPlus(2 * 60 * 60_000))
    })

    it('counts the album’s deadline as one of the three dates', async () => {
      wire(
        anEvent({
          id: 'event-1',
          slug: 'camille-et-sacha',
          status: 'closed',
          settings: { retentionDays: 3 },
        }),
      )
      await seal(atPlus(60 * 60_000))
      scene.clock.advance(2 * DAY + 20 * 60 * 60_000)
      const result = await download({ eventId: EXPORT_EVENT })
      if (!result.ok) throw new Error('expected a file')

      await result.value.markServed()

      // Closed at AT with three days: the deadline falls before the 48 hours after the send.
      expect((await scene.exports.find(EXPORT_EVENT))?.expiresAt).toEqual(atPlus(3 * DAY))
    })

    it('reads the client of the event, whose ceiling is one more deadline the archive must not outlive', async () => {
      wire(
        anEvent({
          id: 'event-1',
          slug: 'camille-et-sacha',
          status: 'closed',
          clientId: 'client-1',
          settings: { retentionDays: 365 },
        }),
        [{ id: 'client-1', ceilings: { maxRetentionDays: 2 } }],
      )
      await seal(atPlus(60 * 60_000))
      scene.clock.advance(60_000)
      const result = await download({ eventId: EXPORT_EVENT })
      if (!result.ok) throw new Error('expected a file')

      await result.value.markServed()

      // Closed at AT, a ceiling of two days: the deadline falls before the 48 hours after the send.
      expect((await scene.exports.find(EXPORT_EVENT))?.expiresAt).toEqual(atPlus(2 * DAY))
    })

    it('says nothing, and changes nothing, when the archive went stale while it was being sent', async () => {
      await seal()
      const result = await download({ eventId: EXPORT_EVENT })
      if (!result.ok) throw new Error('expected a file')
      await scene.exports.invalidate(EXPORT_EVENT, 'photoRemoved', atPlus(5))
      scene.bus.published.length = 0

      await result.value.markServed()

      expect((await scene.exports.find(EXPORT_EVENT))?.servedAt).toBeNull()
      expect(scene.bus.published).toEqual([])
    })
  })
})
