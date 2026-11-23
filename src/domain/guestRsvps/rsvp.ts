import { DomainError } from '../shared/errors'
import type { EventId, GuestRsvpId } from '../shared/ids'
import { isPlainObject } from '../shared/plainObject'
import { characterCount, toParagraphs, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import type { RsvpForm } from './rsvpForm'

/**
 * One guest's reply to an invitation (spec 30, section 4.2), validated **against the form of the
 * moment**: what the host asks today decides what a reply may say.
 */

export const NAME_MAX_CHARS = 60
export const DIET_MAX_CHARS = 120
export const MESSAGE_MAX_CHARS = 280
export const MESSAGE_MAX_LINES = 4
const DETAIL_TEXT_MAX_CHARS = 120
const DETAIL_LIST_MAX = 12
/** The answers a reply keeps: the three asked, and the orphans of removed questions in what is left. */
export const ANSWERS_MAX = DETAIL_LIST_MAX
export const COMPANION_MAX_CHARS = 40
export const ANSWER_MAX_CHARS = 120
const ANSWER_ID_MAX_CHARS = 40

export type RsvpAnswer = 'yes' | 'maybe' | 'no' | 'waitlist'
/** `open`: the common link; `household`: a household's own link (lot 3); `host`: typed by the host. */
export type RsvpSource = 'open' | 'household' | 'host'

export const RSVP_ANSWERS: readonly RsvpAnswer[] = ['yes', 'maybe', 'no', 'waitlist']

/**
 * What lots 2 and 4 add to a reply. Stored whole from the start (one JSON column), written empty
 * until a lot teaches the form to ask for it.
 */
export interface RsvpDetails {
  readonly companions: readonly string[]
  /** The chosen menus, each with the label it had when chosen. */
  readonly meals: readonly string[]
  readonly answers: readonly {
    readonly questionId: string
    readonly label: string
    readonly value: string
  }[]
  readonly moments: readonly string[]
  /** The guest agreed to show their first name to the other guests. */
  readonly showName: boolean
}

export const EMPTY_RSVP_DETAILS: RsvpDetails = {
  companions: [],
  meals: [],
  answers: [],
  moments: [],
  showName: false,
}

/** One line of at most `max` code points: cut between characters, never inside a pair. */
const clip = (text: string, max: number): string => [...toSingleLine(text)].slice(0, max).join('')

const texts = (raw: unknown): readonly string[] =>
  Array.isArray(raw)
    ? raw
        .filter((item): item is string => typeof item === 'string')
        .slice(0, DETAIL_LIST_MAX)
        .map((item) => clip(item, DETAIL_TEXT_MAX_CHARS))
    : []

/** Details read back from a row, **never failing**: a malformed piece becomes empty. */
export const restoreRsvpDetails = (raw: unknown): RsvpDetails => {
  if (!isPlainObject(raw)) return EMPTY_RSVP_DETAILS
  const answers = Array.isArray(raw['answers']) ? raw['answers'] : []
  return {
    companions: texts(raw['companions']),
    meals: texts(raw['meals']),
    answers: answers.slice(0, DETAIL_LIST_MAX).flatMap((item: unknown) => {
      if (!isPlainObject(item)) return []
      const { questionId, label, value } = item
      if (
        typeof questionId !== 'string' ||
        typeof label !== 'string' ||
        typeof value !== 'string'
      ) {
        return []
      }
      return [
        {
          questionId: clip(questionId, ANSWER_ID_MAX_CHARS),
          label: clip(label, DETAIL_TEXT_MAX_CHARS),
          value: clip(value, DETAIL_TEXT_MAX_CHARS),
        },
      ]
    }),
    moments: texts(raw['moments']),
    showName: raw['showName'] === true,
  }
}

/** What a guest (or the host) sent, before it is judged. */
export interface RawRsvpInput {
  readonly name?: unknown
  readonly answer?: unknown
  readonly adults?: unknown
  readonly kids?: unknown
  readonly diet?: unknown
  readonly message?: unknown
  /** First names of the people who come along (lot 2). */
  readonly companions?: unknown
  /** One menu label per person (lot 2), `yes` only. */
  readonly meals?: unknown
  /** `{ questionId, value }[]`, one per question the host asks (lot 2). */
  readonly answers?: unknown
  /** "Show my first name to the other guests" (spec 30, section 4.4), a `yes` only. */
  readonly showName?: unknown
  /** Ids of the moments the guest comes to (lot 4), `yes` and `maybe`. */
  readonly moments?: unknown
}

/** What the form's lot 2 and 4 questions add to a reply. */
export type RsvpExtras = Pick<
  RsvpDetails,
  'companions' | 'meals' | 'answers' | 'showName' | 'moments'
>

export const NO_RSVP_EXTRAS: RsvpExtras = {
  companions: [],
  meals: [],
  answers: [],
  showName: false,
  moments: [],
}

/** A reply that passed {@link parseRsvpInput}. */
export interface RsvpInput {
  readonly name: string
  readonly answer: Exclude<RsvpAnswer, 'waitlist'>
  readonly adults: number
  readonly kids: number
  readonly diet: string | null
  readonly message: string | null
  readonly extras: RsvpExtras
}

const count = (raw: unknown, fallback: number): Result<number, DomainError> => {
  if (raw === undefined) return ok(fallback)
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
    ? ok(raw)
    : err(DomainError.invalid('rsvp.countInvalid'))
}

/** Control and invisible characters are stripped (as the welcome message does), not refused. */
const parseName = (raw: unknown): Result<string, DomainError> => {
  if (typeof raw !== 'string') return err(DomainError.invalid('rsvp.nameInvalid'))
  const cleaned = toSingleLine(raw)
  if (cleaned.length === 0) return err(DomainError.invalid('rsvp.nameEmpty'))
  if (characterCount(cleaned) > NAME_MAX_CHARS) {
    return err(DomainError.invalid('rsvp.nameTooLong', { max: NAME_MAX_CHARS }))
  }
  return ok(cleaned)
}

const parseDiet = (raw: unknown): Result<string | null, DomainError> => {
  if (raw === undefined || raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid('rsvp.dietInvalid'))
  const cleaned = toSingleLine(raw)
  if (cleaned.length === 0) return ok(null)
  if (characterCount(cleaned) > DIET_MAX_CHARS) {
    return err(DomainError.invalid('rsvp.dietTooLong', { max: DIET_MAX_CHARS }))
  }
  return ok(cleaned)
}

const parseMessage = (raw: unknown): Result<string | null, DomainError> => {
  if (raw === undefined || raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid('rsvp.messageInvalid'))
  const cleaned = toParagraphs(raw)
  if (cleaned.length === 0) return ok(null)
  if (cleaned.split('\n').length > MESSAGE_MAX_LINES) {
    return err(DomainError.invalid('rsvp.messageTooManyLines', { maxLines: MESSAGE_MAX_LINES }))
  }
  if (characterCount(cleaned) > MESSAGE_MAX_CHARS) {
    return err(DomainError.invalid('rsvp.messageTooLong', { max: MESSAGE_MAX_CHARS }))
  }
  return ok(cleaned)
}

const tooMany = (code: string, max: number): DomainError => DomainError.invalid(code, { max })

/** `list` without its trailing empty entries: a blank field at the end says nothing. */
const withoutTrailingBlanks = (list: readonly string[]): readonly string[] => {
  let end = list.length
  while (end > 0 && list[end - 1] === '') end -= 1
  return list.slice(0, end)
}

/**
 * The companions' first names **by position** (the second person is `[0]`): a blank field in the
 * middle stays a blank entry, so a name keeps the person it was typed for, and the menus beside it
 * keep theirs. Trailing blanks are dropped; at most `people - 1` remain, 40 characters each.
 */
const parseCompanions = (raw: unknown, people: number): Result<readonly string[], DomainError> => {
  if (raw === undefined || raw === null) return ok([])
  if (!Array.isArray(raw)) return err(DomainError.invalid('rsvp.companionsInvalid'))
  const names: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return err(DomainError.invalid('rsvp.companionsInvalid'))
    const cleaned = toSingleLine(item)
    if (characterCount(cleaned) > COMPANION_MAX_CHARS) {
      return err(tooMany('rsvp.companionTooLong', COMPANION_MAX_CHARS))
    }
    names.push(cleaned)
  }
  const kept = withoutTrailingBlanks(names)
  if (kept.length > people - 1) return err(tooMany('rsvp.companionsTooMany', people - 1))
  return ok(kept)
}

