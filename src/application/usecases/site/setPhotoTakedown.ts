import { parseAuditReason } from '../../../domain/audit/auditReason'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { PhotoRepository } from '../../ports/photoRepository'
import { recordOperatorAct, type OperatorActInput } from './operatorAct'

/**
 * Takes one photograph down, or puts it back, **by its id alone** (`POST /api/site/photos/:photoId/take-down`
 * and `/restore`; launch review S5, G8-03; the rules every operator act shares are in `operatorAct.ts`).
 *
 * It is gone from the wall, the guest feed, a gallery link, the host's grid and the media route at
 * once, because the photo repository's reads leave a taken-down row out. **Every screen is told**
 * (`photo.takenDown`, a signal with ids and nothing else) so a projector drops it on its next read
 * instead of waiting for a refresh. The row, its bytes and its quota charge stay, for an authority
 * that asks for them.
 *
 * An id no photograph holds is `404 photo.notFound`: the operator is the one caller entitled to
 * ask which ids exist, and a typo must not read as success. The use case never reads the
 * photograph: `locate` answers an event id and an instant, which is the whole of what it needs.
 */

export interface SetPhotoTakedownInput extends OperatorActInput {
  readonly photoId: PhotoId
  /** `true` takes it down, `false` puts it back. */
  readonly down: boolean
}

export interface SetPhotoTakedownDeps {
  readonly photos: Pick<PhotoRepository, 'locate' | 'setTakenDown'>
  readonly audit: AuditRecorder
  readonly bus: Pick<EventBus, 'publish'>
  readonly clock: Clock
}

export type SetPhotoTakedown = (input: SetPhotoTakedownInput) => Promise<Result<void, DomainError>>

export const makeSetPhotoTakedown =
  ({ photos, audit, bus, clock }: SetPhotoTakedownDeps): SetPhotoTakedown =>
  async ({ photoId, down, reason, actor }) => {
    const why = parseAuditReason(reason)
    if (!why.ok) return why

    const located = await photos.locate(photoId)
    if (located === null) return err(DomainError.notFound('photo.notFound'))
    if ((located.takenDownAt !== null) === down) return ok(undefined)

    const at = clock.now()
    const recorded = await recordOperatorAct(audit, {
      at,
      actor,
      action: down ? 'photo.takenDown' : 'photo.restored',
      subject: { type: 'photo', id: photoId },
      reason: why.value,
    })
    if (!recorded.ok) return recorded

    await photos.setTakenDown(located.eventId, photoId, down ? at : null)
    bus.publish({
      type: down ? 'photo.takenDown' : 'photo.restored',
      eventId: located.eventId,
      photoId,
    })
    return ok(undefined)
  }
