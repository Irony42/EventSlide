import type { ClipJobStatus } from '../../../domain/clips/clipJobStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoActor } from '../../../domain/photos/photo'
import type { ClipJobId, EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClipJobRepository } from '../../ports/clipJobRepository'

/**
 * "Where is my clip?"
 *
 * The one question a guest has during the window this whole design creates: between the
 * upload and the transcode there is no `photos` row, so `GET /photos/mine` has nothing
 * to show them and would otherwise leave a guest wondering whether the upload worked —
 * which is how 1.0 got the same photo three times.
 *
 * Every refusal is `clipJob.notFound`, never `forbidden`, for the same reason the media
 * route answers 404 across events: a 403 would confirm that a job id exists inside an
 * event the caller cannot see, and these ids are handed out to phones.
 */

export interface GetClipJobInput {
  readonly eventId: EventId
  readonly clipJobId: ClipJobId
  readonly actor: PhotoActor
}

export interface ClipJobView {
  readonly clipJobId: ClipJobId
  readonly status: ClipJobStatus
  /**
   * The row this job will produce. Present whatever the status, because it is fixed at
   * staging — but it names an existing photo only once the status is `done`.
   */
  readonly photoId: PhotoId
  readonly createdAt: Date
  /** The stable code behind a `failed` status, which the client words in French. */
  readonly failureCode: string | null
}

export interface GetClipJobDeps {
  readonly clips: ClipJobRepository
}

export type GetClipJob = (input: GetClipJobInput) => Promise<Result<ClipJobView, DomainError>>

export const makeGetClipJob = ({ clips }: GetClipJobDeps): GetClipJob => {
  return async ({ eventId, clipJobId, actor }) => {
    // Scoped: passing the event id is what makes a job from another evening invisible
    // rather than merely forbidden.
    const job = await clips.findById(eventId, clipJobId)
    if (job === null) return err(DomainError.notFound('clipJob.notFound'))

    // A host may look at any of them — they own the album. A guest may look at their
    // own, which is the entity's rule and not a middleware's.
    if (actor.kind === 'guest' && !job.isAuthoredBy(actor)) {
      return err(DomainError.notFound('clipJob.notFound'))
    }

    return ok({
      clipJobId: job.id,
      status: job.status,
      photoId: job.photoId,
      createdAt: job.createdAt,
      failureCode: job.failureCode,
    })
  }
}
