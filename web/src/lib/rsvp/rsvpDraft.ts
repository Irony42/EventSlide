import type { GuestOwnRsvpDto, GuestRsvpPageDto } from '../api/dto'
import type { GuestRsvpInput } from '../api/client/invite'

/**
 * The guest's form as data (spec 30), with no React in it: what it starts from, how it is bounded
 * by the host's form, and what it sends. **The server judges every value**; this only keeps the
 * form from offering what the host did not ask for and from sending what it would refuse for
 * being the wrong shape, so a guest is not told "no" for a stepper that went too far.
 */

export type RsvpAnswer = 'yes' | 'maybe' | 'no'

export interface RsvpDraft {
  readonly answer: RsvpAnswer | null
  readonly name: string
  readonly adults: number
  readonly kids: number
  readonly diet: string
  readonly message: string
}

export const EMPTY_DRAFT: RsvpDraft = {
  answer: null,
  name: '',
  adults: 1,
  kids: 0,
  diet: '',
  message: '',
}

/** The form of a guest who is changing their reply: what they sent, in the shape they typed it. */
export const draftOf = (reply: GuestOwnRsvpDto): RsvpDraft => ({
  answer: reply.answer === 'waitlist' ? 'yes' : reply.answer,
  name: reply.name,
  adults: Math.max(reply.adults, 1),
  kids: reply.kids,
  diet: reply.diet ?? '',
  message: reply.message ?? '',
})

/** How many people the form lets one reply bring: the host's limit, or exactly one adult. */
export const maxPeople = (form: GuestRsvpPageDto['form']): number =>
  form.partySize.enabled ? form.partySize.max : 1

/** A stepper's move, kept inside what the host's form allows: at least one adult, and `max` in all. */
export const bump = (
  draft: RsvpDraft,
  form: GuestRsvpPageDto['form'],
  who: 'adults' | 'kids',
  by: 1 | -1,
): RsvpDraft => {
  const next = draft[who] + by
  if (who === 'adults' && next < 1) return draft
  if (who === 'kids' && next < 0) return draft
  const adults = who === 'adults' ? next : draft.adults
  const kids = who === 'kids' ? next : draft.kids
  if (by === 1 && adults + kids > maxPeople(form)) return draft
  return { ...draft, [who]: next }
}

/**
 * What the form sends. A field the host's form does not ask is **not sent** (the server would
 * ignore it, and what is not sent cannot leak); `no` brings nobody and keeps no diet; a blank
 * optional field is `null`, not an empty string.
 */
export const inputOf = (
  draft: RsvpDraft,
  form: GuestRsvpPageDto['form'],
): GuestRsvpInput | null => {
  if (draft.answer === null) return null
  const message = draft.message.trim() === '' ? null : draft.message
  if (draft.answer === 'no') return { name: draft.name, answer: 'no', message }
  const diet = draft.diet.trim() === '' ? null : draft.diet
  return {
    name: draft.name,
    answer: draft.answer,
    ...(form.partySize.enabled
      ? { adults: draft.adults, ...(form.kidsSeparate ? { kids: draft.kids } : {}) }
      : {}),
    ...(form.diet ? { diet } : {}),
    message,
  }
}

/** What a page says when nobody is asked to answer: the host's own preview, and a party with no form. */
export const NO_RSVP_PAGE: GuestRsvpPageDto = {
  state: 'off',
  deadline: null,
  form: { maybe: true, partySize: { enabled: true, max: 4 }, kidsSeparate: true, diet: true },
}
