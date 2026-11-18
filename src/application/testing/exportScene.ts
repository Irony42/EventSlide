import type { Client } from '../../domain/clients/client'
import type { Event } from '../../domain/events/event'
import { requestExport } from '../../domain/exports/albumExport'
import { asEventId, asUserId } from '../../domain/shared/ids'
import type { Photo } from '../../domain/photos/photo'
import {
  AT,
  atPlus,
  anEvent,
  aPhoto,
  aClip,
  aVoiceEntry,
  type GuestbookVoiceEntryInput,
  type PhotoInput,
} from './builders'
import { CapturingLogger } from './capturingLogger'
import { FakeAlbumExportRepository } from './fakeAlbumExportRepository'
import { FakeArchiveWriter } from './fakeArchiveWriter'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClipJobRepository } from './fakeClipJobRepository'
import { FakeClock } from './fakeClock'
import { FakeContentHasher } from './fakeContentHasher'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeExportFileStore } from './fakeExportFileStore'
import { FakeGuestbookRepository } from './fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from './fakeGuestbookVoiceRepository'
import { FakeGuestRepository } from './fakeGuestRepository'
import { FakePhotoRepository } from './fakePhotoRepository'
import { FakeStreamHasher } from './fakeStreamHasher'
import { InMemoryMediaStore } from './inMemoryMediaStore'
import { RecordingEventBus } from './recordingEventBus'

/**
 * The world a test of the verified archive (spec 22) lives in: one closed event, an album the test
 * fills, every port a fake, and the knobs a test turns (the free disk, the clock, a transcode in
 * progress). Built once per test, with the policy a test overrides one number of.
 *
 * It exists so that the request, the build, the download and the sweep are tested against the
 * same arrangement, instead of five files each wiring thirty fakes in their own way.
 */

export const EXPORT_EVENT = asEventId('event-1')
export const EXPORT_HOST = asUserId('user-host')

export interface ExportScenePolicy {
  readonly enabled: boolean
  readonly maxBytes: number
  readonly maxTotalBytes: number
  readonly maxPerEventPerDay: number
  readonly ttlDays: number
  readonly minFreeDiskBytes: number
  readonly maxWaitMs: number
  readonly capNoticeDays: number
}

export const DEFAULT_EXPORT_POLICY: ExportScenePolicy = {
  enabled: true,
  maxBytes: 10_000_000,
  maxTotalBytes: 100_000_000,
  maxPerEventPerDay: 3,
  ttlDays: 7,
  minFreeDiskBytes: 1_000,
  maxWaitMs: 10 * 60_000,
  capNoticeDays: 30,
}

export class ExportScene {
  readonly clients = new FakeClientRepository()
  readonly events = new FakeEventRepository({ clients: this.clients })
  readonly photos = new FakePhotoRepository()
  readonly guests = new FakeGuestRepository(this.photos)
  readonly guestbook = new FakeGuestbookRepository()
  /** The recordings over the same rows: what the archive's estimate counts (spec 25). */
  readonly voices = new FakeGuestbookVoiceRepository(this.guestbook)
  readonly media = new InMemoryMediaStore()
  /** A writer whose stream ends with a real end-of-central-directory record, which the build reads back. */
  readonly archive = new FakeArchiveWriter({ emits: 'zip' })
  readonly streamHasher = new FakeStreamHasher()
  readonly hasher = new FakeContentHasher()
  readonly exports = new FakeAlbumExportRepository()
  readonly exportFiles = new FakeExportFileStore()
  readonly clips = new FakeClipJobRepository()
  readonly bus = new RecordingEventBus()
  readonly logger = new CapturingLogger()
  /** An hour after the event closed: what the clock says unless a test moves it. */
  readonly clock = new FakeClock(atPlus(60 * 60_000))
  /** What the disk probe answers, `null` for a disk that cannot be read. */
  freeDisk: number | null = 1_000_000_000

  constructor(
    readonly policy: ExportScenePolicy = DEFAULT_EXPORT_POLICY,
    event: Event = anEvent({ id: 'event-1', slug: 'camille-et-sacha', status: 'closed' }),
    /** The event's client, when it has one: seeded first, as the foreign key demands. */
    clients: readonly Client[] = [],
  ) {
    this.clients.seed(...clients)
    this.events.seed(event)
  }

  readonly freeDiskBytes = async (): Promise<number | null> => this.freeDisk

  /** A photograph with its `original` on the disk. */
  async photo(
    input: PhotoInput & { id: string },
    bytes = new Uint8Array([1, 2, 3]),
  ): Promise<Photo> {
    const photo = aPhoto({ eventId: 'event-1', status: 'published', ...input })
    this.photos.seed(photo)
    await this.media.put(photo.eventId, photo.contentHash, 'original', bytes)
    return photo
  }

  /**
   * A clip whose stored name **is** the digest of its video (what a finished transcode leaves), or
   * not, when a test passes the name the disk would have after it corrupted the file.
   */
  async clip(
    input: PhotoInput & { id: string },
    video = new Uint8Array([9, 9, 9, 9]),
    storedAs = this.hasher.sha256Hex(video),
  ): Promise<Photo> {
    const poster = new Uint8Array([7, 7])
    const clip = aClip({
      eventId: 'event-1',
      status: 'published',
      contentHash: storedAs,
      clip: { posterHash: this.hasher.sha256Hex(poster) },
      ...input,
    })
    this.photos.seed(clip)
    await this.media.put(clip.eventId, clip.contentHash, 'video', video)
    await this.media.put(clip.eventId, clip.hashFor('poster'), 'poster', poster)
    return clip
  }

  /**
   * A voice message the box finished (spec 25): published, `ready`, its output on the disk under
   * the digest of its own bytes, which is what a finished transcode leaves.
   */
  async voice(
    input: GuestbookVoiceEntryInput & { id: string },
    bytes = new Uint8Array([5, 5, 5, 5]),
  ): Promise<void> {
    const entry = aVoiceEntry({
      eventId: 'event-1',
      state: 'ready',
      moderation: 'auto',
      audioHash: this.hasher.sha256Hex(bytes),
      ...input,
    })
    this.guestbook.seed(entry)
    const hash = entry.voice?.audioHash
    if (hash !== null && hash !== undefined)
      await this.media.put(entry.eventId, hash, 'voice', bytes)
  }

  /** A photograph whose row exists and whose file does not: a photo already lost. */
  lostPhoto(input: PhotoInput & { id: string }): Photo {
    const photo = aPhoto({ eventId: 'event-1', status: 'published', ...input })
    this.photos.seed(photo)
    return photo
  }

  /** The host asked, the worker wrote it, and it is sealed with its file on the disk. */
  async sealArchive(expiresAt = atPlus(8 * 86_400_000)): Promise<void> {
    await this.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(0)))
    await this.exports.claimNext(atPlus(1))
    await this.exports.finish(
      EXPORT_EVENT,
      {
        kind: 'sealed',
        seal: { entries: 3, skipped: 0, bytes: 4, sha256: 'e'.repeat(64), expiresAt },
      },
      atPlus(2),
    )
    this.exportFiles.seed(EXPORT_EVENT, new Uint8Array([1, 2, 3, 4]))
  }

  statusesOf(): readonly string[] {
    return this.bus.published.map((event) => event.type)
  }
}

export { AT, atPlus }
