import { absentNoteAuthorName } from '../../../domain/guestRsvps/absentNote'
import { GuestbookText } from '../../../domain/guestbook/guestbookText'
import { acceptsGuestbookEntries } from '../../../domain/guestbook/guestbookWindow'
import { DisplayName } from '../../../domain/guests/displayName'
import { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { CreateGuestbookEntry } from '../guestbook/createGuestbookEntry'
import { findOwnReply, type OwnReplyDeps } from './ownRsvp'
import { openPublicRsvp, type PublicRsvpDeps } from './publicRsvpAccess'

/**
 * A guest who answered "no" leaves a word in the guestbook (spec 30, lot 4): **the guestbook's own
 * door, not a second one**.
 *
 * The same two keys as the reply itself (the reply's token, or a household's link) and the same
 * refusals first (`404 guestInvite.notAvailable`, `404 rsvp.notFound`). Then, in order:
 *
 * 1. the reply must be a "no", the host must allow the note (`absentNote`, on by default), and the
 *    guestbook must take entries now: switched on, and the event live or closed for less than seven
 *    days; otherwise `409 rsvp.absentNoteUnavailable`;
 * 2. the text is judged by the guestbook's own rules (`GuestbookText`), before anything is written;
 * 3. **one note per reply**: a reply that already has one is `409 rsvp.absentNoteSent`;
 * 4. a `guests` row is made for the author (`via_rsvp`: no device token, in no count of guests), named
 *    by the first word of the reply's name, the note is claimed for the reply, and the entry goes
 *    through `createGuestbookEntry`: the ceilings (3 per guest, 500 per event), the moderation of the
 *    event (held in `manual`) and the signal to the host's console are the guestbook's. If a step
 *    fails, what was made is taken back, and the guest can try again.
 *
 * Deleting the reply deletes the note (the repository's one transaction); the event's purge takes it.
 * A filled honeypot `website` gets the same answers and writes nothing.
 */

export interface PostAbsentNoteDeps extends PublicRsvpDeps, OwnReplyDeps {
  readonly rsvps: Pick<
    GuestRsvpRepository,
    'findByEditTokenHash' | 'findByHousehold' | 'claimAbsentNote' | 'releaseAbsentNote'
  >
  readonly guests: Pick<GuestRepository, 'save' | 'delete'>
  readonly createEntry: CreateGuestbookEntry
  readonly ids: Pick<IdGenerator, 'guestId'>
  readonly clock: Clock
}

export interface PostAbsentNoteInput {
  readonly token: unknown
  readonly editToken: unknown
  readonly householdToken?: unknown
  /** Untrusted: judged by the guestbook's text rules. */
  readonly text: unknown
  /**
   * Who signs it, as the guest edited it (lot 4): absent means the first word of the reply's name, empty means
   * anonymous, anything else is judged like a guest's name (40 characters at most).
   */
  readonly signature?: unknown
  /** The honeypot: a field a person leaves empty and a script fills. */
  readonly website?: unknown
}

export type PostAbsentNote = (input: PostAbsentNoteInput) => Promise<Result<void, DomainError>>

/** The author's name: the guest's own signature, or the default one. */
const signedBy = (
  signature: unknown,
  replyName: string,
  householdName: string | null,
): Result<DisplayName | null, DomainError> => {
  if (signature === undefined) return ok(absentNoteAuthorName(replyName, householdName))
  if (typeof signature !== 'string') return err(DomainError.invalid('displayName.invalid'))
  return DisplayName.createOptional(signature)
}

export const makePostAbsentNote =
  (deps: PostAbsentNoteDeps): PostAbsentNote =>
  async ({ token, editToken, householdToken, text, signature, website }) => {
    const opened = await openPublicRsvp(deps, token)
    if (!opened.ok) return opened
    const { event, settings } = opened.value
    const own = await findOwnReply(deps, event, { editToken, householdToken })
    if (!own.ok) return own
    const { rsvp } = own.value

    const now = deps.clock.now()
    if (
      rsvp.answer !== 'no' ||
      !settings.form.absentNote ||
      !event.settings.allowGuestbook ||
      !acceptsGuestbookEntries(event, now)
    ) {
      return err(DomainError.conflict('rsvp.absentNoteUnavailable'))
    }
    const judged = GuestbookText.create(text)
    if (!judged.ok) return judged
    // The signature is judged like a guest's name, before anything is made: the first word of the reply's
    // name unless the guest chose another, or none (an empty one stays anonymous).
    const author = signedBy(signature, rsvp.name, own.value.household?.name ?? null)
    if (!author.ok) return author
    if (rsvp.absentNoteGuestId !== null) return err(DomainError.conflict('rsvp.absentNoteSent'))
    // A script's note is answered as a real one is, and goes nowhere.
    if (typeof website === 'string' && website.length > 0) return ok(undefined)

    // A row made for the note: no device token, in no count of guests (`viaRsvp`).
    const guestId = deps.ids.guestId()
    /** Takes back what a failed step left: idempotent, so it is safe whatever got as far as it did. */
    const takeBack = async (): Promise<void> => {
      await deps.rsvps.releaseAbsentNote(event.id, rsvp.id, guestId)
      await deps.guests.delete(event.id, guestId)
    }
    try {
      await deps.guests.save(
        Guest.restore({
          id: guestId,
          eventId: event.id,
          displayName: author.value,
          joinedAt: now,
          lastSeenAt: now,
          revokedAt: null,
          photoCount: 0,
          noticeAcknowledgement: null,
          channelIdentity: null,
          viaRsvp: true,
        }),
      )

      // One note per reply, decided in the write: a double tap or two tabs make one author, not two.
      if (!(await deps.rsvps.claimAbsentNote(event.id, rsvp.id, guestId))) {
        await deps.guests.delete(event.id, guestId)
        return err(DomainError.conflict('rsvp.absentNoteSent'))
      }

      // **Always held for the host**, whatever the event's moderation mode: a word from outside the room.
      const written = await deps.createEntry({
        eventId: event.id,
        guestId,
        text: judged.value.value,
        held: true,
      })
      if (!written.ok) {
        // The guestbook said no (a ceiling, a window that closed meanwhile): nothing stays behind.
        await takeBack()
        return written
      }
      return ok(undefined)
    } catch (cause) {
      // A store that failed half way: the claim and the author go, the guest can try again, and the failure is told.
      await takeBack().catch(() => undefined)
      throw cause
    }
  }
