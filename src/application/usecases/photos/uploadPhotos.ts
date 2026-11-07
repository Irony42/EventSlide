import type { ClientCeilings } from '../../../domain/clients/clientCeilings'
import type { Event } from '../../../domain/events/event'
import { admissionRefusalError } from '../../../domain/events/admission'
import { fitsInQuota } from '../../../domain/events/quota'
import { Caption } from '../../../domain/photos/caption'
import { ContentHash } from '../../../domain/photos/contentHash'
import { Dimensions } from '../../../domain/photos/dimensions'
import { Photo, type PhotoAuthor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { ChallengeId, EventId, MissionId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientByteLimit, ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { ImageProcessor, RenderSpec, RenderedImage } from '../../ports/imageProcessor'
import type { Logger } from '../../ports/logger'
import type { ChallengeRepository } from '../../ports/challengeRepository'
import type { MissionRepository } from '../../ports/missionRepository'
import { type MediaStore } from '../../ports/mediaStore'
import { MEDIA_VARIANTS, type PhotoVariant } from '../../../domain/photos/mediaVariant'
import type {
  PhotoAdmission,
  PhotoAdmissionLimits,
  PhotoRefusal,
  PhotoRepository,
} from '../../ports/photoRepository'
import { clientBytesOf, clientContextOf } from '../clients/clientContextOf'

/**
 * Guest photo ingest: the request this product exists for, and the one place where a
 * hostile file, a dropped connection, a full disk and a byte quota all meet.
 *
 * The order of the pipeline is the design. Every step is placed where it is because
 * doing it later cost 1.0 something real:
 *
 * 1. the event gate, so a public endpoint cannot write to an event that is not open;
 * 2. `probe` before any decode, so a decompression bomb is refused from its header;
 * 3. hash the **rendered** bytes, so a retry is recognised as a retry;
 * 4. media written before the row, so a `sharp` failure can never leave a row
 *    pointing at a file that does not exist;
 * 5. the limits re-checked inside the write transaction, because a total read here can
 *    be stale by the time the batch is inserted — that is what makes the quota hold
 *    when two guests upload at the same moment, and not merely when they take turns;
 * 6. every exit path after a write removes what this request wrote — **and only what no
 *    committed row names**, because media is addressed by content and a byte-identical
 *    photo from another guest owns the same files.
 *
 * A batch is a partial success, not all-or-nothing: a guest who selected five photos
 * and one PDF gets five photos and one named refusal. Handing back a single opaque
 * error for the batch is how 1.0 left a guest re-picking six files on venue Wi-Fi.
 */

/** One file as it arrived. `declaredName` is metadata echoed back, never a path. */
export interface UploadFile {
  readonly bytes: Uint8Array
  readonly declaredName: string
}

export interface UploadPhotosInput {
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly files: readonly UploadFile[]
  /** One caption for the request, as the upload form offers it. */
  readonly caption?: string | null
  /**
   * The prompt the guest tapped before sending, if any (roadmap §2.1).
   *
   * One per request rather than one per file, exactly as the caption is: a guest picks a
   * mission, then picks their photographs, and asking them to file five files one by one
   * on a phone is asking them not to bother.
   */
  readonly missionId?: MissionId | null
  /**
   * The timed challenge the guest answers, if they left "Je participe au défi" checked (spec 18).
   * One per request, like the mission. The phone says it, the server decides: it is kept only if
   * it is this event's latest challenge and the upload was received inside its window.
   */
  readonly challengeId?: ChallengeId | null
}

/** Header-level ceilings the deployment sets; the render specs below are product policy. */
export interface UploadLimits {
  /** `width * height` a header may declare before the file is refused undecoded. */
  readonly maxPixels: number
}

export interface UploadPhotosDeps {
  readonly events: EventRepository
  /**
   * For the ceilings of the event's client (roadmap §10.5): `max_total_bytes` across its
   * events, and `max_event_quota_bytes` over the event's own. Read only for an event that
   * has a client — see `clientContextOf`.
   */
  readonly clients: ClientRepository
  readonly photos: PhotoRepository
  readonly missions: MissionRepository
  /** Where a `challengeId` is resolved, against this event (spec 18). */
  readonly challenges: ChallengeRepository
  readonly media: MediaStore
  readonly imageProcessor: ImageProcessor
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly logger: Logger
  readonly limits: UploadLimits
}

export interface UploadOutcomeBase {
  /** Position in the request, so a client can match an outcome to its queue row. */
  readonly index: number
  readonly declaredName: string
}

export type UploadOutcome =
  | (UploadOutcomeBase & { readonly kind: 'stored'; readonly photoId: PhotoId })
  | (UploadOutcomeBase & { readonly kind: 'duplicate'; readonly photoId: PhotoId })
  | (UploadOutcomeBase & { readonly kind: 'refused'; readonly error: DomainError })

export interface UploadPhotosResult {
  /** One entry per submitted file, in the order they were submitted. */
  readonly outcomes: readonly UploadOutcome[]
  /** Ids published on ingest, so a guest on an auto-publish event is told it is live. */
  readonly published: readonly PhotoId[]
}

export type UploadPhotos = (
  input: UploadPhotosInput,
) => Promise<Result<UploadPhotosResult, DomainError>>

/**
 * What each stored variant is rendered to. The longest edges come from the `MediaStore`
 * port's table: 2560 px serves a 4K projector, 480 px serves a moderation grid.
 *
 * `original` goes through `render` as well rather than being copied through. The stored
 * bytes are always the pipeline's output — rotated upright, stripped of EXIF, and
 * re-encoded — so a polyglot file that is a valid JPEG *and* something else cannot
 * survive ingest, and a host's album never carries the GPS coordinates of a guest's
 * home. Its box is the domain's maximum edge, so it re-encodes without downscaling.
 */
export const VARIANT_SPECS: Readonly<Record<PhotoVariant, RenderSpec>> = {
  original: {
    maxWidth: Dimensions.maxEdge,
    maxHeight: Dimensions.maxEdge,
    quality: 92,
    format: 'jpeg',
  },
  display: { maxWidth: 2560, maxHeight: 2560, quality: 82, format: 'jpeg' },
  thumb: { maxWidth: 480, maxHeight: 480, quality: 72, format: 'jpeg' },
}

type RenderedVariants = Readonly<Record<PhotoVariant, RenderedImage>>

/**
 * All three variants, or the first reason none of them can be stored.
 *
 * Rendering every variant before a single byte is written is what makes the cleanup in
 * the caller bounded: a failure here has touched nothing.
 */
const renderVariants = async (
  imageProcessor: ImageProcessor,
  bytes: Uint8Array,
): Promise<Result<RenderedVariants, DomainError>> => {
  const display = await imageProcessor.render(bytes, VARIANT_SPECS.display)
  if (!display.ok) return display

  const thumb = await imageProcessor.render(bytes, VARIANT_SPECS.thumb)
  if (!thumb.ok) return thumb

  const original = await imageProcessor.render(bytes, VARIANT_SPECS.original)
  if (!original.ok) return original

  return ok({ display: display.value, thumb: thumb.value, original: original.value })
}

/**
 * Restates the outcomes of the photos the write transaction did not keep.
 *
 * Two ways to not be kept. `turnedAway`: a limit refused it. `lostTo`: a byte-identical
 * photo was committed first, so the file is already in the album under the twin's id.
 *
 * A `duplicate` outcome is restated too, not only a `stored` one: it names a photo
 * earlier in this same request, and if that photo was never written there is nothing
 * left for it to point at.
 */
const settle = (
  outcomes: readonly UploadOutcome[],
  turnedAway: ReadonlyMap<PhotoId, DomainError>,
  lostTo: ReadonlyMap<PhotoId, PhotoId>,
): readonly UploadOutcome[] =>
  outcomes.map((outcome) => {
    if (outcome.kind === 'refused') return outcome

    // A photo that lost the race to a byte-identical twin is a duplicate of the twin, and
    // so is every later file of this request that was a duplicate of *it*.
    const twin = lostTo.get(outcome.photoId)
    if (twin !== undefined) {
      return { index: outcome.index, declaredName: outcome.declaredName, kind: 'duplicate', photoId: twin }
    }

    const error = turnedAway.get(outcome.photoId)
    if (error === undefined) return outcome
    return { index: outcome.index, declaredName: outcome.declaredName, kind: 'refused', error }
  })

interface UploadTags {
  readonly mission: MissionId | null
  readonly challenge: ChallengeId | null
}

/**
 * The mission tag and the challenge tag of a request, each resolved against **this** event.
 *
 * **The mission tag** (roadmap §2.1). A mission id is the one identifier in this request that a
 * guest's phone chose, so the scoped lookup is the tenant boundary: without it, a phone at one
 * wedding could file a photograph under a stranger's prompt and their wall would count it. What
 * is stored is the id the repository handed back, so a tag that named another event — or nothing
 * — is a tag that is not stored.
 *
 * **An unresolvable tag drops the tag and keeps the photographs.** It refused the whole request
 * until review, which was wrong in the one direction that costs a guest their evening. The bytes
 * were never the problem: the identical photographs are accepted by this identical route with
 * the tag left off. And a refusal here does not stay in the guest's hands — an upload queued on
 * venue Wi-Fi replays through the outbox, where a refusal on its merits means the entry is
 * **removed from the device** (`web/src/lib/offline/outboxPolicy.ts`), so a host correcting a
 * typo on the mission list by deleting and re-adding it would have deleted three photographs off
 * a phone whose owner had already put it away.
 *
 * Nothing is silently lost by dropping it either, which is what made the refusal look
 * defensible: the guest's checklist is re-read after every settled batch, and the row the tag
 * named is gone from it — so what they see is the truth. The log line is for the operator,
 * because a *malformed* tag is a client bug rather than an evening.
 *
 * **The challenge tag** (spec 18), resolved against this event and the clock. It is the phone
 * that says "I took part" and the server that decides: only the event's latest challenge
 * qualifies, and only for an upload received inside its window (a minute of tolerance after the
 * end, for a late send). Anything else drops the tag and keeps the photographs, for the reason
 * the mission tag does. A challenge launched from a mission files the photograph under it too,
 * unless the guest chose another mission.
 */
const resolveTags = async (
  {
    missions,
    challenges,
    clock,
    logger,
  }: Pick<UploadPhotosDeps, 'missions' | 'challenges' | 'clock' | 'logger'>,
  eventId: EventId,
  missionId: MissionId | null | undefined,
  challengeId: ChallengeId | null | undefined,
): Promise<UploadTags> => {
  let mission: MissionId | null = null
  if (missionId !== undefined && missionId !== null) {
    const found = await missions.findById(eventId, missionId)
    if (found === null) {
      logger.warn('an upload named a mission this event does not have; storing it untagged', {
        eventId,
        missionId,
      })
    }
    mission = found?.id ?? null
  }

  let challenge: ChallengeId | null = null
  if (challengeId !== undefined && challengeId !== null) {
    const latest = await challenges.findLatest(eventId)
    if (latest !== null && latest.id === challengeId && latest.canAnswer(clock.now())) {
      challenge = latest.id
      if (mission === null && latest.missionId !== null) {
        mission = (await missions.findById(eventId, latest.missionId))?.id ?? null
      }
    } else {
      logger.warn('an upload named a challenge that is not running here; storing it plain', {
        eventId,
        challengeId,
      })
    }
  }

  return { mission, challenge }
}

/**
 * A cap is a fairness tool between guests, so it does not apply to the host's own camera
 * roll. Storage is the byte quota's job, and that is checked per file.
 *
 * Refusing the whole request here, before anything is decoded, is what keeps a guest who is
 * already at their limit from costing the box a single decode. It is not the enforcing check:
 * the repository takes this count again inside the write transaction, where a second request
 * of theirs cannot slip past it.
 */
const guestCapRefusal = async (
  photos: PhotoRepository,
  eventId: EventId,
  author: PhotoAuthor,
  maxPerGuest: number | null,
  incoming: number,
): Promise<DomainError | null> => {
  if (maxPerGuest === null || author.kind !== 'guest') return null
  const already = await photos.countByAuthor(eventId, author.guestId)
  if (already + incoming <= maxPerGuest) return null
  return DomainError.quotaExceeded('event.photoLimitReached', { max: maxPerGuest, already })
}

/**
 * The twins of a batch: for each photo the insert did not keep, the row that now holds its
 * digest.
 *
 * This request never commits one digest twice, so any row found is somebody else's. A lookup
 * that fails is the same answer as no twin — the caller then reports a failed save, or a
 * refusal, which is what an answer it cannot explain deserves.
 */
const twinsCommittedFirst = async (
  photos: PhotoRepository,
  eventId: EventId,
  batch: readonly Photo[],
): Promise<ReadonlyMap<PhotoId, PhotoId>> => {
  const twins = new Map<PhotoId, PhotoId>()
  try {
    for (const photo of batch) {
      const twin = await photos.findByContentHash(eventId, photo.contentHash)
      if (twin !== null) twins.set(photo.id, twin.id)
    }
  } catch {
    return new Map()
  }
  return twins
}

/** What a request has put into the media store, and how it takes it back. */
interface MediaLedger {
  /** Recorded before the write, so a failure part-way through the variants still removes the ones that landed. */
  record(hash: ContentHash): void
  /** Take back every digest the request wrote, except the ones a committed row names. */
  unwind(): Promise<void>
  discardUnlessReferenced(hash: ContentHash): Promise<void>
}

const makeMediaLedger = (
  { photos, media, logger }: Pick<UploadPhotosDeps, 'photos' | 'media' | 'logger'>,
  eventId: EventId,
): MediaLedger => {
  /** Hashes this request put into the store, so a failure removes exactly them. */
  const written: ContentHash[] = []

  /**
   * Take back one digest this request wrote — **unless a committed row names it.**
   *
   * Media is content-addressed and `photos (event_id, content_hash)` is unique, so two
   * guests sending the same photo at the same moment both miss `findByContentHash`, both
   * write the same three files, and one of them then loses the insert. Deleting "its"
   * files at that point took the winner's slide with it: a row in the album, a tile on
   * the wall, and nothing to serve under it. Every deletion this request makes goes
   * through here, so the question is asked in one place.
   *
   * If the question cannot be asked — the same locked database that sent us here — the
   * file stays. A leaked file is swept by `sweepOrphanedMedia`; a deleted file that a
   * row names cannot be rebuilt by anything. For the same reason an unlink that fails
   * is logged and not thrown: the refusal loop runs after the batch has committed, and a
   * throw there would leave the stored photos unannounced and the guest with a 500 for
   * photographs that are in the album.
   */
  const discardUnlessReferenced = async (hash: ContentHash): Promise<void> => {
    try {
      if ((await photos.findIdsReferencing(eventId, hash)).length > 0) return
    } catch (cause) {
      logger.warn('could not tell whether a row names this media; leaving it for the sweep', {
        eventId,
        cause: String(cause),
      })
      return
    }

    try {
      await media.delete(eventId, hash)
    } catch (cause) {
      logger.warn('could not remove media this upload wrote; leaving it for the sweep', {
        eventId,
        cause: String(cause),
      })
    }
  }

  return {
    record: (hash) => {
      written.push(hash)
    },
    unwind: async () => {
      for (const hash of written) await discardUnlessReferenced(hash)
    },
    discardUnlessReferenced,
  }
}

/**
 * Header first, always, then every variant: the file's bytes turned into what will be stored,
 * or the first reason they cannot be. The pixel budget is the decompression-bomb control, and
 * it is only a control if it is decided before anything is decoded.
 */
const examineFile = async (
  imageProcessor: ImageProcessor,
  maxPixels: number,
  bytes: Uint8Array,
): Promise<Result<RenderedVariants, DomainError>> => {
  const probed = await imageProcessor.probe(bytes)
  if (!probed.ok) return probed
  if (probed.value.dimensions.exceedsPixelBudget(maxPixels)) {
    return err(
      DomainError.quotaExceeded('photo.pixelBudgetExceeded', {
        maxPixels,
        pixels: probed.value.dimensions.pixels,
      }),
    )
  }
  return renderVariants(imageProcessor, bytes)
}

/** What the cheap per-file quota checks read: advisory totals, taken before the first decode. */
interface QuotaView {
  readonly event: Event
  readonly ceilings: ClientCeilings | null
  readonly clientBytes: ClientByteLimit | null
  readonly usedBytes: number
  readonly clientUsedBytes: number
}

/**
 * The cheap check on the event's quota, then on its client's total — or `null` when the file
 * fits both. `addedBytes` accumulates, so ten files that each fit individually cannot
 * collectively overrun the quota.
 *
 * This is the cheap check, not the enforcing one: `usedBytes` was read before the first decode
 * and another request can commit against the same event while this one renders. Its job is to
 * stop a full event from decoding and writing three variants per file only to have them removed
 * again — which is the path a scanner that found the endpoint would hammer. The repository
 * decides for real. The client's total comes after the event's own and for the same reason:
 * refused here, a full client costs a decode and no writes; the transaction is what decides.
 */
const quotaRefusal = (
  view: QuotaView,
  addedBytes: number,
  byteSize: number,
): DomainError | null => {
  const { event, ceilings, clientBytes, usedBytes, clientUsedBytes } = view
  if (!event.hasQuotaFor(addedBytes + byteSize, usedBytes, ceilings)) {
    return DomainError.quotaExceeded('event.quotaExceeded', {
      remaining: event.remainingQuota(usedBytes + addedBytes, ceilings),
      required: byteSize,
    })
  }
  if (
    clientBytes !== null &&
    !fitsInQuota(clientBytes.maxBytes, clientUsedBytes, addedBytes + byteSize)
  ) {
    return DomainError.quotaExceeded('client.storageFull', { required: byteSize })
  }
  return null
}

/** What the per-file loop leaves for the write transaction. */
interface IngestedBatch {
  readonly outcomes: readonly UploadOutcome[]
  /** The photos whose media is on the disk and whose rows are still to be written. */
  readonly created: readonly Photo[]
}

interface IngestRequest {
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly caption: Caption | null
  readonly tags: UploadTags
  readonly now: Date
  readonly quota: QuotaView
}

/**
 * The per-file loop: probe, render, hash, recognise a repeat, check the quota, write the media.
 * A file that cannot be stored is a `refused` outcome and the loop goes on; only a failure that
 * would repeat for every file ends the request, and it unwinds first.
 */
const ingestFiles = async (
  deps: UploadPhotosDeps,
  ledger: MediaLedger,
  request: IngestRequest,
  files: readonly UploadFile[],
): Promise<Result<IngestedBatch, DomainError>> => {
  const { photos, media, imageProcessor, hasher, ids, logger, limits } = deps
  const { eventId, author, caption, tags, now, quota } = request

  const outcomes: UploadOutcome[] = []
  const created: Photo[] = []
  /** Hashes seen earlier in this same request, keyed by hex — a batch can duplicate. */
  const seen = new Map<string, PhotoId>()
  let addedBytes = 0

  for (const [index, file] of files.entries()) {
    const at = { index, declaredName: file.declaredName }

    const rendered = await examineFile(imageProcessor, limits.maxPixels, file.bytes)
    if (!rendered.ok) {
      outcomes.push({ ...at, kind: 'refused', error: rendered.error })
      continue
    }

    const digest = ContentHash.create(hasher.sha256Hex(rendered.value.display.bytes))
    if (!digest.ok) {
      // A hasher that does not return a digest is a broken adapter, not a bad photo:
      // the next file would fail the same way, so the request stops here.
      logger.error('content hasher returned something that is not a sha-256 digest', {
        eventId,
        code: digest.error.code,
      })
      await ledger.unwind()
      return err(DomainError.unexpected('photo.hashFailed'))
    }

    const twin = seen.get(digest.value.value)
    if (twin !== undefined) {
      outcomes.push({ ...at, kind: 'duplicate', photoId: twin })
      continue
    }

    const existing = await photos.findByContentHash(eventId, digest.value)
    if (existing !== null) {
      // A double-tapped "Envoyer", or a retry after the connection dropped mid-upload.
      // 1.0 answered it with a second identical slide on the wall.
      outcomes.push({ ...at, kind: 'duplicate', photoId: existing.id })
      continue
    }

    // Every variant counts against the quota, because every variant is on the disk the
    // quota exists to protect — and it is what the reconciliation of the listed bytes compares with.
    const byteSize =
      rendered.value.original.byteSize +
      rendered.value.display.byteSize +
      rendered.value.thumb.byteSize

    const refusal = quotaRefusal(quota, addedBytes, byteSize)
    if (refusal !== null) {
      outcomes.push({ ...at, kind: 'refused', error: refusal })
      continue
    }

    const photo = Photo.create(
      {
        eventId,
        author,
        contentHash: digest.value,
        // The display variant's dimensions: what the wall lays out is what it serves.
        dimensions: rendered.value.display.dimensions,
        byteSize,
        caption,
        missionId: tags.mission,
        challengeId: tags.challenge,
      },
      ids.photoId(),
      now,
    )
    if (!photo.ok) {
      await ledger.unwind()
      return photo
    }

    // Recorded before the write, so a failure part-way through the variants still
    // removes the ones that landed — `delete` covers every variant and is idempotent.
    ledger.record(digest.value)
    try {
      for (const variant of MEDIA_VARIANTS) {
        await media.put(eventId, digest.value, variant, rendered.value[variant].bytes)
      }
    } catch (cause) {
      logger.error('media write failed during ingest; removing what this upload wrote', {
        eventId,
        cause: String(cause),
      })
      await ledger.unwind()
      return err(DomainError.unexpected('photo.mediaWriteFailed'))
    }

    seen.set(digest.value.value, photo.value.id)
    created.push(photo.value)
    addedBytes += byteSize
    outcomes.push({ ...at, kind: 'stored', photoId: photo.value.id })
  }

  return ok({ outcomes, created })
}

/** What the write transaction kept, and what it did not. */
interface Committed {
  /** The photos still standing after twins were set aside. */
  readonly pending: readonly Photo[]
  readonly admissions: readonly PhotoAdmission[]
  /** Photos that lost the race to a byte-identical twin, with the twin's id. */
  readonly lostTo: Map<PhotoId, PhotoId>
}

/**
 * Media first, row second, and the rows in one transaction. 1.0 inserted first and fired one
 * insert per file, so a failure left rows pointing at nothing and a guest with no way to tell
 * which of their photos had landed.
 *
 * The limits travel with the batch because this is where they are *enforced*. The checks in
 * the loop read totals that another request in flight can invalidate before this one commits;
 * the repository takes them again inside the write transaction, where nothing can interleave,
 * and refuses what no longer fits. So a photo can still be turned away here, after its media
 * has been written — which is why the unwinding is per photo rather than per request.
 *
 * **A raise is not necessarily a failure.** The insert is all-or-nothing, and
 * `(event_id, content_hash)` is unique: a byte-identical photo committed since the duplicate
 * check makes it raise for the whole batch. Asking again tells the two apart without matching
 * on a driver's message — a photo whose digest now has a row has lost to that row and is
 * answered `duplicate`, exactly as `uploadClip` answers the same race, and the rest of the
 * batch is written without it. A pass that raises drops at least one photo, so one pass per
 * photo is all there can ever be; a raise with no twin behind it is a real failure.
 */
const commitBatch = async (
  { photos, logger }: Pick<UploadPhotosDeps, 'photos' | 'logger'>,
  ledger: MediaLedger,
  eventId: EventId,
  created: readonly Photo[],
  limits: PhotoAdmissionLimits,
): Promise<Result<Committed, DomainError>> => {
  let pending: readonly Photo[] = created
  const lostTo = new Map<PhotoId, PhotoId>()
  let admissions: readonly PhotoAdmission[] = []
  for (let pass = 0; pass < created.length && pending.length > 0; pass += 1) {
    try {
      admissions = await photos.saveManyWithinLimits(eventId, pending, limits)
      break
    } catch (cause) {
      const twins = await twinsCommittedFirst(photos, eventId, pending)
      if (twins.size === 0) {
        logger.error('photo insert failed; removing the media this upload wrote', {
          eventId,
          cause: String(cause),
        })
        await ledger.unwind()
        return err(DomainError.unexpected('photo.saveFailed'))
      }

      logger.info('an identical photo was committed first; answering with the one it made', {
        eventId,
      })
      for (const [photoId, twinId] of twins) lostTo.set(photoId, twinId)
      pending = pending.filter((photo) => !twins.has(photo.id))
    }
  }
  return ok({ pending, admissions, lostTo })
}

/**
 * Sorts what the transaction decided: the photos that are in the album, the ones a limit
 * turned away, and (added to `lostTo`) the ones a twin beat. A photo that is not in the album
 * has its media taken back, unless a row names it.
 */
const settleAdmissions = async (
  { photos }: Pick<UploadPhotosDeps, 'photos'>,
  ledger: MediaLedger,
  eventId: EventId,
  { pending, admissions, lostTo }: Committed,
): Promise<{
  readonly admitted: readonly Photo[]
  readonly turnedAway: ReadonlyMap<PhotoId, DomainError>
}> => {
  const refusals = new Map<PhotoId, PhotoRefusal>()
  for (const admission of admissions) {
    if (admission.refusal !== null) refusals.set(admission.photoId, admission.refusal)
  }

  // A limit is decided before the unique index is reached, so the same race that raises
  // in `commitBatch` can also surface as a refusal: a guest double-tapping the same photograph
  // at their limit has the second tap turned away for a photograph the album already holds.
  // Telling them it was refused is telling them to retry a photo that is there, and an
  // offline outbox drops a refused entry. A refused photo whose bytes now have a row is
  // a duplicate of that row.
  const twinsOfRefused = await twinsCommittedFirst(
    photos,
    eventId,
    pending.filter((photo) => refusals.has(photo.id)),
  )

  const turnedAway = new Map<PhotoId, DomainError>()
  const admitted: Photo[] = []
  for (const photo of pending) {
    const refusal = refusals.get(photo.id)
    if (refusal === undefined) {
      admitted.push(photo)
      continue
    }

    const twin = twinsOfRefused.get(photo.id)
    if (twin === undefined) turnedAway.set(photo.id, admissionRefusalError(refusal, photo.byteSize))
    else lostTo.set(photo.id, twin)

    // Its row was never written, so its media must not stay on the disk that the
    // quota exists to protect. Media is addressed by content, though, and the request
    // that beat this one to the quota may have been a byte-identical photo from
    // another guest — whose row now holds this hash. Deleting then would leave *their*
    // slide pointing at nothing, so the file goes only if nothing points at it.
    //
    // `storageHashes` rather than `contentHash`: this path only ever holds still
    // photographs, where the two are the same one digest, but a delete that names
    // the row rather than one of its fields does not have to be revisited the day it
    // is reached with something that owns two.
    for (const hash of photo.storageHashes) await ledger.discardUnlessReferenced(hash)
  }
  return { admitted, turnedAway }
}

export const makeUploadPhotos = (deps: UploadPhotosDeps): UploadPhotos => {
  const { events, clients, photos, bus, clock } = deps
  return async ({ eventId, author, files, caption, missionId, challengeId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // The single gate that makes a public upload endpoint safe. 1.0 accepted any
    // `partyname` and created a directory for it, so anyone who found the URL could
    // write to the disk forever.
    if (!event.acceptsUploads()) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }

    const settings = event.settings

    // The client's ceilings, for an event that has one. Read once, up front, and used three
    // ways below: the quota this event is judged against (its own, lowered to the client's
    // `max_event_quota_bytes`), the cheap check on the client's total, and the limit handed
    // to the write transaction that actually enforces both.
    const context = await clientContextOf(clients, event)
    const ceilings = context?.ceilings ?? null
    const quotaBytes = event.effectiveQuotaBytes(ceilings)
    const clientBytes = clientBytesOf(context)

    // Parsed before the policy check so that "blank means no caption" is decided in one
    // place — an untouched form field must not trip a captions-off event.
    const parsedCaption = Caption.createOptional(caption)
    if (!parsedCaption.ok) return parsedCaption
    if (parsedCaption.value !== null && !settings.allowCaptions) {
      return err(DomainError.forbidden('event.captionsNotAllowed'))
    }

    const tags = await resolveTags(deps, eventId, missionId, challengeId)

    const maxPerGuest = settings.maxPhotosPerGuest
    const capRefusal = await guestCapRefusal(photos, eventId, author, maxPerGuest, files.length)
    if (capRefusal !== null) return err(capRefusal)

    const now = clock.now()
    const usedBytes = await photos.totalBytes(eventId)
    // Advisory, like `usedBytes`: it is only read when there is a ceiling to read it against.
    const clientUsedBytes =
      clientBytes === null ? 0 : await photos.clientTotalBytes(clientBytes.clientId)

    const ledger = makeMediaLedger(deps, eventId)

    const ingested = await ingestFiles(
      deps,
      ledger,
      {
        eventId,
        author,
        caption: parsedCaption.value,
        tags,
        now,
        quota: { event, ceilings, clientBytes, usedBytes, clientUsedBytes },
      },
      files,
    )
    if (!ingested.ok) return ingested

    const committed = await commitBatch(deps, ledger, eventId, ingested.value.created, {
      quotaBytes,
      maxPhotosPerGuest: maxPerGuest,
      clientBytes,
    })
    if (!committed.ok) return committed

    const { admitted, turnedAway } = await settleAdmissions(deps, ledger, eventId, committed.value)

    // An auto-publish event records an `automatic` reviewer immediately, so the wall
    // never shows a photo whose decision nobody can account for afterwards. Going
    // through the bulk update means the announcement below names exactly the rows that
    // actually moved.
    const published =
      settings.moderation === 'auto'
        ? await photos.updateStatuses(
            eventId,
            admitted.map((photo) => photo.id),
            'published',
            { kind: 'automatic', at: now },
          )
        : []

    for (const photo of admitted) {
      bus.publish({ type: 'photo.uploaded', eventId, photoId: photo.id })
    }
    for (const photoId of published) {
      bus.publish({ type: 'photo.moderated', eventId, photoId, status: 'published' })
    }

    return ok({
      outcomes: settle(ingested.value.outcomes, turnedAway, committed.value.lostTo),
      published,
    })
  }
}
