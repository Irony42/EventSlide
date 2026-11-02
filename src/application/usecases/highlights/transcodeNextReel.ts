import { isReelEligible } from '../../../domain/highlights/highlightEligibility'
import type { ReelJob } from '../../../domain/highlights/reelJob'
import { MIN_REEL_PHOTOS } from '../../../domain/highlights/reelPlan'
import { ContentHash } from '../../../domain/photos/contentHash'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { Event } from '../../../domain/events/event'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import { REEL_VARIANT, type MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReelRepository } from '../../ports/reelRepository'
import type { ReelRenderer, ReelSpec } from '../../ports/reelRenderer'
import { clientBytesOf, clientContextOf } from '../clients/clientContextOf'

/**
 * One step of the highlight reel's queue (spec 08): claim the montage, make it, store it, and say
 * so. The sibling of `transcodeNextClip`, with the same shape and the same failure scales.
 *
 * What is different, and each point is a rule:
 *
 * - **The event is read twice**: when the job is taken and again just before the row is written
 *   `done`. A montage is not made for an event that cannot be served any more (taken down by the
 *   operator, suspended client, archived), and a file with no one allowed to read it is disk
 *   still counted. `reel.eventUnavailable` is permanent and keeps no file.
 * - **Every photograph is judged again** when the job is taken (published, a photograph, not
 *   taken down): one that is not makes the montage `stale`, not a shorter one. A photograph whose
 *   *file* is missing is skipped; fewer than three left is `reel.notEnoughPhotos`.
 * - **The last word is the repository's**: `finish` re-checks every photograph and the quota in
 *   the write transaction. A photograph removed while the encoder ran gives `stale` and the file
 *   is deleted, never a `done` row over a removed photograph.
 *
 * No text from the evening reaches the encoder, and the frames are the `display` renditions the
 * image pipeline produced: nothing a guest sent is handed over as it was sent.
 */

export interface TranscodeReelPolicy {
  readonly secondsPerPhoto: number
  readonly maxOutputBytes: number
}

export interface TranscodeNextReelDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: ClientRepository
  readonly photos: PhotoRepository
  readonly reels: ReelRepository
  readonly media: MediaStore
  readonly renderer: ReelRenderer
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: TranscodeReelPolicy
}

export type TranscodeNextReelOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'rendered'; readonly eventId: EventId }
  /** A photograph left the evening while the job waited or ran: no file is kept. */
  | { readonly kind: 'stale'; readonly eventId: EventId }
  | {
      readonly kind: 'failed'
      readonly eventId: EventId
      readonly code: string
      readonly willRetry: boolean
    }

export type TranscodeNextReel = () => Promise<Result<TranscodeNextReelOutcome, DomainError>>

const unavailable = (event: Event): boolean =>
  event.isTakenDown() || event.isClientSuspended() || !event.allowsModeration()

