import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AT, aClipJob, aPhoto, aVoiceEntry, anEvent } from '../../application/testing/builders'
import type { ClipJobStatus } from '../../domain/clips/clipJobStatus'
import { asClientId, asClipJobId, asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteClipJobRepository } from './sqliteClipJobRepository'
import { SqliteGuestbookVoiceRepository } from './sqliteGuestbookVoiceRepository'
import { SqliteEventRepository } from './sqliteEventRepository'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'
import { SqliteSiteOverview } from './sqliteSiteOverview'

/**
 * Ring 3. **One answer to "how many bytes has this event spent", from every reader.**
 *
 * The question has four askers, and until G2-04 they did not agree. The upload path asks it
 * twice, from two tables' worth of SQL spelled twice (`SqlitePhotoRepository` for a photo
 * batch, `SqliteClipJobRepository` for a staged clip), and both count photographs **and**
 * the clips still waiting to be transcoded, because a staged source is on the disk the
 * quota exists to protect. The host's dashboard asked a third way and counted photographs
 * only — so an event could show 1.2 GB used and refuse the next upload as full, and the
 * difference was exactly the queue. The operator's overview (P3-12, G2-11) is the
 * fourth asker, and the first whose answer is not for the person who owns the event.
 *
 * The whole point is that these four numbers are one number, so this asserts they are equal
 * to each other **and** to a figure worked out by hand from the rows below — the second half
 * is what stops all four from drifting together, which an equality between readers alone
 * could not see.
 */

const HOST = asUserId('user-host')
const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const BRUNCH = asEventId('evt-brunch')
const SOLO = asEventId('evt-solo')
/** The wedding and the gala are one client's; the brunch is another's; the solo event nobody's. */
const ATELIER = asClientId('client-atelier')
const OTHER_ATELIER = asClientId('client-other')
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

/**
 * What the wedding's voice messages (spec 25) are charged: the source while a recording is
 * processed (reserved, queued, running) and the **output** once it is ready, nothing for a failed
 * one. The figures are chosen so that charging a ready voice for its source (7 777), or a failed one
 * at all (31 313), lands on a number no subset of the others sums to.
 */
const VOICE_BYTES = {
  reserved: 7,
  queued: 70,
  running: 700,
  readySource: 7_777,
  readyOutput: 17_171,
  failed: 31_313,
} as const
const WEDDING_VOICES_USED =
  VOICE_BYTES.reserved + VOICE_BYTES.queued + VOICE_BYTES.running + VOICE_BYTES.readyOutput

/** Photographs (all statuses), the three states in which a clip source is on disk, and the voices. */
const WEDDING_USED = 2_000 + 1_000 + 500 + (100_000 + 200_000 + 400_000) + WEDDING_VOICES_USED

/** What the gala holds: a published photograph, a queued clip source and a queued voice. */
const GALA_VOICE_BYTES = 5_005
const GALA_USED = 7_000_000 + 3_000_000 + GALA_VOICE_BYTES

/** Far above anything the fixtures hold, so a probe is refused for its own size alone. */
const QUOTA = 50_000_000
const TOO_BIG = QUOTA + 1