/**
 * One menu per person at most, **by position** (the guest is `[0]`), each one of the menus the form
 * offers today or blank for a person who has not chosen. A menu that is not offered any more is a
 * `rsvp.mealNotOffered`: the guest's page was written before the host changed them.
 */
const parseMeals = (
  raw: unknown,
  options: readonly string[],
  people: number,
): Result<readonly string[], DomainError> => {
  if (raw === undefined || raw === null) return ok([])
  if (!Array.isArray(raw)) return err(DomainError.invalid('rsvp.mealsInvalid'))
  const meals: string[] = []
  for (const item of raw) {
    const cleaned = typeof item === 'string' ? toSingleLine(item) : null
    if (cleaned === null || (cleaned !== '' && !options.includes(cleaned))) {
      return err(DomainError.invalid('rsvp.mealNotOffered'))
    }
    meals.push(cleaned)
  }
  const kept = withoutTrailingBlanks(meals)
  if (kept.length > people) return err(tooMany('rsvp.mealsTooMany', people))
  return ok(kept)
}

/**
 * The answers to the host's questions: at most one per question the form asks, each with the
 * question's label of today (an answer keeps it when the host rewrites it). A choice is one of the
 * options; empty is allowed (a question is never required). The result holds **one entry per
 * question**, in the form's order.
 */
