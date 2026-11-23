import type { GuestOwnRsvpDto, GuestRsvpPageDto, RsvpDto } from '../api/dto'
import type { GuestRsvpInput } from '../api/client/invite'
import { firstNameOf } from './rsvpTexts'

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
  /** One field per companion, in order: the guest is the first person, so the second one is `[0]`. */
  readonly companions: readonly string[]
  /** One menu per person, in order; `''` while none is chosen. */
  readonly meals: readonly string[]
  /** The answer to each question of the form, by the question's id. */
  readonly answers: Readonly<Record<string, string>>
  /** "Show my first name to the other guests": the guest's own choice, off until they tick it. */
  readonly showName: boolean
  /** Ids of the moments the guest comes to, in any order (lot 4). */
  readonly moments: readonly string[]
}

export const EMPTY_DRAFT: RsvpDraft = {
  answer: null,
  name: '',
  adults: 1,
  kids: 0,
  diet: '',
  message: '',
  companions: [],
  meals: [],
  answers: {},
  showName: false,
  moments: [],
}

/**
 * A menu the form still offers, or blank: a choice the host renamed or removed since is not one the
 * screen can show, so it is not one the draft holds (screen and payload agree).
 */
const offeredMeal = (meal: string, form: GuestRsvpPageDto['form']): string =>
  form.meals.enabled && form.meals.options.includes(meal) ? meal : ''

/**
 * The moments the form still offers: an id the host removed (or a household is not invited to) is not
 * one the screen can show, so it is not one the draft holds (screen and payload agree).
 */
const offeredMoments = (ids: readonly string[], form: GuestRsvpPageDto['form']): readonly string[] =>
  form.moments.filter((moment) => ids.includes(moment.id)).map((moment) => moment.id)

/** The draft with a moment ticked or unticked. */
export const toggleMoment = (draft: RsvpDraft, id: string): RsvpDraft => ({
  ...draft,
  moments: draft.moments.includes(id)
    ? draft.moments.filter((held) => held !== id)
    : [...draft.moments, id],
})

/** An answer the form still takes: a text as it is, a choice only while it is one of the options. */
const offeredAnswer = (
  questionId: string,
  value: string,
  form: GuestRsvpPageDto['form'],
): string => {
  const question = form.questions.find((asked) => asked.id === questionId)
  if (question?.kind !== 'choice') return value
  return question.options?.includes(value) ? value : ''
}

/**
 * A party kept inside what the form allows **today**: the host may have lowered the maximum or a
 * household's places since the reply was given, and a form that opens on more people than it can
 * send would be refused. One adult at least, then the children that still fit.
 */
const clampedParty = (
  reply: GuestOwnRsvpDto,
  form: GuestRsvpPageDto['form'],
): { readonly adults: number; readonly kids: number } => {
  if (!form.partySize.enabled) return { adults: 1, kids: 0 }
  const adults = Math.min(Math.max(reply.adults, 1), form.partySize.max)
  const kids = form.kidsSeparate ? Math.min(reply.kids, form.partySize.max - adults) : 0
  return { adults, kids }
}

/** The form of a guest who is changing their reply: what they sent, in the shape they typed it. */
export const draftOf = (
  reply: GuestOwnRsvpDto,
  form: GuestRsvpPageDto['form'],
  options: { readonly clamp?: boolean } = {},
): RsvpDraft => ({
  answer: reply.answer === 'waitlist' ? 'yes' : reply.answer,
  name: reply.name,
  ...(options.clamp === true
    ? clampedParty(reply, form)
    : { adults: Math.max(reply.adults, 1), kids: reply.kids }),
  diet: reply.diet ?? '',
  message: reply.message ?? '',
  companions: reply.companions,
  meals: reply.meals.map((meal) => offeredMeal(meal, form)),
  answers: Object.fromEntries(
    reply.answers.map((a) => [a.questionId, offeredAnswer(a.questionId, a.value, form)]),
  ),
  showName: reply.showName,
  moments: offeredMoments(reply.moments, form),
})

