import { DomainError } from '../../../domain/shared/errors'
import type { PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { SitePhotoState } from './takedownState'

/**
 * Where a photograph is and whether it is down, by its id alone (`GET /api/site/photos/:photoId`):
 * what `locate` answers, an event id and an instant, and nothing about the photograph itself.
 */
export interface GetSitePhotoStateDeps {
  readonly photos: Pick<PhotoRepository, 'locate'>
}

export type GetSitePhotoState = (input: {
  readonly photoId: PhotoId
}) => Promise<Result<SitePhotoState, DomainError>>

export const makeGetSitePhotoState =
  ({ photos }: GetSitePhotoStateDeps): GetSitePhotoState =>
  async ({ photoId }) => {
    const located = await photos.locate(photoId)
    if (located === null) return err(DomainError.notFound('photo.notFound'))
    return ok({ id: photoId, eventId: located.eventId, takenDownAt: located.takenDownAt })
  }
