import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AT, aClipJob, aPhoto, anEvent } from '../../application/testing/builders'
import type { ClipJobStatus } from '../../domain/clips/clipJobStatus'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteClipJobRepository } from './sqliteClipJobRepository'
import { SqliteEventRepository } from './sqliteEventRepository'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'

/**
 * Ring 3. **One answer to "how many bytes has this event spent", from every reader.**
 *
 * The question has four askers, and until G2-04 they did not agree. The upload path asks it
 * twice, from two tables' worth of SQL spelled twice (`SqlitePhotoRepository` for a photo
 * batch, `SqliteClipJobRepository` for a staged clip), and both count photographs **and**
 * the clips still waiting to be transcoded, because a staged source is on the disk the
 * quota exists to protect. The host's dashboard asked a third way and counted photographs
 * only — so an event could show 1.2 GB used and refuse the next upload as full, and the
 * difference was exactly the queue. The operator's overview (P3-12, G2-11) will be a
 * fourth asker.
 *
 * The whole point is that these four numbers are one number, so this asserts they are equal
 * to each other **and** to a figure worked out by hand from the rows below — the second half
 * is what stops all four from drifting together, which an equality between readers alone
 * could not see.
 */

const HOST = asUserId('user-host')
const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const UNLIMITED_QUEUE = Number.MAX_SAFE_INTEGER

/** Bytes per row, chosen so that no two subsets of them sum to the same number. */
const PHOTO_BYTES = { published: 2_000, pending: 1_000, rejected: 500 } as const
const CLIP_BYTES: Readonly<Record<ClipJobStatus, number>> = {
  reserved: 100_000,
  queued: 200_000,
  running: 400_000,
  done: 800_000,
  failed: 1_600_000,
}

/** Photographs (all statuses) plus the three states in which a source is still on disk. */
const WEDDING_USED = 2_000 + 1_000 + 500 + (100_000 + 200_000 + 400_000)

/** Far above anything the fixtures hold, so a probe is refused for its own size alone. */
const QUOTA = 50_000_000
const TOO_BIG = QUOTA + 1