export const makeTranscodeNextReel = ({
  events,
  clients,
  photos,
  reels,
  media,
  renderer,
  hasher,
  bus,
  clock,
  logger,
  policy,
}: TranscodeNextReelDeps): TranscodeNextReel => {
  const spec: ReelSpec = {
    secondsPerPhoto: policy.secondsPerPhoto,
    maxOutputBytes: policy.maxOutputBytes,
  }

  const discard = async (eventId: EventId, hash: ContentHash): Promise<void> => {
    await media.delete(eventId, hash).catch((cause: unknown) => {
      logger.warn('could not remove a highlight reel’s file; left for the orphan sweep', {
        eventId,
        cause: String(cause),
      })
    })
  }

  const giveUpOn = async (
    job: ReelJob,
    code: string,
  ): Promise<Result<TranscodeNextReelOutcome, DomainError>> => {
    const failed = job.fail(code, clock.now())
    if (!failed.ok) return failed

    const givingUp = failed.value.status !== 'queued'
    const stillThere = await reels.save(failed.value)
    if (stillThere && givingUp) bus.publish({ type: 'reel.failed', eventId: job.eventId, code })

    logger.warn('highlight reel failed', {
      eventId: job.eventId,
      code,
      attempts: failed.value.attempts,
      willRetry: stillThere && !givingUp,
    })
    return ok({
      kind: 'failed',
      eventId: job.eventId,
      code,
      willRetry: stillThere && !givingUp,
    })
  }

  const spoil = async (job: ReelJob): Promise<Result<TranscodeNextReelOutcome, DomainError>> => {
    const stale = job.makeStale(clock.now())
    if (!stale.ok) return stale
    await reels.save(stale.value)
    return ok({ kind: 'stale', eventId: job.eventId })
  }

  return async () => {
    const job = await reels.claimNext(clock.now())
    if (job === null) return ok({ kind: 'idle' })
    const { eventId } = job

    const event = await events.findById(eventId)
    if (event === null) return giveUpOn(job, 'event.notFound')
    if (unavailable(event)) return giveUpOn(job, 'reel.eventUnavailable')

    const context = await clientContextOf(clients, event)
    if (context !== null && !context.ceilings.clipsAllowed) return giveUpOn(job, 'reel.notAllowed')

    // Every photograph, judged now. Not "skipped": a removed one makes this montage stale.
    const frames: Uint8Array[] = []
    for (const photoId of job.photoIds) {
      const photo = await photos.findById(eventId, photoId)
      if (photo === null || !isReelEligible(photo.status, photo.kind)) return spoil(job)

      const bytes = await media.read(eventId, photo.contentHash, 'display')
      if (bytes === null) {
        // The only silent skip: a file that is not there. The montage goes on without it.
        logger.warn('a highlight reel skipped a photograph with no stored file', {
          eventId,
          photoId,
        })
        continue
      }
      frames.push(bytes)
    }
    if (frames.length < MIN_REEL_PHOTOS) return giveUpOn(job, 'reel.notEnoughPhotos')

    if (!renderer.available()) return giveUpOn(job, 'reel.transcoderUnavailable')
    const rendered = await renderer.render(frames, spec)
    if (!rendered.ok) return giveUpOn(job, rendered.error.code)

    const hash = ContentHash.create(hasher.sha256Hex(rendered.value.bytes))
    if (!hash.ok) return giveUpOn(job, 'reel.storageFailed')
    try {
      await media.put(eventId, hash.value, REEL_VARIANT, rendered.value.bytes)
    } catch (cause) {
      logger.error('could not store a highlight reel; removing what this pass wrote', {
        eventId,
        cause: String(cause),
      })
      await discard(eventId, hash.value)
      return giveUpOn(job, 'reel.storageFailed')
    }

    // Read again, last: a montage is not kept for an event that stopped being servable meanwhile.
    const latest = await events.findById(eventId)
    if (latest === null || unavailable(latest)) {
      await discard(eventId, hash.value)
      return giveUpOn(job, latest === null ? 'event.notFound' : 'reel.eventUnavailable')
    }

    const ceilings = context?.ceilings ?? null
    const verdict = await reels.finish(
      job,
      {
        hash: hash.value,
        byteSize: rendered.value.byteSize,
        durationMs: rendered.value.durationMs,
      },
      { quotaBytes: latest.effectiveQuotaBytes(ceilings), clientBytes: clientBytesOf(context) },
      clock.now(),
    )

    switch (verdict.kind) {
      case 'done':
        return ok({ kind: 'rendered', eventId })
      case 'stale':
      case 'gone':
        await discard(eventId, hash.value)
        return ok({ kind: 'stale', eventId })
      case 'refused':
        await discard(eventId, hash.value)
        return giveUpOn(
          job,
          verdict.refusal.reason === 'quotaExceeded' ? 'event.quotaExceeded' : 'client.storageFull',
        )
    }
  }
}
