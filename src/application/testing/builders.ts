import { ClipJob } from '../../domain/clips/clipJob'
import { ClipDuration } from '../../domain/clips/clipDuration'
import type { ClipJobStatus } from '../../domain/clips/clipJobStatus'
import { Event } from '../../domain/events/event'
import { EventName } from '../../domain/events/eventName'
import { EventSettings, type EventSettingsPatch } from '../../domain/events/eventSettings'
import { retentionApplies, type EventStatus } from '../../domain/events/eventStatus'
import { ShareLink } from '../../domain/gallery/shareLink'
import { ShareLinkLifetime } from '../../domain/gallery/shareLinkLifetime'
import { DisplayName } from '../../domain/guests/displayName'
import { Mission } from '../../domain/missions/mission'
import { MissionPrompt } from '../../domain/missions/missionPrompt'
import { DEFAULT_MISSION_SCOPE, type MissionScope } from '../../domain/missions/missionScope'
import { Guest } from '../../domain/guests/guest'
import { Caption } from '../../domain/photos/caption'
import { ContentHash } from '../../domain/photos/contentHash'
import { Dimensions } from '../../domain/photos/dimensions'
import {
  Photo,
  type PhotoAuthor,
  type PhotoFacet,
  type PhotoReview,
} from '../../domain/photos/photo'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import { Reaction } from '../../domain/reactions/reaction'
import type { DomainError } from '../../domain/shared/errors'
import {
  asClipJobId,
  asEventId,
  asGuestId,
  asMissionId,
  asPhotoId,
  asReactionId,
  asShareLinkId,
  asUserId,
  type MissionId,
} from '../../domain/shared/ids'
import { JoinCode } from '../../domain/shared/joinCode'
import type { Result } from '../../domain/shared/result'
import { Slug } from '../../domain/shared/slug'
import { EmailAddress } from '../../domain/users/emailAddress'
import { DEFAULT_SITE_ROLE, type SiteRole } from '../../domain/users/siteRole'
import { User } from '../../domain/users/user'

/**
 * Fixture builders: one factory per aggregate, sensible defaults, partial overrides.
 *
 * A test states only what it is about — `aPhoto({ status: 'published' })` says the rule
 * under test concerns a published photo and nothing else. Every field having a default
 * is what makes a new required field on an entity cost one edit here instead of ninety
 * across the suite.
 *
 * Two deliberate choices:
 *
 * 1. **They throw.** Every domain factory returns a `Result`, but a builder is test
 *    infrastructure: an invalid fixture is a broken test, not a modelled outcome, and
 *    handing back a `Result` would make every test narrow something that cannot fail.
 * 2. **They go through the real `create` and `restore` paths.** A builder that
 *    assembled props by hand could produce a state the domain itself refuses, and every
 *    test built on it would be proving something about a state production never reaches.
 *
 * Inputs are primitive-friendly (plain strings for ids and value objects, numbers for
 * sizes) so a fixture reads as data rather than as three lines of value-object
 * construction.
 */

/** The single instant every fixture derives from: a Saturday evening reception. */
export const AT = new Date('2026-06-20T21:00:00.000Z')

/** An instant relative to {@link AT}. Ordering tests need distinct, stable timestamps. */
export const atPlus = (ms: number): Date => new Date(AT.getTime() + ms)

const pick = <T>(override: T | undefined, fallback: T): T =>
  override === undefined ? fallback : override

/**
 * Unwrap or fail loudly. The message names the builder and the domain code, so a bad
 * fixture points at the test that wrote it rather than surfacing later as an
 * unexplained `undefined`.
 */
const must = <T>(result: Result<T, DomainError>, builder: string): T => {
  if (result.ok) return result.value
  throw new Error(`${builder}: invalid fixture rejected by the domain (${result.error.code})`)
}

/**
 * A deterministic 64-hex digest for a seed string.
 *
 * Photos need a content hash that differs per fixture, because `(event_id,
 * content_hash)` is unique: two photos seeded with a shared default hash would collide
 * in the repository rather than in the assertion. Derived from the photo id alone, so
 * the same id in two events yields the same bytes — which is exactly the fixture a
 * cross-event `findByContentHash` test needs.
 */
