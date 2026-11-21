import type { GuestInviteInput } from '../../../lib/api/client'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { instantToLocalInput, localInputToInstant } from '../../../lib/invite/inviteTexts'
import { supportsTimeZone } from '../../../lib/invite/timeZones'

/**
 * The invitation's form as the host edits it, and what it becomes on the wire.
 *
 * No rule lives here: the bounds, the zone, the end after the start are the server's, answered by
 * code. What this does is the one conversion the browser cannot leave to the server, **reading
 * the typed times in the invitation's zone** (the host's laptop may be in another country than the
 * party) and saying so when the clocks skipped the hour they typed.
 */

export interface InvitationForm {
  readonly title: string
  /** `YYYY-MM-DDTHH:mm`, a wall clock **in `timeZone`**. */
  readonly start: string
  readonly end: string
  readonly timeZone: string
  readonly venueName: string
  readonly address: string
  readonly message: string
  readonly language: string
}

/**
 * The form the server's answer fills. Before anything is saved the start is the event's own date
 * when it has one, the zone is the browser's, and the language the one the host is reading in;
 * after, it is exactly what was saved (the zone is **never** re-taken from the browser, so a host
 * editing from another country does not move the hour).
 */
export const formFromInvite = (
  invite: GuestInviteDto,
  browserZone: string,
  readerLanguage: string,
): InvitationForm => {
  // A zone this browser does not know cannot be read here: the times are shown in the browser's own
  // zone instead, the instants are the same, and a save then keeps them (the hour does not move).
  const timeZone =
    invite.timeZone !== null && supportsTimeZone(invite.timeZone) ? invite.timeZone : browserZone
  const start = invite.startsAt ?? (invite.configured ? null : invite.defaultStartsAt)
  return {
    title: invite.title ?? '',
    start: start === null ? '' : instantToLocalInput(start, timeZone),
    end: invite.endsAt === null ? '' : instantToLocalInput(invite.endsAt, timeZone),
    timeZone,
    venueName: invite.venueName ?? '',
    address: invite.address ?? '',
    message: invite.message ?? '',
    language: invite.configured ? invite.language : readerLanguage,
  }
}

/** The parts of the form an error can be tied to: it is shown under its field, and the field is focused. */
export type FormField = 'title' | 'start' | 'end' | 'venueName' | 'address' | 'message'

/**
 * Which field a server code is about, `null` for one that is not about a field (the zone, the
 * language, a refusal of the whole). Written as a table, so a code the server gains is a line here
 * and not a guess.
 */
const FIELD_OF_CODE: Readonly<Record<string, FormField>> = {
  'guestInvite.titleTooLong': 'title',
  'guestInvite.titleInvalid': 'title',
  'guestInvite.venueTooLong': 'venueName',
  'guestInvite.venueInvalid': 'venueName',
  'guestInvite.addressTooLong': 'address',
  'guestInvite.addressTooManyLines': 'address',
  'guestInvite.addressInvalid': 'address',
  'guestInvite.messageTooLong': 'message',
  'guestInvite.messageTooManyLines': 'message',
  'guestInvite.messageInvalid': 'message',
  'guestInvite.startsAtInvalid': 'start',
  'guestInvite.timeZoneRequired': 'start',
  'guestInvite.endsAtInvalid': 'end',
  'guestInvite.endBeforeStart': 'end',
  'guestInvite.endNeedsStart': 'end',
  'guestInvite.tooLong': 'end',
}

export const fieldOfCode = (code: string): FormField | null => FIELD_OF_CODE[code] ?? null

/** The lines a host wrote, as the server counts them: blank lines do not count. */
export const lineCount = (text: string): number =>
  text.split(/\r\n|[\r\n\u2028\u2029]/).filter((line) => line.trim() !== '').length

const ADDRESS_MAX_LINES = 2
const MESSAGE_MAX_LINES = 8

export type SaveInput =
  | { readonly ok: true; readonly input: GuestInviteInput }
  | {
      readonly ok: false
      readonly field: FormField
      /** What is wrong, for the page to word: a time that does not exist, a time that is not one, too many lines. */
      readonly reason: 'nonexistentHour' | 'invalidTime' | 'tooManyLines'
    }

const orNull = (text: string): string | null => (text.trim() === '' ? null : text)

/** What the host typed, as a save. A field left empty is sent as `null`, which clears it. */
export const inputFromForm = (form: InvitationForm): SaveInput => {
  const instantOf = (
    local: string,
    field: 'start' | 'end',
  ):
    | { readonly ok: true; readonly at: string | null }
    | {
        readonly ok: false
        readonly field: FormField
        readonly reason: 'nonexistentHour' | 'invalidTime'
      } => {
    if (local === '') return { ok: true, at: null }
    let read: ReturnType<typeof localInputToInstant>
    try {
      read = localInputToInstant(local, form.timeZone)
    } catch (cause) {
      // A zone the browser has never heard of: nothing typed can be read in it.
      if (cause instanceof RangeError) return { ok: false, field, reason: 'invalidTime' }
      throw cause
    }
    if (read.ok) return { ok: true, at: read.instant }
    return {
      ok: false,
      field,
      reason: read.reason === 'nonexistent' ? 'nonexistentHour' : 'invalidTime',
    }
  }

  const start = instantOf(form.start, 'start')
  if (!start.ok) return start
  const end = instantOf(form.end, 'end')
  if (!end.ok) return end
  if (lineCount(form.address) > ADDRESS_MAX_LINES) {
    return { ok: false, field: 'address', reason: 'tooManyLines' }
  }
  if (lineCount(form.message) > MESSAGE_MAX_LINES) {
    return { ok: false, field: 'message', reason: 'tooManyLines' }
  }

  return {
    ok: true,
    input: {
      title: orNull(form.title),
      startsAt: start.at,
      endsAt: end.at,
      timeZone: form.timeZone,
      venueName: orNull(form.venueName),
      address: orNull(form.address),
      message: orNull(form.message),
      language: form.language,
    },
  }
}
