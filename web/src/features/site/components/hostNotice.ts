import type { HostNoticeArgs } from '../../../lib/api/client/site'

/** The longest reason for the host (spec 32, A4): the server judges it, this only stops typing there. */
export const HOST_REASON_MAX = 500

/** What the operator chose about telling the host: ticked until they untick it, and a reason of their own. */
export interface HostNoticeValue {
  readonly notify: boolean
  readonly reason: string
}

export const DEFAULT_HOST_NOTICE: HostNoticeValue = { notify: true, reason: '' }

export const hostNoticeArgs = (value: HostNoticeValue): HostNoticeArgs => {
  if (!value.notify) return { notifyHost: false }
  const reason = value.reason.trim()
  return reason === '' ? {} : { hostReason: reason }
}