const hexDigest = (seed: string): string => {
  let state = 2166136261
  let digest = ''
  while (digest.length < ContentHash.hexLength) {
    for (let index = 0; index < seed.length; index += 1) {
      state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0
    }
    state = Math.imul(state ^ digest.length, 16777619) >>> 0
    digest += state.toString(16).padStart(8, '0')
  }
  return digest.slice(0, ContentHash.hexLength)
}

// ------------------------------------------------------------------- settings --

/** Defaults are the domain's own defaults: manual moderation, nothing auto-deleted. */
export const anEventSettings = (overrides: EventSettingsPatch = {}): EventSettings =>
  must(EventSettings.create(overrides), 'anEventSettings')

// ---------------------------------------------------------------------- event --

export interface EventInput {
  readonly id?: string
  readonly ownerId?: string
  readonly name?: string
  readonly slug?: string
  readonly joinCode?: string
  readonly status?: EventStatus
  readonly settings?: EventSettings | EventSettingsPatch
  readonly quotaBytes?: number
  readonly createdAt?: Date
  readonly startsAt?: Date | null
  readonly closedAt?: Date | null
  readonly scheduledOpenAt?: Date | null
  readonly scheduledCloseAt?: Date | null
  readonly scheduleDiscardedAt?: Date | null
}

const toSettings = (input: EventSettings | EventSettingsPatch): EventSettings =>
  input instanceof EventSettings ? input : anEventSettings(input)

/**
 * An event, `live` by default.
 *
 * `live` rather than the entity's own `draft`, because it is the only status in which
 * an event accepts uploads and serves the wall — so the majority of tests would
 * otherwise open by transitioning an event they do not care about.
 *
 * `closedAt` is derived rather than left null for a `closed` or `archived` fixture:
 * `Event.close` always stamps it, so a closed event without one is a state the entity
 * cannot produce, and it would silently disable every retention rule under test.
 */
export const anEvent = (input: EventInput = {}): Event => {
  const status = pick(input.status, 'live')
  const createdAt = pick(input.createdAt, AT)
  const created = must(
    Event.create(
      {
        ownerId: asUserId(pick(input.ownerId, 'user-1')),
        name: must(EventName.create(pick(input.name, 'Camille & Sacha')), 'anEvent.name'),
        slug: must(Slug.create(pick(input.slug, 'camille-et-sacha')), 'anEvent.slug'),
        joinCode: must(JoinCode.create(pick(input.joinCode, 'H7K2QM')), 'anEvent.joinCode'),
        settings: toSettings(pick(input.settings, {})),
        quotaBytes: pick(input.quotaBytes, 1_000_000_000),
        startsAt: pick(input.startsAt, null),
      },
      asEventId(pick(input.id, 'event-1')),
      createdAt,
    ),
    'anEvent',
  )

  return Event.restore({
    ...created.toProps(),
    status,
    closedAt: pick(input.closedAt, retentionApplies(status) ? createdAt : null),
    // Both empty by default: an event that opens or closes on its own is the exception,
    // and a fixture that armed one would move events out from under tests about
    // something else.
    scheduledOpenAt: pick(input.scheduledOpenAt, null),
    scheduledCloseAt: pick(input.scheduledCloseAt, null),
    scheduleDiscardedAt: pick(input.scheduleDiscardedAt, null),
  })
}

// ---------------------------------------------------------------------- photo --

/** Hosts upload too — the venue's own camera roll — so the author is a two-case union. */
export type AuthorInput =
  { readonly kind: 'guest'; readonly id: string } | { readonly kind: 'host'; readonly id: string }

export type ReviewInput =
  | { readonly kind: 'host'; readonly userId: string; readonly at?: Date }
  | { readonly kind: 'automatic'; readonly at?: Date }

/** Present on a `PhotoInput` means the row is a clip; absent means a photograph. */
export interface ClipFacetInput {
  readonly durationMs?: number
  readonly posterHash?: string
}

