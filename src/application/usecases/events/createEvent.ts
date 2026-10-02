import { ClientCeilings } from '../../../domain/clients/clientCeilings'
import { Event } from '../../../domain/events/event'
import { EventName } from '../../../domain/events/eventName'
import { EventSettings } from '../../../domain/events/eventSettings'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import { eventTemplateSettings, type EventTemplateKey } from '../../../domain/events/eventTemplate'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import { Slug, type SlugSuffixMode } from '../../../domain/shared/slug'
import { canOperateSite } from '../../../domain/users/siteRole'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { UserRepository } from '../../ports/userRepository'

/**
 * Five, because 32^6 is at least a billion codes (more, if `JOIN_CODE_LENGTH` is
 * configured above its six-character floor): a working generator does not collide five
 * times in a row, so a sixth attempt would only be there to hide a generator stuck on
 * a constant — which must surface as a failure instead of spinning forever. The same
 * bound and the same reasoning cover the random slug suffix below: six characters from
 * a 32-letter alphabet is the same size of haystack.
 */
const MAX_JOIN_CODE_ATTEMPTS = 5

/** See {@link MAX_JOIN_CODE_ATTEMPTS}. Its own constant, so either bound can move without the other. */
const MAX_SLUG_ATTEMPTS = 5

/**
 * Who may create an event on this box (`EVENT_CREATION`, P3-05 / D-07).
 *
 * - `anyAccount`: every signed-in account, as it has always been.
 * - `clientMembers`: only an account that belongs to a client, or the box's operator.
 *   `env.ts` refuses this policy unless `SITE_ADMIN=on`, so it only ever runs on a box
 *   that can create clients.
 */
export type EventCreationPolicy = 'anyAccount' | 'clientMembers'

export interface CreateEventInput {
  readonly ownerId: UserId
  /**
   * The client the new event is for, when the caller names one. Only ever needed by an
   * account that belongs to **several** clients and so has to say which; a member of one
   * is attached to it, and the operator and a client-less account to none. Naming a client
   * the account does not belong to is `404 client.notFound`, the same answer as naming one
   * that does not exist.
   */
  readonly clientId?: ClientId
  readonly name: string
  /** Absent means "derive it from the name", which is what the host-facing form does. */
  readonly slug?: string
  readonly startsAt?: Date | null
  readonly quotaBytes?: number
  /**
   * Which of the four presets to start this event's settings from (roadmap 3.5).
   *
   * Absent means the product defaults, which is what every event created before this
   * field existed got and what a host who picks nothing still gets.
   *
   * **Read exactly once, here.** The chosen values are copied into the event's settings
   * and the key is not stored — no column, no DTO field, nothing to consult later. That
   * is the whole design: a host who picks "wedding" and then changes moderation has
   * changed their event and not departed from anything, because there is nothing left to
   * depart from. See `src/domain/events/eventTemplate.ts` for why the alternative — an
   * event that stays attached to a living template — is a worse product.
   */
  readonly template?: EventTemplateKey
  /**
   * The language the projected wall will speak (roadmap 1.5).
   *
   * Supplied by the create form as **the language its host was reading at that moment**,
   * which is the only signal anyone has about a screen nobody will be holding. Absent
   * means the domain's own default, which is what an event created through the API with
   * no opinion gets, and what every event created before this field existed has.
   *
   * Applied on top of the template, not merged into it: no preset has an opinion about
   * language, and one that grew one would be describing the room rather than the evening.
   */
  readonly wallLanguage?: EventLanguage
}