describe('the event byte sum', () => {
  let db: Db
  let events: SqliteEventRepository
  let photos: SqlitePhotoRepository
  let clips: SqliteClipJobRepository
  let overview: SqliteSiteOverview

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

  /**
   * A voice message row in a state, as the repository would leave it: the entry of the book and
   * the recording behind it, written raw so that every state is reachable without a worker.
   */
  const insertVoice = (
    id: string,
    eventId: string,
    state: 'reserved' | 'queued' | 'running' | 'ready' | 'failed',
    sourceBytes: number,
    outputBytes: number | null = null,
  ): void => {
    db.prepare(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
       VALUES (?, ?, ?, '', 'pending', ?)`,
    ).run(id, eventId, `guest-${eventId}`, AT.toISOString())
    db.prepare(
      `INSERT INTO guestbook_voices (entry_id, event_id, state, source_hash, source_byte_size,
                                     audio_hash, audio_byte_size, duration_ms, failure, queued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      eventId,
      state,
      Buffer.from(id).toString('hex').padEnd(64, '0').slice(0, 64),
      sourceBytes,
      outputBytes === null ? null : 'f'.repeat(64),
      outputBytes,
      outputBytes === null ? null : 5_000,
      state === 'failed' ? 'corrupt' : null,
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
    overview = new SqliteSiteOverview(db)

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

    // And one voice message in each of the five states.
    insertVoice('v-reserved', WEDDING, 'reserved', VOICE_BYTES.reserved)
    insertVoice('v-queued', WEDDING, 'queued', VOICE_BYTES.queued)
    insertVoice('v-running', WEDDING, 'running', VOICE_BYTES.running)
    insertVoice('v-ready', WEDDING, 'ready', VOICE_BYTES.readySource, VOICE_BYTES.readyOutput)
    insertVoice('v-failed', WEDDING, 'failed', VOICE_BYTES.failed)

    // Another event's bytes, in every table, that no reader may fold in.
    insertPhoto('g-published', GALA, 'published', 7_000_000)
    await stageClip(GALA, 'queued', 3_000_000)
    insertVoice('g-voice', GALA, 'queued', GALA_VOICE_BYTES)

    // The client sum: the wedding and the gala are one client's. The brunch belongs to
    // another client and the solo event to none, and both hold a great deal, so a sum that
    // reaches across either boundary is wrong by a figure nobody could mistake.
    const insertClient = db.prepare<[string, string, string]>(
      `INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)`,
    )
    insertClient.run(ATELIER, 'Atelier', AT.toISOString())
    insertClient.run(OTHER_ATELIER, 'Un autre atelier', AT.toISOString())
    await events.save(
      anEvent({ id: BRUNCH, ownerId: HOST, slug: 'brunch', joinCode: 'CCCCCC', quotaBytes: QUOTA }),
    )
    await events.save(
      anEvent({ id: SOLO, ownerId: HOST, slug: 'solo', joinCode: 'DDDDDD', quotaBytes: QUOTA }),
    )
    const attach = db.prepare<[string, string]>(`UPDATE events SET client_id = ? WHERE id = ?`)
    attach.run(ATELIER, WEDDING)
    attach.run(ATELIER, GALA)
    attach.run(OTHER_ATELIER, BRUNCH)
    insertGuest(`guest-${BRUNCH}`, BRUNCH)
    insertGuest(`guest-${SOLO}`, SOLO)
    insertPhoto('b-published', BRUNCH, 'published', 40_000_000)
    insertPhoto('s-published', SOLO, 'published', 50_000_000)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  /** What the operator's overview says the wedding has used, listed under its client. */
  const overviewBytes = async (eventId: string = WEDDING): Promise<number | undefined> =>
    (await overview.clientEvents(ATELIER, { limit: 10 }))?.items.find((row) => row.id === eventId)
      ?.usedBytes

  /** What the operator's overview says a client has used across all its events. */
  const overviewClientBytes = async (clientId: string): Promise<number | undefined> =>
    (await overview.listClients({ limit: 10 })).items.find((row) => row.id === clientId)?.usage
      .usedBytes

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

  it('is the number a single event’s own answer carries, queued clip sources included (HTTP-M-06)', async () => {
    // `countsOf` is what the answer about one event reads, and it reads the same columns as the
    // dashboard row; a sum that left the queued clips out here would show a host room that
    // admission will not give.
    expect((await events.countsOf(WEDDING)).usedBytes).toBe(WEDDING_USED)
    expect((await events.countsOf(GALA)).usedBytes).not.toBe(WEDDING_USED)
  })

  it('is the number the operator’s overview reports for the event, queued clip sources included', async () => {
    // The fifth reader. The operator sizes a client's events with this figure, and it must
    // be the one a guest is refused against — not a photograph-only sum that leaves the
    // queue out, as the host's dashboard once did.
    expect(await overviewBytes(WEDDING)).toBe(WEDDING_USED)
    expect(await overviewBytes(GALA)).toBe(GALA_USED)
    expect(await overviewBytes(WEDDING)).toBe(await dashboardBytes())
  })

  it('counts a clip that is still waiting to be transcoded on the dashboard, as admission does', async () => {
    // The defect this closes: the dashboard summed photographs alone, so the three states
    // in which a source is on the disk — reserved, queued, running — were invisible to the
    // host while the upload path already charged for them.
    const photographsOnly = PHOTO_BYTES.published + PHOTO_BYTES.pending + PHOTO_BYTES.rejected

    expect(await dashboardBytes()).toBe(
      photographsOnly +
        CLIP_BYTES.reserved +
        CLIP_BYTES.queued +
        CLIP_BYTES.running +
        WEDDING_VOICES_USED,
    )
  })

  it('does not count a clip that is finished or given up on, which holds no bytes any more', async () => {
    const withTerminalClips = await dashboardBytes()

    expect(withTerminalClips).toBeLessThan(WEDDING_USED + CLIP_BYTES.done)
    expect(withTerminalClips).toBe(WEDDING_USED)
  })

  describe('the voice messages (spec 25)', () => {
    /** What a voice admission works out the wedding has used, read off `remaining` as the others are. */
    const voiceAdmissionBytes = async (): Promise<number | undefined> => {
      // A guest of its own: the wedding's guest already holds five voices, and the three-per-guest
      // ceiling would refuse the probe before the quota is asked.
      insertGuest('guest-probe', WEDDING)
      const admission = await new SqliteGuestbookVoiceRepository(db).admitVoice(
        aVoiceEntry({
          id: 'probe-voice',
          state: 'reserved',
          eventId: WEDDING,
          guestId: 'guest-probe',
          sourceByteSize: TOO_BIG,
        }),
        {
          quotaBytes: QUOTA,
          maxQueuedVoices: UNLIMITED_QUEUE,
          maxQueuedVoicesPerEvent: UNLIMITED_QUEUE,
        },
      )
      return admission.kind === 'refused' && admission.refusal.reason === 'quotaExceeded'
        ? QUOTA - admission.refusal.remaining
        : undefined
    }

    it('is one figure for the dashboard, the photo, clip and voice admissions, and the operator, voices included', async () => {
      expect([
        await dashboardBytes(),
        await photoAdmissionBytes(),
        await clipAdmissionBytes(),
        await voiceAdmissionBytes(),
        await overviewBytes(WEDDING),
        await photos.totalBytes(WEDDING),
        (await events.countsOf(WEDDING)).usedBytes,
      ]).toEqual([
        WEDDING_USED,
        WEDDING_USED,
        WEDDING_USED,
        WEDDING_USED,
        WEDDING_USED,
        WEDDING_USED,
        WEDDING_USED,
      ])
    })

    it('charges the source while a recording is processed, and the output once it is ready', async () => {
      const voices = new SqliteGuestbookVoiceRepository(db)

      expect(await voices.voiceBytes(WEDDING)).toBe(WEDDING_VOICES_USED)
    })

    it('charges nothing for a voice that failed, whose bytes are gone', async () => {
      // WEDDING_USED has no failed voice in it, by construction, and the failed row is there.
      expect(await dashboardBytes()).toBe(WEDDING_USED)
      expect(
        db.prepare(`SELECT COUNT(*) AS n FROM guestbook_voices WHERE state = 'failed'`).get(),
      ).toEqual({ n: 1 })
    })

    it('folds another event’s voices in that event only, and in the client’s total', async () => {
      expect(await overviewBytes(GALA)).toBe(GALA_USED)
      expect(await photos.clientTotalBytes(ATELIER)).toBe(WEDDING_USED + GALA_USED)
      expect(await photos.clientTotalBytes(OTHER_ATELIER)).toBe(40_000_000)
    })
  })

  it('counts another event’s photographs and clips on that event only', async () => {
    const gala = (await events.listForUser(HOST)).find((row) => row.id === GALA)?.usedBytes

    expect(gala).toBe(7_000_000 + 3_000_000 + GALA_VOICE_BYTES)
    expect(await photos.totalBytes(GALA)).toBe(gala)
  })

  // ----------------------------------------------------------------- the client --

  describe('summed over a client’s events', () => {
    /**
     * What a photo admission works out the client has used, read the way the event's is: a
     * photograph too big for any ceiling is refused, and the sum is `maxBytes − remaining`.
     */
    const photoAdmissionClientBytes = async (): Promise<number | undefined> => {
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
        {
          quotaBytes: Number.MAX_SAFE_INTEGER,
          maxPhotosPerGuest: null,
          clientBytes: { clientId: ATELIER, maxBytes: QUOTA },
        },
      )
      return verdict?.refusal?.reason === 'clientStorageFull'
        ? QUOTA - verdict.refusal.remaining
        : undefined
    }

    /** The same, as a clip's admission works it out. */
    const clipAdmissionClientBytes = async (): Promise<number | undefined> => {
      const { refusal } = await clips.stage(
        aClipJob({
          id: 'probe-clip',
          eventId: WEDDING,
          author: { kind: 'host', id: HOST },
          sourceByteSize: TOO_BIG,
        }),
        {
          quotaBytes: Number.MAX_SAFE_INTEGER,
          maxQueuedClips: UNLIMITED_QUEUE,
          maxQueuedClipsPerEvent: UNLIMITED_QUEUE,
          clientBytes: { clientId: ATELIER, maxBytes: QUOTA },
        },
      )
      return refusal?.reason === 'clientStorageFull' ? QUOTA - refusal.remaining : undefined
    }

    it('is the sum of what each of the client’s events reports for itself, as the dashboard shows it', async () => {
      const dashboard = await events.listForUser(HOST)
      const perEvent = [WEDDING, GALA].map(
        (id) => dashboard.find((row) => row.id === id)?.usedBytes,
      )

      expect(perEvent).toEqual([WEDDING_USED, GALA_USED])
      expect(await photos.clientTotalBytes(ATELIER)).toBe(WEDDING_USED + GALA_USED)
    })

    it('is the same number from the photo admission, the clip admission and clientTotalBytes', async () => {
      expect([
        await photoAdmissionClientBytes(),
        await clipAdmissionClientBytes(),
        await photos.clientTotalBytes(ATELIER),
      ]).toEqual([WEDDING_USED + GALA_USED, WEDDING_USED + GALA_USED, WEDDING_USED + GALA_USED])
    })

    it('counts a clip still waiting to be transcoded in any of the client’s events, and not one that is finished', async () => {
      // The gala's queued source is in; the wedding's done and failed ones are not. The hand
      // figure is WEDDING_USED (reserved + queued + running + photographs) + GALA_USED.
      expect(await photos.clientTotalBytes(ATELIER)).toBe(
        2_000 +
          1_000 +
          500 +
          100_000 +
          200_000 +
          400_000 +
          7_000_000 +
          3_000_000 +
          WEDDING_VOICES_USED +
          GALA_VOICE_BYTES,
      )
    })

    it('is the number the operator’s overview reports for the client, equal to clientTotalBytes', async () => {
      expect(await overviewClientBytes(ATELIER)).toBe(WEDDING_USED + GALA_USED)
      expect(await overviewClientBytes(ATELIER)).toBe(await photos.clientTotalBytes(ATELIER))
      expect(await overviewClientBytes(OTHER_ATELIER)).toBe(
        await photos.clientTotalBytes(OTHER_ATELIER),
      )
    })

    it('never folds in another client’s bytes, nor those of an event with no client', async () => {
      expect(await photos.clientTotalBytes(OTHER_ATELIER)).toBe(40_000_000)
      expect(await photos.clientTotalBytes(ATELIER)).toBeLessThan(40_000_000)
    })

    it('credits the one job a batch replaces, in the one event that holds it', async () => {
      const [verdict] = await photos.saveManyWithinLimits(
        WEDDING,
        [
          aPhoto({
            id: 'probe-credited',
            eventId: WEDDING,
            author: { kind: 'host', id: HOST },
            byteSize: TOO_BIG,
          }),
        ],
        {
          quotaBytes: Number.MAX_SAFE_INTEGER,
          maxPhotosPerGuest: null,
          replacesStagedClip: asClipJobId(`clip-${WEDDING}-running`),
          clientBytes: { clientId: ATELIER, maxBytes: QUOTA },
        },
      )

      expect(
        verdict?.refusal?.reason === 'clientStorageFull' && QUOTA - verdict.refusal.remaining,
      ).toBe(WEDDING_USED + GALA_USED - CLIP_BYTES.running)
    })
  })
})