export interface PhotoInput {
  readonly id?: string
  readonly eventId?: string
  readonly author?: AuthorInput
  readonly status?: PhotoStatus
  readonly contentHash?: string
  readonly width?: number
  readonly height?: number
  readonly byteSize?: number
  readonly caption?: string | null
  readonly createdAt?: Date
  readonly review?: ReviewInput | null
  /**
   * Makes the row a clip. Absent is a photograph, which is what the overwhelming
   * majority of tests are about — so a test that mentions this is a test about clips.
   */
  readonly clip?: ClipFacetInput
  /**
   * Files the photograph under one of the host's prompts (roadmap §2.1). Absent is
   * untagged, which is what almost every photograph at an event actually is.
   */
  readonly missionId?: string | null
}

/**
 * The cap a fixture's duration is judged against.
 *
 * Deliberately not `MAX_CLIP_SECONDS` from configuration: a builder is test
 * infrastructure and must not change behaviour when a deployment lowers a setting.
 */
const FIXTURE_MAX_CLIP_MS = 15_000

const toAuthor = (input: AuthorInput): PhotoAuthor =>
  input.kind === 'guest'
    ? { kind: 'guest', guestId: asGuestId(input.id) }
    : { kind: 'host', userId: asUserId(input.id) }

const toReview = (input: ReviewInput, fallbackAt: Date): PhotoReview =>
  input.kind === 'host'
    ? { kind: 'host', userId: asUserId(input.userId), at: pick(input.at, fallbackAt) }
    : { kind: 'automatic', at: pick(input.at, fallbackAt) }

/**
 * A photo, `pending` from a guest by default — what ingest actually produces.
 *
 * The review is derived from the status for the same reason `Event`'s `closedAt` is:
 * `Photo.transitionTo` records a decision on every status change, so a `published`
 * photo carrying no review is unreachable in production. Pass `review: null`
 * explicitly to build that state anyway when the point of the test is a corrupt row.
 */
const toFacet = (id: string, clip: ClipFacetInput): PhotoFacet => ({
  kind: 'clip',
  duration: must(
    ClipDuration.create(pick(clip.durationMs, 8_000), FIXTURE_MAX_CLIP_MS),
    'aPhoto.duration',
  ),
  // Derived from the photo id, like the content hash beside it, and distinct from it:
  // the poster is a different file and the store addresses it by its own digest.
  posterHash: must(
    ContentHash.create(pick(clip.posterHash, hexDigest(`${id}/poster`))),
    'aPhoto.posterHash',
  ),
})

const toMissionId = (raw: string | null): MissionId | null =>
  raw === null ? null : asMissionId(raw)

export const aPhoto = (input: PhotoInput = {}): Photo => {
  const id = pick(input.id, 'photo-1')
  const status = pick(input.status, 'pending')
  const createdAt = pick(input.createdAt, AT)
  const caption = pick(input.caption, null)

  const created = must(
    Photo.create(
      {
        // `exactOptionalPropertyTypes`: an absent key is "a photograph", and an explicit
        // `undefined` would be a different thing to say.
        ...(input.clip === undefined ? {} : { facet: toFacet(id, input.clip) }),
        eventId: asEventId(pick(input.eventId, 'event-1')),
        author: toAuthor(pick(input.author, { kind: 'guest', id: 'guest-1' })),
        contentHash: must(
          ContentHash.create(pick(input.contentHash, hexDigest(id))),
          'aPhoto.contentHash',
        ),
        dimensions: must(
          Dimensions.create(pick(input.width, 4032), pick(input.height, 3024)),
          'aPhoto.dimensions',
        ),
        byteSize: pick(input.byteSize, 2_400_000),
        caption: caption === null ? null : must(Caption.create(caption), 'aPhoto.caption'),
        missionId: input.missionId === undefined ? null : toMissionId(input.missionId),
      },
      asPhotoId(id),
      createdAt,
    ),
    'aPhoto',
  )

  const review = pick(input.review, status === 'pending' ? null : { kind: 'automatic' })
  return Photo.restore({
    ...created.toProps(),
    status,
    review: review === null ? null : toReview(review, createdAt),
  })
}

/**
 * A clip that has finished transcoding: a `Photo` whose facet carries a duration and a
 * poster. Everything else about it is a photo, which is the point of the facet.
 */
export const aClip = (input: PhotoInput = {}): Photo =>
  aPhoto({ ...input, clip: pick(input.clip, {}) })