const parseAnswers = (
  raw: unknown,
  questions: RsvpForm['questions'],
): Result<RsvpExtras['answers'], DomainError> => {
  if (questions.length === 0) return ok([])
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    return err(DomainError.invalid('rsvp.answersInvalid'))
  }
  const given = new Map<string, string>()
  for (const item of (raw ?? []) as unknown[]) {
    if (!isPlainObject(item) || typeof item['questionId'] !== 'string') {
      return err(DomainError.invalid('rsvp.answersInvalid'))
    }
    const { questionId, value } = item
    if (given.has(questionId)) return err(DomainError.invalid('rsvp.answersInvalid'))
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return err(DomainError.invalid('rsvp.answersInvalid'))
    }
    // An answer to a question the form does not ask (a page written before the host removed it) is
    // ignored, not refused: the guest did nothing wrong.
    given.set(questionId, toSingleLine(value ?? ''))
  }
  const answers: RsvpExtras['answers'][number][] = []
  for (const question of questions) {
    const value = given.get(question.id) ?? ''
    if (characterCount(value) > ANSWER_MAX_CHARS) {
      return err(tooMany('rsvp.answerTooLong', ANSWER_MAX_CHARS))
    }
    if (question.kind === 'choice' && value.length > 0 && !question.options?.includes(value)) {
      return err(DomainError.invalid('rsvp.answerNotAnOption'))
    }
    answers.push({ questionId: question.id, label: question.label, value })
  }
  return ok(answers)
}

/**
 * The moments the guest comes to, as ids **in the form's order**. Judged only when the form has
 * moments (a form without any ignores the field, whatever it holds). An id the form does not have
 * (a page written before the host removed it, or a household not invited to it) is ignored, not
 * refused: the guest did nothing wrong. But a reply that brings people must come to at least one
 * moment that is asked: `rsvp.momentsRequired`, so the host never counts a "yes" for nothing.
 */
