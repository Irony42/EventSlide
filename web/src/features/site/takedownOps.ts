import type { Api } from '../../lib/api/client'
import type { HostNoticeArgs } from '../../lib/api/client/site'

/**
 * The eight acts of the "remove without viewing" screen (launch review S5), and the one place that
 * says which request each one is. Not a rule: the server decides what each does, and this only
 * names the six and sends the id and the reason the operator gave.
 */
export type TakedownOp =
  | 'eventDown'
  | 'eventUp'
  | 'purgeHold'
  | 'purgeRelease'
  | 'photoDown'
  | 'photoUp'
  | 'guestbookDown'
  | 'guestbookUp'

/** The acts that take something away from the host, and so may tell them (spec 32, A4). */
export const TELLS_THE_HOST: readonly TakedownOp[] = ['eventDown', 'photoDown', 'guestbookDown']

export const runTakedownOp = (
  api: Api,
  op: TakedownOp,
  id: string,
  reason: string,
  notice: HostNoticeArgs = {},
): Promise<void> => {
  switch (op) {
    case 'eventDown':
      return api.siteTakeDownEvent(id, reason, notice)
    case 'eventUp':
      return api.siteRestoreEvent(id, reason)
    case 'purgeHold':
      return api.siteHoldEventPurge(id, reason)
    case 'purgeRelease':
      return api.siteReleaseEventPurge(id, reason)
    case 'photoDown':
      return api.siteTakeDownPhoto(id, reason, notice)
    case 'photoUp':
      return api.siteRestorePhoto(id, reason)
    case 'guestbookDown':
      return api.siteTakeDownGuestbookEntry(id, reason, notice)
    case 'guestbookUp':
      return api.siteRestoreGuestbookEntry(id, reason)
  }
}