describe('the event byte sum', () => {
  let db: Db
  let events: SqliteEventRepository
  let photos: SqlitePhotoRepository
  let clips: SqliteClipJobRepository

  const insertGuest = (guestId: string, eventId: string): void => {
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
       VALUES (?, ?, NULL, ?, ?)`,
    ).run(guestId, eventId, AT.toISOString(), AT.toISOString())
  }

  const insertPhoto = (id: string, eventId: string, status: string, byteSize: number): void => {
    db.prepare(
      `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                           width, height, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, 4032, 3024, ?, ?)`,
    ).run(
      id,
      eventId,
      `guest-${eventId}`,
      status,
      Buffer.from(id).toString('hex').padEnd(64, '0').slice(0, 64),
      byteSize,
      AT.toISOString(),
    )
  }

  const stageClip = async (
    eventId: string,
    status: ClipJobStatus,
    sourceByteSize: number,
  ): Promise<void> => {
    await clips.stage(
      aClipJob({
        id: `clip-${eventId}-${status}`,
        eventId,
        author: { kind: 'host', id: HOST },
        status,
        sourceByteSize,
      }),
      {
        quotaBytes: Number.MAX_SAFE_INTEGER,
        maxQueuedClips: UNLIMITED_QUEUE,
        maxQueuedClipsPerEvent: UNLIMITED_QUEUE,
      },
    )
  }

  beforeEach(async () => {
    db = openDatabase({ path: ':memory:' })
    migrate(db, migrations)
    db.prepare(`INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`).run(
      HOST,
      'host@example.test',
      'hash:un-mot-de-passe-solide',
      AT.toISOString(),
    )

    events = new SqliteEventRepository(db)
    photos = new SqlitePhotoRepository(db)
    clips = new SqliteClipJobRepository(db)

    await events.save(
      anEvent({
        id: WEDDING,
        ownerId: HOST,
        slug: 'mariage',
        joinCode: 'AAAAAA',
        quotaBytes: QUOTA,
      }),
    )
    await events.save(
      anEvent({ id: GALA, ownerId: HOST, slug: 'gala', joinCode: 'BBBBBB', quotaBytes: QUOTA }),
    )
    insertGuest(`guest-${WEDDING}`, WEDDING)
    insertGuest(`guest-${GALA}`, GALA)

    // The wedding holds three photographs, one in every status that is not published yet
    // or ever, and one clip job in each of the five states.
    insertPhoto('p-published', WEDDING, 'published', PHOTO_BYTES.published)
    insertPhoto('p-pending', WEDDING, 'pending', PHOTO_BYTES.pending)
    insertPhoto('p-rejected', WEDDING, 'rejected', PHOTO_BYTES.rejected)
    for (const status of ['reserved', 'queued', 'running', 'done', 'failed'] as const) {
      await stageClip(WEDDING, status, CLIP_BYTES[status])
    }

    // Another event's bytes, in both tables, that no reader may fold in.
    insertPhoto('g-published', GALA, 'published', 7_000_000)
    await stageClip(GALA, 'queued', 3_000_000)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  /** What the dashboard says the wedding has used. */
  const dashboardBytes = async (): Promise<number | undefined> =>
    (await events.listForUser(HOST)).find((row) => row.id === WEDDING)?.usedBytes

  /**
   * What a photo admission works out the wedding has used: refuse a photograph that cannot
   * fit, and read the sum off `remaining`, which is `quota − used`.
   */
  const photoAdmissionBytes = async (): Promise<number | undefined> => {
    const [verdict] = await photos.saveManyWithinLimits(
      WEDDING,
      [
        aPhoto({
          id: 'probe-photo',
          eventId: WEDDING,
          author: { kind: 'host', id: HOST },
          byteSize: TOO_BIG,
        }),
      ],
      { quotaBytes: QUOTA, maxPhotosPerGuest: null },
    )
    return verdict?.refusal?.reason === 'quotaExceeded'
      ? QUOTA - verdict.refusal.remaining
      : undefined
  }

  /** The same, as a clip's admission works it out. */
  const clipAdmissionBytes = async (): Promise<number | undefined> => {
    const { refusal } = await clips.stage(
      aClipJob({
        id: 'probe-clip',
        eventId: WEDDING,
        author: { kind: 'host', id: HOST },
        sourceByteSize: TOO_BIG,
      }),
      {
        quotaBytes: QUOTA,
        maxQueuedClips: UNLIMITED_QUEUE,
        maxQueuedClipsPerEvent: UNLIMITED_QUEUE,
      },
    )
    return refusal?.reason === 'quotaExceeded' ? QUOTA - refusal.remaining : undefined
  }

  it('is the same number on the dashboard as in the photo admission and the clip admission', async () => {
    const dashboard = await dashboardBytes()
    const photoAdmission = await photoAdmissionBytes()
    const clipAdmission = await clipAdmissionBytes()
    const total = await photos.totalBytes(WEDDING)

    expect([dashboard, photoAdmission, clipAdmission, total]).toEqual([
      WEDDING_USED,
      WEDDING_USED,
      WEDDING_USED,
      WEDDING_USED,
    ])
  })

  it('counts a clip that is still waiting to be transcoded on the dashboard, as admission does', async () => {
    // The defect this closes: the dashboard summed photographs alone, so the three states
    // in which a source is on the disk — reserved, queued, running — were invisible to the
    // host while the upload path already charged for them.
    const photographsOnly = PHOTO_BYTES.published + PHOTO_BYTES.pending + PHOTO_BYTES.rejected

    expect(await dashboardBytes()).toBe(
      photographsOnly + CLIP_BYTES.reserved + CLIP_BYTES.queued + CLIP_BYTES.running,
    )
  })

  it('does not count a clip that is finished or given up on, which holds no bytes any more', async () => {
    const withTerminalClips = await dashboardBytes()

    expect(withTerminalClips).toBeLessThan(WEDDING_USED + CLIP_BYTES.done)
    expect(withTerminalClips).toBe(WEDDING_USED)
  })

  it('counts another event’s photographs and clips on that event only', async () => {
    const gala = (await events.listForUser(HOST)).find((row) => row.id === GALA)?.usedBytes

    expect(gala).toBe(7_000_000 + 3_000_000)
    expect(await photos.totalBytes(GALA)).toBe(gala)
  })
})