const parseMoments = (
  raw: unknown,
  moments: RsvpForm['moments'],
): Result<readonly string[], DomainError> => {
  if (moments.length === 0) return ok([])
  if (
    raw !== undefined &&
    raw !== null &&
    (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string'))
  ) {
    return err(DomainError.invalid('rsvp.momentsInvalid'))
  }
  const chosen = new Set((raw ?? []) as string[])
  const kept = moments.filter((moment) => chosen.has(moment.id)).map((moment) => moment.id)
  return kept.length === 0 ? err(DomainError.invalid('rsvp.momentsRequired')) : ok(kept)
}

/**
 * Judges a reply against the host's form:
 *
 * - `maybe` is refused when the form does not offer it, and `waitlist` is never a guest's to
 *   choose (the server sets it, lot 4);
 * - `no` brings nobody (0 and 0), and keeps no diet;
 * - `yes` and `maybe` bring at least one adult and at most `partySize.max` people in all; a form
 *   that does not ask how many means exactly one adult, and one that does not separate children
 *   counts none;
 * - the companions' names, one menu per person (`yes` only) and the answers to the host's questions
 *   are judged only when the form asks for them, and a field it does not ask for is not judged.
 */
export const parseRsvpInput = (
  form: RsvpForm,
  raw: RawRsvpInput,
): Result<RsvpInput, DomainError> => {
  const name = parseName(raw.name)
  if (!name.ok) return name
  const message = parseMessage(raw.message)
  if (!message.ok) return message

  const answer = raw.answer
  if (answer !== 'yes' && answer !== 'maybe' && answer !== 'no') {
    return err(DomainError.invalid('rsvp.answerInvalid'))
  }
  if (answer === 'maybe' && !form.maybe) return err(DomainError.invalid('rsvp.maybeNotOffered'))

  if (answer === 'no') {
    return ok({
      name: name.value,
      answer,
      adults: 0,
      kids: 0,
      diet: null,
      message: message.value,
      extras: NO_RSVP_EXTRAS,
    })
  }

  const diet = form.diet ? parseDiet(raw.diet) : ok(null)
  if (!diet.ok) return diet

  let adults = 1
  let kids = 0
  // A field the form does not ask for is ignored, not judged: it may hold anything.
  if (form.partySize.enabled) {
    const askedAdults = count(raw.adults, 0)
    if (!askedAdults.ok) return askedAdults
    adults = askedAdults.value
    if (form.kidsSeparate) {
      const askedKids = count(raw.kids, 0)
      if (!askedKids.ok) return askedKids
      kids = askedKids.value
    }
    if (adults < 1) return err(DomainError.invalid('rsvp.adultsRequired'))
    if (adults + kids > form.partySize.max) {
      return err(DomainError.invalid('rsvp.partyTooBig', { max: form.partySize.max }))
    }
  }
  const people = adults + kids
  const companions = form.companionNames ? parseCompanions(raw.companions, people) : ok([])
  if (!companions.ok) return companions
  const meals =
    answer === 'yes' && form.meals.enabled
      ? parseMeals(raw.meals, form.meals.options, people)
      : ok([])
  if (!meals.ok) return meals
  const answers = parseAnswers(raw.answers, form.questions)
  if (!answers.ok) return answers
  const moments = parseMoments(raw.moments, form.moments)
  if (!moments.ok) return moments
  // Asked only when the host shows first names, and only a yes is ever named.
  if (
    answer === 'yes' &&
    form.visibility === 'names' &&
    raw.showName !== undefined &&
    raw.showName !== null &&
    typeof raw.showName !== 'boolean'
  ) {
    return err(DomainError.invalid('rsvp.showNameInvalid'))
  }
  const showName = answer === 'yes' && form.visibility === 'names' && raw.showName === true
  return ok({
    name: name.value,
    answer,
    adults,
    kids,
    diet: diet.value,
    message: message.value,
    extras: {
      companions: companions.value,
      meals: meals.value,
      answers: answers.value,
      showName,
      moments: moments.value,
    },
  })
}

export interface GuestRsvpProps {
  readonly id: GuestRsvpId
  readonly eventId: EventId
  /** Lot 3: the household this reply answers for. */
  readonly householdId: string | null
  /** SHA-256 of the guest's token; a reply typed by the host has none. The token is never stored. */
  readonly editTokenHash: string | null
  readonly name: string
  readonly answer: RsvpAnswer
  readonly adults: number
  readonly kids: number
  readonly details: RsvpDetails
  readonly diet: string | null
  readonly message: string | null
  readonly source: RsvpSource
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** A reply as it is stored: the answer may be `waitlist`, which no guest's input asks for. */
export type RsvpReply = Omit<RsvpInput, 'answer'> & { readonly answer: RsvpAnswer }

/** The columns of a reply, without the extras that live in its details. */
const replyContent = ({ extras: _extras, ...content }: RsvpReply): Omit<RsvpReply, 'extras'> =>
  content

export class GuestRsvp {
  private constructor(private readonly props: GuestRsvpProps) {}

  static create(input: {
    readonly id: GuestRsvpId
    readonly eventId: EventId
    readonly householdId: string | null
    readonly editTokenHash: string | null
    readonly reply: RsvpReply
    readonly source: RsvpSource
    readonly now: Date
  }): GuestRsvp {
    return new GuestRsvp({
      id: input.id,
      eventId: input.eventId,
      householdId: input.householdId,
      editTokenHash: input.editTokenHash,
      ...replyContent(input.reply),
      details: { ...EMPTY_RSVP_DETAILS, ...input.reply.extras },
      source: input.source,
      createdAt: input.now,
      updatedAt: input.now,
    })
  }

  /** Rebuilds one a store holds, without re-judging it. */
  static restore(props: GuestRsvpProps): GuestRsvp {
    return new GuestRsvp(props)
  }

  get id(): GuestRsvpId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get householdId(): string | null {
    return this.props.householdId
  }
  get editTokenHash(): string | null {
    return this.props.editTokenHash
  }
  get name(): string {
    return this.props.name
  }
  get answer(): RsvpAnswer {
    return this.props.answer
  }
  get adults(): number {
    return this.props.adults
  }
  get kids(): number {
    return this.props.kids
  }
  get details(): RsvpDetails {
    return this.props.details
  }
  get diet(): string | null {
    return this.props.diet
  }
  get message(): string | null {
    return this.props.message
  }
  get source(): RsvpSource {
    return this.props.source
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  /** People this reply stands for (a `no` is none by construction). */
  get people(): number {
    return this.props.adults + this.props.kids
  }

  toProps(): GuestRsvpProps {
    return this.props
  }

  /**
   * This reply with the content and update instant of `other`: what an admission stores for a
   * change. Id, token digest, source, household and creation instant stay as they are.
   */
  withContentOf(other: GuestRsvp): GuestRsvp {
    const { name, answer, adults, kids, details, diet, message, updatedAt } = other.props
    return new GuestRsvp({
      ...this.props,
      name,
      answer,
      adults,
      kids,
      details,
      diet,
      message,
      updatedAt,
    })
  }

  /** This reply with another answer and the rest as it is: a `yes` the places could not hold becomes a waiting-list entry. */
  withAnswer(answer: RsvpAnswer): GuestRsvp {
    return new GuestRsvp({ ...this.props, answer })
  }

  /** This reply with its first name no longer shown to the other guests: the tick is withdrawn. */
  withShownNameCleared(): GuestRsvp {
    return new GuestRsvp({ ...this.props, details: { ...this.props.details, showName: false } })
  }

  /** This reply attached to a household, or detached with `null` (lot 3). */
  withHousehold(householdId: string | null): GuestRsvp {
    return new GuestRsvp({ ...this.props, householdId })
  }

  /**
   * The same reply with its content replaced. Id, token, source, household and creation stay. A
   * host may keep a reply on the waiting list, which no guest's input can ask for.
   */
  withReply(reply: RsvpReply, now: Date): GuestRsvp {
    return new GuestRsvp({
      ...this.props,
      ...replyContent(reply),
      details: { ...this.props.details, ...reply.extras },
      updatedAt: now,
    })
  }
}

/**
 * The extras of a changed reply, **keeping what the form no longer asks** (spec 30, section 4.1:
 * removing a question or a menu never erases an answer already given). A switched-off companions'
 * field or menu keeps what was given; an answer to a question the host removed stays, with the
 * label it was given under, after the answers to the questions asked today, **whatever the new
 * answer is**: a `no` brings nobody, so its companions and menus are dropped by design, but the
 * answers to removed questions stay (yes, no, yes loses none). At most {@link ANSWERS_MAX} entries
 * are kept: when there are too many, **the oldest orphans go first** (they are stored oldest first).
 */
export const retainExtras = (
  form: RsvpForm,
  held: RsvpDetails,
  extras: RsvpExtras,
  answer: RsvpAnswer,
): RsvpExtras => {
  const orphans = held.answers.filter(
    (kept) =>
      kept.value !== '' && !form.questions.some((question) => question.id === kept.questionId),
  )
  const room = Math.max(ANSWERS_MAX - extras.answers.length, 0)
  const kept = room === 0 ? [] : orphans.slice(-room)
  if (answer === 'no') {
    return { companions: [], meals: [], answers: kept, showName: false, moments: [] }
  }
  return {
    companions: form.companionNames ? extras.companions : held.companions,
    meals: form.meals.enabled ? extras.meals : held.meals,
    // The tick means something only while first names are shown, and the guest can only withdraw it
    // while they are: so outside `names` nothing is stored, and the host's switch away from `names`
    // clears every tick (guests tick again when it comes back).
    showName: form.visibility === 'names' ? extras.showName : false,
    answers: [...extras.answers, ...kept],
    // **Dropped, not kept**: a moment id carries no label of its own and a removed moment never comes
    // back (a new one gets a new id), so what the form no longer asks is dead data. `extras.moments`
    // is already judged against the moments asked today.
    moments: extras.moments,
  }
}
