import type { GuestInviteDto } from '../../../lib/api/dto'
import { localInputToInstant } from '../../../lib/invite/inviteTexts'
import type { InvitationForm } from './invitationFormModel'

const orNull = (text: string): string | null => (text.trim() === '' ? null : text)

/** A typed wall clock as an instant, or `undefined` when it is not one (yet): the draft then keeps what it had. */
const instantOf = (local: string, zone: string): string | null | undefined => {
  if (local === '') return null
  try {
    const read = localInputToInstant(local, zone)
    return read.ok ? read.instant : undefined
  } catch {
    // A zone this browser does not know: nothing typed can be read in it.
    return undefined
  }
}

/**
 * The invitation as the host is writing it **right now**: the saved one with the form laid over
 * it, so the previews follow every keystroke instead of waiting for the save.
 *
 * What is not a valid value yet (a half-typed hour, an hour the clocks skipped) leaves the
 * saved one in place, so a preview never blinks to nothing mid-sentence. A start that is cleared
 * is not taken either: the formats need a date, and the locked state is the saved invitation's.
 * The link, whether it is on and the language of an invitation that is not saved are the
 * server's.
 */
export const draftInvite = (saved: GuestInviteDto, form: InvitationForm): GuestInviteDto => {
  const start = instantOf(form.start, form.timeZone)
  const end = instantOf(form.end, form.timeZone)
  return {
    ...saved,
    title: orNull(form.title),
    startsAt: start === undefined || start === null ? saved.startsAt : start,
    endsAt: end === undefined ? saved.endsAt : end,
    timeZone: form.timeZone,
    venueName: orNull(form.venueName),
    address: orNull(form.address),
    message: orNull(form.message),
    language: form.language,
  }
}
