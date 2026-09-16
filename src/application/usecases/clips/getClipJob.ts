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
  /**
   * Who is asking. Carried so the shape matches every other guest-facing use case and so
   * a route cannot reach this without having resolved somebody — but the decision below
   * is **event membership**, not authorship. Read the note in the body before changing it.
   */
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
  return async ({ eventId, clipJobId }) => {
    // Scoped: passing the event id is what makes a job from another evening invisible
    // rather than merely forbidden.
    const job = await clips.findById(eventId, clipJobId)
    if (job === null) return err(DomainError.notFound('clipJob.notFound'))

    /**
     * **Event membership, deliberately — not authorship. Do not tighten this.**
     *
     * The obvious rule is "a guest may poll their own job", and it was wrong here for a
     * reason that only shows up once the dedupe exists. `findBySourceHash` is scoped by
     * *event*, so two guests uploading the same video from the group chat — or one guest
     * on a phone and a laptop — share **one** job, and the second is handed the first's
     * id in a `202`. An authorship check then answered their very next poll with
     * "cette vidéo n'existe plus", in French, about an upload the server had just
     * accepted.
     *
     * Widening the dedupe per author is not the alternative: two guests sending the same
     * video must still produce one slide on the wall, which is the whole point of it.
     *
     * What this discloses to a guest holding a job id is the status of a clip somebody at
     * the same event uploaded. A clip job id is an unguessable v4 uuid handed only to the
     * client that staged those bytes — exactly the posture photo ids already have, and
     * the view carries no author, no caption and no bytes.
     */

    return ok({
      clipJobId: job.id,
      status: job.status,
      photoId: job.photoId,
      createdAt: job.createdAt,
      failureCode: job.failureCode,
    })
  }
}
