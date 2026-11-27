import type { EmailAddress } from '../users/emailAddress'

/** What stands in for the hidden part of the local part. */
const MASK = '•••'

/**
 * An address as the confirmation page shows it (`l•••@gmail.com`): enough for the person to
 * recognise their own mailbox, too little for anybody else to learn a mailbox from it. The first
 * character of the local part and the whole domain stay; the rest of the local part is always three
 * dots, whatever its length, so the length is not shown either.
 */
export const maskEmailAddress = (address: EmailAddress): string => {
  const at = address.value.lastIndexOf('@')
  const first = [...address.value.slice(0, at)][0] ?? ''
  return `${first}${MASK}${address.value.slice(at)}`
}