export interface CreateEventDeps {
  readonly events: EventRepository
  /** Whose clients the creator belongs to, and which of them a creation may name. */
  readonly clients: ClientRepository
  /** For the creator's site role: the operator is the one account no client is needed for. */
  readonly users: UserRepository
  /** `EVENT_CREATION`. See {@link EventCreationPolicy}. */
  readonly eventCreation: EventCreationPolicy
  readonly ids: IdGenerator
  readonly clock: Clock
  /**
   * `uploads.defaultEventQuotaBytes` from configuration. The create form asks for a
   * name and nothing else, so the quota has to come from somewhere that is not the
   * host — and an application layer that cannot read `process.env` is handed it.
   */
  readonly defaultQuotaBytes: number
  /**
   * `uploads.maxEventQuotaBytes` from configuration (roadmap §10.5 / G3-02): the
   * box-wide ceiling nobody's request may cross, `null` meaning there is none.
   *
   * Checked here and not in the request schema, for the same reason `defaultQuotaBytes`
   * is a dependency rather than a schema literal: the ceiling is a box's own
   * configuration, not a constant the wire format can know about. `null` is the value
   * every self-hosted box has always had, and it is what makes the comparison below a
   * no-op rather than a comparison against a number nobody chose.
   */
  readonly maxQuotaBytes: number | null
  /**
   * `EVENT_SLUG_SUFFIX` (P4-09 / D-14). `'none'` reproduces 2.0's only behaviour: a
   * derived slug is the bare folded name. `'random'` — what the hosted instance sets —
   * always appends a random suffix to a derived slug, never only on collision; see
   * {@link Slug.fromNameWithRandomSuffix} for why "always" is load-bearing.
   *
   * Never consulted for a slug the host typed themselves: that one is `allowCustomSlugs`
   * below, a different question with a different default.
   */
  readonly slugSuffix: SlugSuffixMode
  /**
   * `ALLOW_CUSTOM_SLUGS` (P4-09 / D-14). `true` is the core default — a self-hosted
   * host has always been able to type their own address. The hosted instance sets
   * `false`: every event there is addressed by a derived, suffixed slug, and a slug the
   * caller supplies is refused outright rather than silently ignored.
   */
  readonly allowCustomSlugs: boolean
  /**
   * `JOIN_CODE_LENGTH` (P4-09 / D-14), 6 to 10. Applies to every code this use case
   * mints; a code already on an existing event keeps whatever length it was given,
   * because `JoinCode.create` accepts the whole range on the way back in.
   */
  readonly joinCodeLength: number
}

export type CreateEvent = (input: CreateEventInput) => Promise<Result<Event, DomainError>>

/**
 * A free join code, or the reason there is none.
 *
 * The code space is shared by every event on the box, because `/join/:code` resolves
 * without knowing which event it belongs to. A collision would send a guest to the
 * wrong party — 1.0's worst defect, in a new shape — so the unique index refuses it and
 * `save` would throw rather than return a `Result`. Asking the repository first turns
 * that into an ordinary retry.
 */
const allocateJoinCode = async (
  events: EventRepository,
  ids: IdGenerator,
  length: number,
): Promise<Result<JoinCode, DomainError>> => {
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const candidate = JoinCode.fromBytes(ids.bytes(length), length)
    if (!candidate.ok) return candidate
    if (!(await events.joinCodeTaken(candidate.value))) return ok(candidate.value)
  }
  // `unexpected`, not `conflict`: nothing about the host's input collided, and there is
  // nothing for them to change and retry. It is the box that is broken.
  return err(
    DomainError.unexpected('event.joinCodeExhausted', { attempts: MAX_JOIN_CODE_ATTEMPTS }),
  )
}

/**
 * The slug this event is saved under — a host's own choice, or derived from the name,
 * with or without a random suffix — and the one place that decides between the three.
 *
 * **Collision is neutral everywhere in here.** Every branch that finds a slug already
 * taken answers the same `409 event.slugUnavailable`, with no slug in its details —
 * never the `event.slugTaken` this replaces, which echoed the slug it had just computed
 * back to whoever asked. For a custom slug that echo was the caller's own input, no
 * worse than a form reading back what was typed; for a *derived* slug it was the one
 * real leak — a caller who only ever typed a free-text name learned the literal,
 * already-normalised address of whichever other tenant's event already held it
 * (docs/SECURITY.md, R-08 / A-16 / A-42).
 */