// ------------------------------------------------------------------- missions --

export interface MissionInput {
  readonly id?: string
  readonly eventId?: string
  readonly prompt?: string
  readonly scope?: MissionScope
  readonly createdAt?: Date
}

/**
 * One of the host's prompts, per-guest by default — which is what all three of the
 * roadmap's own examples are, and what `DEFAULT_MISSION_SCOPE` gives a host who does
 * not choose.
 *
 * The prompt defaults to the id, so a list of fixtures is distinct under the unique
 * `(event_id, prompt)` index without every test having to invent French.
 */
export const aMission = (input: MissionInput = {}): Mission => {
  const id = pick(input.id, 'mission-1')
  return Mission.create(
    {
      eventId: asEventId(pick(input.eventId, 'event-1')),
      prompt: must(MissionPrompt.create(pick(input.prompt, id)), 'aMission.prompt'),
      scope: pick(input.scope, DEFAULT_MISSION_SCOPE),
    },
    asMissionId(id),
    pick(input.createdAt, AT),
  )
}

// ----------------------------------------------------------------- share link --

export interface ShareLinkInput {
  readonly id?: string
  readonly eventId?: string
  /** Sixty-four hex characters. Defaults to one derived from the id, so fixtures differ. */
  readonly tokenDigest?: string
  readonly passwordHash?: string | null
  readonly createdBy?: string
  readonly createdAt?: Date
  /** Whole days, as a host chooses them. */
  readonly lifetimeDays?: number
  readonly revokedAt?: Date | null
}

/** A hex digest unique to a label, so two fixtures never collide on the token index. */
const hexDigestFor = (label: string): string =>
  [...label]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64)

/**
 * A shared gallery link, open, with no password and the product's default lifetime.
 *
 * `createdBy` defaults to `user-1`, which is `aUser()`'s id: a link is only usable while
 * its creator owns the event, so a fixture world that seeds the default owner and the
 * default link agrees about who that is without every test spelling it.
 */
export const aShareLink = (input: ShareLinkInput = {}): ShareLink => {
  const id = pick(input.id, 'share-link-1')
  const created = must(
    ShareLink.create(
      {
        eventId: asEventId(pick(input.eventId, 'event-1')),
        tokenDigest: pick(input.tokenDigest, hexDigestFor(id)),
        passwordHash: pick(input.passwordHash, null),
        createdBy: asUserId(pick(input.createdBy, 'user-1')),
        lifetime: must(ShareLinkLifetime.create(input.lifetimeDays), 'aShareLink.lifetime'),
      },
      asShareLinkId(id),
      pick(input.createdAt, AT),
    ),
    'aShareLink',
  )
  const revokedAt = pick(input.revokedAt, null)
  return revokedAt === null ? created : created.revoke(revokedAt)
}

// ------------------------------------------------------------------ clip job --

export interface ClipJobInput {
  readonly id?: string
  readonly eventId?: string
  readonly photoId?: string
  readonly author?: AuthorInput
  readonly status?: ClipJobStatus
  readonly sourceHash?: string
  readonly sourceByteSize?: number
  readonly caption?: string | null
  readonly attempts?: number
  readonly createdAt?: Date
  readonly updatedAt?: Date
  readonly notBefore?: Date
  readonly failureCode?: string | null
}

/**
 * A staged clip, `queued` and claimable by default — what an upload actually produces.
 *
 * `attempts` follows the status rather than defaulting to zero everywhere: a job that is
 * `running` was claimed by somebody, and a fixture with `running` and zero attempts is a
 * state the entity cannot reach, so a recovery test built on it would be proving
 * something about a row production never writes.
 */
