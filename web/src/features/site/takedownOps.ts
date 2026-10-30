import type { Api } from '../../lib/api/client'

/**
 * The six acts of the "remove without viewing" screen (launch review S5), and the one place that
 * says which request each one is. Not a rule: the server decides what each does, and this only
 * names the six and sends the id and the reason the operator gave.
 */
export type TakedownOp =
  'eventDown' | 'eventUp' | 'purgeHold' | 'purgeRelease' | 'photoDown' | 'photoUp'

export const runTakedownOp = (
  api: Api,
  op: TakedownOp,
  id: string,
  reason: string,
): Promise<void> => {
  switch (op) {
    case 'eventDown':
      return api.siteTakeDownEvent(id, reason)
    case 'eventUp':
      return api.siteRestoreEvent(id, reason)
    case 'purgeHold':
      return api.siteHoldEventPurge(id, reason)
    case 'purgeRelease':
      return api.siteReleaseEventPurge(id, reason)
    case 'photoDown':
      return api.siteTakeDownPhoto(id, reason)
    case 'photoUp':
      return api.siteRestorePhoto(id, reason)
  }
}