const resolveSlug = async (
  events: EventRepository,
  ids: IdGenerator,
  name: string,
  requestedSlug: string | undefined,
  slugSuffix: SlugSuffixMode,
  allowCustomSlugs: boolean,
): Promise<Result<Slug, DomainError>> => {
  if (requestedSlug !== undefined) {
    // `ALLOW_CUSTOM_SLUGS=false`: the hosted instance addresses every event by a
    // derived, suffixed slug, and a caller handing one in is refused rather than
    // silently overridden — silently ignoring it would save a different event than
    // the one the caller believes they are about to open.
    if (!allowCustomSlugs) return err(DomainError.invalid('event.customSlugNotAllowed'))

    const custom = Slug.create(requestedSlug)
    if (!custom.ok) return custom
    if (await events.slugTaken(custom.value)) {
      return err(DomainError.conflict('event.slugUnavailable'))
    }
    return custom
  }

  if (slugSuffix === 'random') {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = Slug.fromNameWithRandomSuffix(name, ids.bytes(Slug.suffixEntropyBytes))
      if (!candidate.ok) return candidate
      if (!(await events.slugTaken(candidate.value))) return candidate
    }
    // `unexpected`, exactly as `allocateJoinCode` gives up: a random suffix colliding
    // five times running is the generator's fault, not the host's, and there is
    // nothing about their name for them to change and retry.
    return err(DomainError.unexpected('event.slugExhausted', { attempts: MAX_SLUG_ATTEMPTS }))
  }

  const derived = Slug.fromName(name)
  if (!derived.ok) return derived
  if (await events.slugTaken(derived.value)) {
    return err(DomainError.conflict('event.slugUnavailable'))
  }
  return derived
}

/** The client a new event belongs to, and the ceilings that client's creations answer to. */
interface ResolvedClient {
  readonly clientId: ClientId | null
  readonly ceilings: ClientCeilings
}

const NO_CLIENT: ResolvedClient = { clientId: null, ceilings: ClientCeilings.unlimited() }

/**
 * Which client, if any, this creation is for — and whether this account may create at all.
 *
 * **Runs first, before the name is parsed or a slug is probed.** A refusal that depends on
 * who is asking has to come before anything that depends on what they asked for: a
 * non-member told "that address is taken" has learned something about another tenant's
 * events from an account that was never allowed to create one.
 *
 * The rules, in order:
 *
 * 1. A client the caller **names** must be one of theirs. Anything else — one that does not
 *    exist, one they merely know the id of — is `404 client.notFound`: a 403 would confirm
 *    the client exists, and this surface is not a way to enumerate them. This holds for the
 *    operator too, and under either policy: naming a client is attaching to its ceilings.
 * 2. Otherwise **the operator gets no client.** They run the box; their own events are not
 *    anyone's, and are never counted against anyone's ceilings.
 * 3. Otherwise a member of **one** client is attached to it, with no need to say so.
 * 4. A member of **several** must say which (rule 1); not saying is `404 client.notFound`.
 * 5. An account that belongs to **none** gets no client under `anyAccount` — today's
 *    behaviour, exactly — and `403 event.creationNotAllowed` under `clientMembers`.
 */
const resolveClient = async (
  clients: ClientRepository,
  users: UserRepository,
  policy: EventCreationPolicy,
  ownerId: UserId,
  named: ClientId | undefined,
): Promise<Result<ResolvedClient, DomainError>> => {
  const memberships = await clients.membershipsForUser(ownerId)

  const attach = async (clientId: ClientId): Promise<Result<ResolvedClient, DomainError>> => {
    const client = await clients.findById(clientId)
    // A membership row cannot outlive its client (`ON DELETE CASCADE`), so this is a race
    // with a deletion and not a state. Not found is the honest answer, and skipping the
    // ceilings of a client that just went away would be the dishonest one.
    if (client === null) return err(DomainError.notFound('client.notFound'))
    return ok({ clientId, ceilings: client.ceilings })
  }

  if (named !== undefined) {
    const belongs = memberships.some((membership) => membership.clientId === named)
    return belongs ? attach(named) : err(DomainError.notFound('client.notFound'))
  }

  if (canOperateSite(await users.siteRoleFor(ownerId))) return ok(NO_CLIENT)

  const [only, ...others] = memberships
  if (only !== undefined) {
    return others.length === 0
      ? attach(only.clientId)
      : err(DomainError.notFound('client.notFound'))
  }

  return policy === 'clientMembers'
    ? err(DomainError.forbidden('event.creationNotAllowed'))
    : ok(NO_CLIENT)
}