export const aClipJob = (input: ClipJobInput = {}): ClipJob => {
  const id = pick(input.id, 'clip-job-1')
  const status = pick(input.status, 'queued')
  const createdAt = pick(input.createdAt, AT)
  const caption = pick(input.caption, null)

  const created = must(
    ClipJob.create(
      {
        eventId: asEventId(pick(input.eventId, 'event-1')),
        author: toAuthor(pick(input.author, { kind: 'guest', id: 'guest-1' })),
        sourceHash: must(
          ContentHash.create(pick(input.sourceHash, hexDigest(`${id}/source`))),
          'aClipJob.sourceHash',
        ),
        sourceByteSize: pick(input.sourceByteSize, 8_000_000),
        caption: caption === null ? null : must(Caption.create(caption), 'aClipJob.caption'),
      },
      asClipJobId(id),
      asPhotoId(pick(input.photoId, `${id}-photo`)),
      createdAt,
    ),
    'aClipJob',
  )

  return ClipJob.restore({
    ...created.toProps(),
    status,
    // Production cannot make a reservation or a queued job that has been claimed:
    // `attempts` is incremented by `claim`, which is the move into `running`.
    attempts: pick(input.attempts, status === 'reserved' || status === 'queued' ? 0 : 1),
    updatedAt: pick(input.updatedAt, createdAt),
    notBefore: pick(input.notBefore, createdAt),
    failureCode: pick(input.failureCode, null),
  })
}

// ---------------------------------------------------------------------- guest --

export interface GuestInput {
  readonly id?: string
  readonly eventId?: string
  readonly displayName?: string | null
  readonly joinedAt?: Date
  readonly lastSeenAt?: Date
  readonly revokedAt?: Date | null
  readonly photoCount?: number
}

export const aGuest = (input: GuestInput = {}): Guest => {
  const joinedAt = pick(input.joinedAt, AT)
  const created = must(
    Guest.create(
      {
        eventId: asEventId(pick(input.eventId, 'event-1')),
        displayName: must(
          DisplayName.createOptional(pick(input.displayName, 'Léa')),
          'aGuest.displayName',
        ),
      },
      asGuestId(pick(input.id, 'guest-1')),
      joinedAt,
    ),
    'aGuest',
  )

  return Guest.restore({
    ...created.toProps(),
    lastSeenAt: pick(input.lastSeenAt, joinedAt),
    revokedAt: pick(input.revokedAt, null),
    photoCount: pick(input.photoCount, 0),
  })
}

// ----------------------------------------------------------------------- user --

export interface UserInput {
  readonly id?: string
  readonly email?: string
  readonly displayName?: string | null
  readonly passwordHash?: string
  readonly createdAt?: Date
  readonly lastLoginAt?: Date | null
  readonly mustChangePassword?: boolean
  readonly disabledAt?: Date | null
  /** Omitted means an ordinary account: authority on the box is never a default. */
  readonly siteRole?: SiteRole
}

/** The hash shape `FakePasswordHasher` produces, so a fixture and a login agree. */
const DEFAULT_PASSWORD_HASH = 'hash:un-mot-de-passe-solide'

export const aUser = (input: UserInput = {}): User => {
  const createdAt = pick(input.createdAt, AT)
  const created = must(
    User.create(
      {
        email: must(EmailAddress.create(pick(input.email, 'hote@example.test')), 'aUser.email'),
        displayName: pick(input.displayName, null),
        passwordHash: pick(input.passwordHash, DEFAULT_PASSWORD_HASH),
        mustChangePassword: pick(input.mustChangePassword, false),
        siteRole: pick(input.siteRole, DEFAULT_SITE_ROLE),
      },
      asUserId(pick(input.id, 'user-1')),
      createdAt,
    ),
    'aUser',
  )

  return User.restore({
    ...created.toProps(),
    lastLoginAt: pick(input.lastLoginAt, null),
    disabledAt: pick(input.disabledAt, null),
  })
}

// ------------------------------------------------------------------- reaction --

export interface ReactionInput {
  readonly id?: string
  readonly eventId?: string
  readonly photoId?: string
  readonly guestId?: string
  /** A raw string: the closed set is parsed by `Reaction.create`, as in production. */
  readonly kind?: string
  readonly createdAt?: Date
}

export const aReaction = (input: ReactionInput = {}): Reaction =>
  must(
    Reaction.create(
      {
        eventId: asEventId(pick(input.eventId, 'event-1')),
        photoId: asPhotoId(pick(input.photoId, 'photo-1')),
        guestId: asGuestId(pick(input.guestId, 'guest-1')),
        kind: pick(input.kind, 'love'),
      },
      asReactionId(pick(input.id, 'reaction-1')),
      pick(input.createdAt, AT),
    ),
    'aReaction',
  )