/** The form of a host who is correcting a reply: the same shape, read from the host's DTO. */
export const draftOfHostReply = (reply: RsvpDto, form: GuestRsvpPageDto['form']): RsvpDraft =>
  draftOf(
    {
      ...reply,
      companions: reply.details.companions,
      meals: reply.details.meals,
      answers: reply.details.answers,
      showName: reply.details.showName,
      moments: reply.details.moments,
    },
    form,
  )

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
  draft: RsvpDraft & { readonly answer: RsvpAnswer },
  form: GuestRsvpPageDto['form'],
): GuestRsvpInput => {
  const message = draft.message.trim() === '' ? null : draft.message
  if (draft.answer === 'no') return { name: draft.name, answer: 'no', message }
  const diet = draft.diet.trim() === '' ? null : draft.diet
  const people = form.partySize.enabled ? draft.adults + (form.kidsSeparate ? draft.kids : 0) : 1
  return {
    name: draft.name,
    answer: draft.answer,
    ...(form.partySize.enabled
      ? { adults: draft.adults, ...(form.kidsSeparate ? { kids: draft.kids } : {}) }
      : {}),
    ...(form.diet ? { diet } : {}),
    ...(form.companionNames ? { companions: draft.companions.slice(0, people - 1) } : {}),
    ...(form.meals.enabled && draft.answer === 'yes'
      ? { meals: draft.meals.slice(0, people).map((meal) => offeredMeal(meal, form)) }
      : {}),
    ...(form.questions.length > 0
      ? {
          answers: form.questions.map((question) => ({
            questionId: question.id,
            value: offeredAnswer(question.id, draft.answers[question.id] ?? '', form),
          })),
        }
      : {}),
    ...(form.visibility === 'names' && draft.answer === 'yes' ? { showName: draft.showName } : {}),
    ...(form.moments.length > 0 ? { moments: offeredMoments(draft.moments, form) } : {}),
    message,
  }
}

/** The name of person `index` (0 is the guest) for a menu's label: first name, or "Person n". */
export const personName = (draft: RsvpDraft, index: number, fallback: string): string =>
  (index === 0 ? firstNameOf(draft.name) : draft.companions[index - 1]?.trim()) || fallback

/** How many people the draft brings now (a `no` brings nobody). */
export const peopleOfDraft = (draft: RsvpDraft, form: GuestRsvpPageDto['form']): number =>
  draft.answer === 'no'
    ? 0
    : form.partySize.enabled
      ? draft.adults + (form.kidsSeparate ? draft.kids : 0)
      : 1

/** What a page says when nobody is asked to answer: the host's own preview, and a party with no form. */
export const NO_RSVP_PAGE: GuestRsvpPageDto = {
  state: 'off',
  deadline: null,
  form: {
    maybe: true,
    partySize: { enabled: true, max: 4 },
    kidsSeparate: true,
    diet: true,
    companionNames: false,
    meals: { enabled: false, options: [] },
    questions: [],
    visibility: 'off',
    moments: [],
  },
}

/**
 * The form a **household** answers with (spec 30, lot 3): the host's own, except that the household's
 * places are the ceiling of the party and "how many" is always asked, since a household of four is
 * not one person even when the host did not ask a party size, and **its moments are the ones it is
 * invited to**. Mirrors what the server judges with.
 */
export const householdForm = (
  form: GuestRsvpPageDto['form'],
  household: {
    readonly places: number
    readonly moments: readonly { readonly id: string }[]
  },
): GuestRsvpPageDto['form'] => ({
  ...form,
  partySize: { enabled: true, max: household.places },
  // Only the moments the page's form still has: the household's own list may be a step behind.
  moments: form.moments.filter((moment) => household.moments.some((held) => held.id === moment.id)),
})
