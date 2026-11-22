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

const texts = (raw: unknown): readonly string[] =>
  Array.isArray(raw)
    ? raw
        .filter((item): item is string => typeof item === 'string')
        .slice(0, DETAIL_LIST_MAX)
        .map((item) => toSingleLine(item).slice(0, DETAIL_TEXT_MAX_CHARS))
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
      return [{ questionId, label, value }]
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
}

/** A reply that passed {@link parseRsvpInput}. */
export interface RsvpInput {
  readonly name: string
  readonly answer: Exclude<RsvpAnswer, 'waitlist'>
  readonly adults: number
  readonly kids: number
  readonly diet: string | null
  readonly message: string | null
}

const count = (raw: unknown, fallback: number): Result<number, DomainError> => {
  if (raw === undefined) return ok(fallback)
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
    ? ok(raw)
    : err(DomainError.invalid('rsvp.countInvalid'))
}

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

/**
 * Judges a reply against the host's form:
 *
 * - `maybe` is refused when the form does not offer it, and `waitlist` is never a guest's to
 *   choose (the server sets it, lot 4);
 * - `no` brings nobody (0 and 0), and keeps no diet;
 * - `yes` and `maybe` bring at least one adult and at most `partySize.max` people in all; a form
 *   that does not ask how many means exactly one adult, and one that does not separate children
 *   counts none.
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
    return ok({ name: name.value, answer, adults: 0, kids: 0, diet: null, message: message.value })
  }

  const diet = form.diet ? parseDiet(raw.diet) : ok(null)
  if (!diet.ok) return diet

  let adults = 1
  let kids = 0
  if (form.partySize.enabled) {
    const askedAdults = count(raw.adults, 0)
    if (!askedAdults.ok) return askedAdults
    const askedKids = count(raw.kids, 0)
    if (!askedKids.ok) return askedKids
    adults = askedAdults.value
    kids = form.kidsSeparate ? askedKids.value : 0
    if (adults < 1) return err(DomainError.invalid('rsvp.adultsRequired'))
    if (adults + kids > form.partySize.max) {
      return err(DomainError.invalid('rsvp.partyTooBig', { max: form.partySize.max }))
    }
  }
  return ok({ name: name.value, answer, adults, kids, diet: diet.value, message: message.value })
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

export class GuestRsvp {
  private constructor(private readonly props: GuestRsvpProps) {}

  static create(input: {
    readonly id: GuestRsvpId
    readonly eventId: EventId
    readonly householdId: string | null
    readonly editTokenHash: string | null
    readonly reply: RsvpInput
    readonly source: RsvpSource
    readonly now: Date
  }): GuestRsvp {
    return new GuestRsvp({
      id: input.id,
      eventId: input.eventId,
      householdId: input.householdId,
      editTokenHash: input.editTokenHash,
      ...input.reply,
      details: EMPTY_RSVP_DETAILS,
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

  /** The same reply with its content replaced. Id, token, source, household and creation stay. */
  withReply(reply: RsvpInput, now: Date): GuestRsvp {
    return new GuestRsvp({ ...this.props, ...reply, updatedAt: now })
  }
}
