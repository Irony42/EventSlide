import { parseAuditReason } from '../../../domain/audit/auditReason'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { InvalidateReel } from '../highlights/invalidateReel'
import { recordOperatorAct, type OperatorActInput } from './operatorAct'

/**
 * Takes one photograph down, or puts it back, **by its id alone** (`POST /api/site/photos/:photoId/take-down`
 * and `/restore`; launch review S5, G8-03; the rules every operator act shares are in `operatorAct.ts`).
 *
 * It is gone from the wall, the guest feed, a gallery link, the host's grid and the media route at
 * once, because the photo repository's reads leave a taken-down row out. **Every screen is told**
 * (a neutral `photo.deleted` or `photo.uploaded` signal, which never says why) so a projector drops it on its next read
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
  /**
   * Retires the highlight reel that holds a photograph being taken down (spec 08). No audit entry
   * and no new signal: the montage simply stops being servable, and the host is told no reason.
   */
  readonly invalidateReel?: InvalidateReel
}

export type SetPhotoTakedown = (input: SetPhotoTakedownInput) => Promise<Result<void, DomainError>>

export const makeSetPhotoTakedown =
  ({ photos, audit, bus, clock, invalidateReel }: SetPhotoTakedownDeps): SetPhotoTakedown =>
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

    if (down) await invalidateReel?.(located.eventId, [photoId])
    await photos.setTakenDown(located.eventId, photoId, down ? at : null)
    // A neutral signal that already means "read again": the stream forwards a signal's type to the
    // host and to every guest, and none of them is told that the operator acted (runbook csam.md).
    bus.publish({
      type: down ? 'photo.deleted' : 'photo.uploaded',
      eventId: located.eventId,
      photoId,
    })
    return ok(undefined)
  }
