import type { GuestInviteInput } from '../../../lib/api/client'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { instantToLocalInput, localInputToInstant } from '../../../lib/invite/inviteTexts'

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
  const timeZone = invite.timeZone ?? browserZone
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

export type SaveInput =
  | { readonly ok: true; readonly input: GuestInviteInput }
  | { readonly ok: false; readonly reason: 'nonexistentHour' | 'invalidTime' }

const orNull = (text: string): string | null => (text.trim() === '' ? null : text)

/** What the host typed, as a save. A field left empty is sent as `null`, which clears it. */
export const inputFromForm = (form: InvitationForm): SaveInput => {
  const instantOf = (
    local: string,
  ):
    | { readonly ok: true; readonly at: string | null }
    | { readonly ok: false; readonly reason: 'nonexistentHour' | 'invalidTime' } => {
    if (local === '') return { ok: true, at: null }
    const read = localInputToInstant(local, form.timeZone)
    if (read.ok) return { ok: true, at: read.instant }
    return { ok: false, reason: read.reason === 'nonexistent' ? 'nonexistentHour' : 'invalidTime' }
  }

  const start = instantOf(form.start)
  if (!start.ok) return start
  const end = instantOf(form.end)
  if (!end.ok) return end

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
