import { planReel, MIN_REEL_PHOTOS } from '../../../domain/highlights/reelPlan'
import { ReelJob } from '../../../domain/highlights/reelJob'
import { isReelEligible } from '../../../domain/highlights/highlightEligibility'
import { retryAfterSecondsFor } from '../../../domain/clips/clipQueue'
import type { Photo } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import { asReelId, type EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReelRefusal, ReelRepository } from '../../ports/reelRepository'
import type { ReelRenderer } from '../../ports/reelRenderer'
import { clientBytesOf, clientContextOf } from '../clients/clientContextOf'
import { requireWritable } from '../shared/eventRole'

/**
 * The host asks for the montage of their favourites (spec 08).
 *
 * The selection is the favourites that can be montaged, frozen now: starred later, they are not
 * taken. The server never cuts a selection short (`reel.tooManyPhotos`) and never makes a montage
 * of fewer than three (`reel.notEnoughPhotos`).
 *
 * **One montage per event.** Asking again on a finished, failed or stale row reuses it, and the
 * old file is deleted *now*, not when the new one is done, or two files would be counted against
 * the quota and a montage that no longer matches would be served while the new one renders.
 *
 * Admission is judged inside the repository's write transaction (not already running, the box's
 * queue, room for the largest montage once the old file is let go), so it holds under concurrent
 * clicks. The final write judges the quota again with the real size.
 *
 * Starring is a moderation decision, so an archived event is refused; so is a suspended client or
 * a taken-down event. A client with no video (`clips_allowed = false`) is refused too: a montage
 * needs the same encoder and disk.
 */

export interface ReelRequestPolicy {
  /** `REEL_ENABLED`: the operator's switch. */
  readonly enabled: boolean
  readonly maxPhotos: number
  readonly secondsPerPhoto: number
  /** The largest file a montage may become: the room admission asks for. */
  readonly maxOutputBytes: number
  readonly maxQueued: number
}

export interface RequestReelDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: ClientRepository
  readonly photos: PhotoRepository
  readonly reels: ReelRepository
  readonly renderer: Pick<ReelRenderer, 'available'>
  readonly media: MediaStore
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: ReelRequestPolicy
}

export type RequestReel = (input: {
  readonly eventId: EventId
}) => Promise<Result<ReelJob, DomainError>>

const PAGE = 200

const refusalError = (refusal: ReelRefusal, reservedBytes: number): DomainError => {
  switch (refusal.reason) {
    case 'alreadyRunning':
      return DomainError.conflict('reel.alreadyRunning')
    case 'queueFull':
      return DomainError.rateLimited('reel.queueFull', {
        depth: refusal.depth,
        maxDepth: refusal.maxDepth,
        retryAfterSeconds: retryAfterSecondsFor(refusal.depth),
      })
    case 'quotaExceeded':
      return DomainError.conflict('event.quotaExceeded', {
        remaining: refusal.remaining,
        required: reservedBytes,
      })
    case 'clientStorageFull':
      return DomainError.conflict('client.storageFull', { required: reservedBytes })
  }
}

export const makeRequestReel =
  ({
    events,
    clients,
    photos,
    reels,
    renderer,
    media,
    bus,
    clock,
    logger,
    policy,
  }: RequestReelDeps): RequestReel =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const writable = requireWritable(event)
    if (!writable.ok) return writable
    // A record nobody moderates: its montage cannot be made either.
    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.immutable', { status: event.status }))
    }

    if (!policy.enabled) return err(DomainError.forbidden('reel.notAllowed'))
    const context = await clientContextOf(clients, event)
    if (context !== null && !context.ceilings.clipsAllowed) {
      return err(DomainError.forbidden('reel.notAllowed'))
    }
    if (!renderer.available()) return err(DomainError.unexpected('reel.transcoderUnavailable'))

    // The favourites that can be montaged, oldest first. Stops as soon as there are more than
    // the montage may hold: the answer is then `tooManyPhotos`, whatever the rest is.
    const candidates: Photo[] = []
    let cursor: string | null = null
    do {
      const page = await photos.list(eventId, {
        statuses: ['published'],
        highlightedOnly: true,
        oldestFirst: true,
        limit: PAGE,
        ...(cursor === null ? {} : { cursor }),
      })
      for (const photo of page.items) {
        if (isReelEligible(photo.status, photo.kind)) candidates.push(photo)
      }
      cursor = candidates.length > policy.maxPhotos ? null : page.nextCursor
    } while (cursor !== null)

    const plan = planReel(
      candidates.map((photo) => ({ id: photo.id, createdAt: photo.createdAt })),
      {
        minPhotos: MIN_REEL_PHOTOS,
        maxPhotos: policy.maxPhotos,
        secondsPerPhoto: policy.secondsPerPhoto,
      },
    )
    if (!plan.ok) return plan

    const now = clock.now()
    const existing = await reels.findByEvent(eventId)
    // One row per event, under one id: the event's own.
    const job =
      existing === null
        ? ok(ReelJob.request({ id: asReelId(eventId), eventId, photoIds: plan.value.order }, now))
        : existing.rerequest(plan.value.order, now)
    if (!job.ok) return err(DomainError.conflict('reel.alreadyRunning'))

    const ceilings = context?.ceilings ?? null
    const admission = await reels.request(job.value, {
      quotaBytes: event.effectiveQuotaBytes(ceilings),
      clientBytes: clientBytesOf(context),
      reservedBytes: policy.maxOutputBytes,
      maxQueued: policy.maxQueued,
    })
    if (admission.refusal !== null) {
      return err(refusalError(admission.refusal, policy.maxOutputBytes))
    }

    // The old montage is gone from the row; its file goes now. A failure here only leaves a file
    // no row names, which the orphan sweep collects.
    if (admission.replacedOutput !== null) {
      await media.delete(eventId, admission.replacedOutput).catch((cause: unknown) => {
        logger.warn('could not remove the previous highlight reel; left for the orphan sweep', {
          eventId,
          cause: String(cause),
        })
      })
    }

    // Last, after the row says it is queued: a subscriber must never learn of work that cannot
    // be done yet. This is what wakes the worker.
    bus.publish({ type: 'reel.queued', eventId })
    return ok(job.value)
  }
