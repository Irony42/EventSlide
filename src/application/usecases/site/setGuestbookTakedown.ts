import { parseAuditReason } from '../../../domain/audit/auditReason'
import { DomainError } from '../../../domain/shared/errors'
import type { GuestbookEntryId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import { recordOperatorAct, type OperatorActInput } from './operatorAct'

/**
 * Takes one guestbook message down, or puts it back, **by its id alone**
 * (`POST /api/site/guestbook-entries/:entryId/take-down` and `/restore`; spec 01, PR 6; the rules
 * every operator act shares are in `operatorAct.ts`).
 *
 * It is gone from the wall, the host's queue, the guest's own list and the export at once, because
 * the repository's reads leave a taken-down row out. The row stays, for an authority that asks
 * for it, and **keeps counting toward its guest's ceiling** (taking a message down must not free
 * a place to write another). The use case never reads the message: `locate` answers an event id
 * and an instant, which is all it needs, so the operator never sees the text.
 *
 * An id no message holds is `404 guestbook.notFound`: a typo must not read as success. Every
 * screen is told by the neutral `guestbook.changed` signal, which never says why.
 */

export interface SetGuestbookTakedownInput extends OperatorActInput {
  readonly entryId: GuestbookEntryId
  /** `true` takes it down, `false` puts it back. */
  readonly down: boolean
}

export interface SetGuestbookTakedownDeps {
  readonly guestbook: Pick<GuestbookRepository, 'locate' | 'setTakenDown'>
  readonly audit: AuditRecorder
  readonly bus: Pick<EventBus, 'publish'>
  readonly clock: Clock
}

export type SetGuestbookTakedown = (
  input: SetGuestbookTakedownInput,
) => Promise<Result<void, DomainError>>

export const makeSetGuestbookTakedown =
  ({ guestbook, audit, bus, clock }: SetGuestbookTakedownDeps): SetGuestbookTakedown =>
  async ({ entryId, down, reason, actor }) => {
    const why = parseAuditReason(reason)
    if (!why.ok) return why

    const located = await guestbook.locate(entryId)
    if (located === null) return err(DomainError.notFound('guestbook.notFound'))
    if ((located.takenDownAt !== null) === down) return ok(undefined)

    const at = clock.now()
    const recorded = await recordOperatorAct(audit, {
      at,
      actor,
      action: down ? 'guestbook.takenDown' : 'guestbook.restored',
      subject: { type: 'guestbook', id: entryId },
      reason: why.value,
    })
    if (!recorded.ok) return recorded

    await guestbook.setTakenDown(located.eventId, entryId, down ? at : null)
    bus.publish({ type: 'guestbook.changed', eventId: located.eventId })
    return ok(undefined)
  }