export const makeCreateEvent =
  ({
    events,
    clients,
    users,
    eventCreation,
    ids,
    clock,
    defaultQuotaBytes,
    maxQuotaBytes,
    slugSuffix,
    allowCustomSlugs,
    joinCodeLength,
  }: CreateEventDeps): CreateEvent =>
  async (input) => {
    // First, for the reason written on `resolveClient`: who may ask comes before what they
    // asked for.
    const resolved = await resolveClient(
      clients,
      users,
      eventCreation,
      input.ownerId,
      input.clientId,
    )
    if (!resolved.ok) return resolved

    const name = EventName.create(input.name)
    if (!name.ok) return name

    // One slugifier for the whole product: the host-facing form previews the slug with
    // the same function, so "the slug I saw is not the slug I got" cannot happen.
    const slug = await resolveSlug(
      events,
      ids,
      name.value.value,
      input.slug,
      slugSuffix,
      allowCustomSlugs,
    )
    if (!slug.ok) return slug

    const joinCode = await allocateJoinCode(events, ids, joinCodeLength)
    if (!joinCode.ok) return joinCode

    // The template is applied here and then forgotten. `eventTemplateSettings` is
    // total — the catalogue is validated at import, so a preset can never reach a host
    // as a 400 on a form with no field to correct.
    const preset =
      input.template === undefined ? EventSettings.default() : eventTemplateSettings(input.template)

    // The creator's language on top, because no template has an opinion about it. This
    // is the one place the value is read from anybody's preference; from here on it is
    // the event's, and only the settings page moves it.
    const settings =
      input.wallLanguage === undefined
        ? ok(preset)
        : preset.with({ wallLanguage: input.wallLanguage })
    if (!settings.ok) return settings

    // The box-wide ceiling (roadmap §10.5 / G3-02). Checked only when the host asked
    // for a specific quota: an absent `quotaBytes` falls back to `defaultQuotaBytes`,
    // which `env.ts` already refuses to configure below the ceiling, so there is
    // nothing here for a default to violate. Refused outright rather than clamped to
    // the ceiling — a silent reduction would tell a host they got the quota they asked
    // for when they did not.
    if (
      input.quotaBytes !== undefined &&
      maxQuotaBytes !== null &&
      input.quotaBytes > maxQuotaBytes
    ) {
      return err(DomainError.invalid('event.quotaAboveCeiling', { maxBytes: maxQuotaBytes }))
    }

    const now = clock.now()
    const created = Event.create(
      {
        ownerId: input.ownerId,
        name: name.value,
        slug: slug.value,
        joinCode: joinCode.value,
        settings: settings.value,
        quotaBytes: input.quotaBytes ?? defaultQuotaBytes,
        startsAt: input.startsAt ?? null,
        clientId: resolved.value.clientId,
      },
      ids.eventId(),
      now,
    )
    if (!created.ok) return created

    // One step, not two. The owner role is a membership row, not the `owner_id` column
    // alone: every authorization decision in this product reads `roleFor(eventId, userId)`,
    // so a creator without this row could not open the event they just created. This used
    // to be a `save` and then a `grant`, and a failure between them left exactly that event
    // behind. The repository writes both — and the client's creation counter, and checks the
    // client's ceilings against the rows it then changes — in one transaction.
    const stored = await events.createWithOwner(
      created.value,
      { userId: input.ownerId, grantedAt: now },
      resolved.value.ceilings,
    )
    if (!stored.ok) return stored

    // Nothing is announced. The bus is subscribed per event by phones and projectors
    // that cannot yet be watching an event which did not exist a moment ago.
    return ok(created.value)
  }
