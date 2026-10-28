import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as allSchemas from './requestSchemas'
import {
  acceptInvitationBody,
  bulkModerationBody,
  captionBody,
  changePasswordBody,
  confirmSecondFactorBody,
  createEventBody,
  enrollSecondFactorBody,
  eventScheduleBody,
  eventSlugParams,
  eventStatusBody,
  galleryGrantQuery,
  joinBody,
  loginBody,
  guestListQuery,
  moderationDecisionBody,
  moderationQueueQuery,
  galleryMediaParams,
  moderatorInvitationBody,
  passwordResetRequestBody,
  photoListQuery,
  photoParams,
  photoVariantParams,
  reactionBody,
  reactionParams,
  secondFactorLoginBody,
  secondFactorProofOf,
  shareLinkBody,
  stepUpBody,
  updateSettingsBody,
  uploadFields,
  wallQuery,
} from './requestSchemas'
import { MODERATION_MODES } from '../../../domain/events/eventSettings'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { EVENT_STATUSES } from '../../../domain/events/eventStatus'
import {
  THEME_AMBIANCES,
  THEME_FONTS,
  THEME_FRAMES,
  THEME_MATERIALS,
} from '../../../domain/events/eventTheme'
import { MODERATION_DECISIONS } from '../../../domain/moderation/moderationDecision'
import { SERVED_VARIANTS } from '../../../domain/photos/mediaVariant'
import { PHOTO_STATUSES } from '../../../domain/photos/photoStatus'
import { REACTION_KINDS } from '../../../domain/reactions/reactionKind'
import { JoinCode } from '../../../domain/shared/joinCode'
import { Slug } from '../../../domain/shared/slug'

const UUID = '11111111-1111-4111-8111-111111111111'

describe('eventSlugParams', () => {
  it.each(['mariage', 'camille-et-sacha', 'gala2026', 'a1'])('accepts the slug %s', (value) => {
    expect(eventSlugParams.safeParse({ eventSlug: value }).success).toBe(true)
  })

  it.each([
    ['uppercase', 'Mariage'],
    ['an underscore', 'a_b'],
    ['a leading dash', '-a'],
    ['a trailing dash', 'a-'],
    ['a double dash', 'a--b'],
    ['an accent', 'mariée'],
    ['a single character', 'a'],
    ['a path traversal', '../etc'],
    ['a slash', 'a/b'],
  ])('rejects a slug with %s', (_label, value) => {
    expect(eventSlugParams.safeParse({ eventSlug: value }).success).toBe(false)
  })

  it('agrees with the domain, so a malformed slug is a 400 and not a database round-trip', () => {
    // Two implementations of the same rule would drift; this asserts they match on the
    // cases that matter rather than hoping.
    for (const value of ['mariage', 'a-b-c', 'gala2026']) {
      expect(eventSlugParams.safeParse({ eventSlug: value }).success).toBe(Slug.create(value).ok)
    }
    for (const value of ['Mariage', 'a', 'a--b', '../etc']) {
      expect(eventSlugParams.safeParse({ eventSlug: value }).success).toBe(Slug.create(value).ok)
    }
  })
})

describe('photoParams', () => {
  it('accepts a uuid photo id', () => {
    expect(photoParams.safeParse({ eventSlug: 'mariage', photoId: UUID }).success).toBe(true)
  })

  it.each([
    ['a sequential integer', '3'],
    ['a traversal', '../../etc/passwd'],
    ['an empty string', ''],
  ])('rejects %s as a photo id', (_label, photoId) => {
    // Ids are opaque UUIDs precisely so that /photos/3 cannot invite /photos/4.
    expect(photoParams.safeParse({ eventSlug: 'mariage', photoId }).success).toBe(false)
  })
})

describe('photoVariantParams', () => {
  it.each(['thumb', 'display', 'original'])('accepts the variant %s', (variant) => {
    expect(
      photoVariantParams.safeParse({ eventSlug: 'mariage', photoId: UUID, variant }).success,
    ).toBe(true)
  })

  it('rejects a variant outside the closed set', () => {
    expect(
      photoVariantParams.safeParse({ eventSlug: 'mariage', photoId: UUID, variant: 'raw' }).success,
    ).toBe(false)
  })
})

describe('joinBody', () => {
  it('accepts a code and a name', () => {
    expect(joinBody.safeParse({ joinCode: 'H7K2QM', displayName: 'Léa' }).success).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])(
    'accepts %s as a display name, because anonymity is a supported choice',
    (_label, displayName) => {
      expect(joinBody.safeParse({ joinCode: 'H7K2QM', displayName }).success).toBe(true)
    },
  )

  it.each([
    ['lowercase', 'h7k2qm'],
    ['dashes', 'h7k2-qm'],
    ['spaces', 'H7K2 QM'],
    ['O typed for zero', 'H7K2QO'],
  ])('stays loose about %s, leaving normalisation to the domain', (_label, code) => {
    // The typo tolerance exists for a guest reading a printed card in a dark room.
    // Rejecting these at the boundary would undo it.
    expect(joinBody.safeParse({ joinCode: code }).success).toBe(true)
    expect(JoinCode.create(code).ok).toBe(true)
  })

  it('rejects an unbounded code', () => {
    expect(joinBody.safeParse({ joinCode: 'x'.repeat(500) }).success).toBe(false)
  })

  it('rejects an unexpected key, because it means the client and the contract disagree', () => {
    const result = joinBody.safeParse({ joinCode: 'H7K2QM', eventId: 'sneaky' })

    expect(result.success).toBe(false)
  })
})

describe('loginBody', () => {
  it('does not impose a minimum password length', () => {
    // The policy applies when a password is chosen. An account whose password predates
    // a policy change must still be able to sign in, and a minimum here would leak
    // which passwords are plausible.
    expect(loginBody.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true)
  })

  it('rejects an empty password rather than sending it to the hasher', () => {
    expect(loginBody.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false)
  })

  it('bounds the password, so a megabyte cannot reach bcrypt', () => {
    expect(loginBody.safeParse({ email: 'a@b.co', password: 'x'.repeat(2_000) }).success).toBe(
      false,
    )
  })

  it('leaves email validation to the domain', () => {
    // EmailAddress owns the shape rules; duplicating them here would be a second
    // implementation that drifts.
    expect(loginBody.safeParse({ email: 'not-an-email', password: 'whatever' }).success).toBe(true)
  })

  it('rejects an extra key', () => {
    expect(loginBody.safeParse({ email: 'a@b.co', password: 'x', remember: true }).success).toBe(
      false,
    )
  })
})

describe('changePasswordBody', () => {
  it('requires both passwords', () => {
    expect(changePasswordBody.safeParse({ currentPassword: 'a' }).success).toBe(false)
  })

  it('accepts a long passphrase', () => {
    expect(
      changePasswordBody.safeParse({
        currentPassword: 'old-passphrase-here',
        newPassword: 'a much longer passphrase with spaces',
      }).success,
    ).toBe(true)
  })
})

describe('createEventBody', () => {
  it('accepts a name alone, since the slug is derived from it', () => {
    expect(createEventBody.safeParse({ name: 'Camille & Sacha' }).success).toBe(true)
  })

  it('accepts an explicit slug', () => {
    expect(
      createEventBody.safeParse({ name: 'Camille & Sacha', slug: 'camille-et-sacha' }).success,
    ).toBe(true)
  })

  it('rejects a malformed explicit slug', () => {
    expect(createEventBody.safeParse({ name: 'X', slug: 'Not A Slug' }).success).toBe(false)
  })

  it('accepts a null start date and a null quota, meaning "use the default"', () => {
    expect(createEventBody.safeParse({ name: 'X', startsAt: null, quotaBytes: null }).success).toBe(
      true,
    )
  })

  it('rejects a non-ISO start date', () => {
    expect(createEventBody.safeParse({ name: 'X', startsAt: 'next tuesday' }).success).toBe(false)
  })

  it('rejects a zero or negative quota', () => {
    expect(createEventBody.safeParse({ name: 'X', quotaBytes: 0 }).success).toBe(false)
    expect(createEventBody.safeParse({ name: 'X', quotaBytes: -1 }).success).toBe(false)
  })
})

describe('updateSettingsBody', () => {
  it('accepts an empty patch, which changes nothing', () => {
    expect(updateSettingsBody.safeParse({}).success).toBe(true)
  })

  it('distinguishes an absent field from a cleared one', () => {
    // `retentionDays: null` clears retention; absent leaves it alone. Collapsing the
    // two would silently turn "do not touch it" into "keep forever".
    const cleared = updateSettingsBody.safeParse({ retentionDays: null })
    const absent = updateSettingsBody.safeParse({})

    expect(cleared.success && 'retentionDays' in cleared.data).toBe(true)
    expect(absent.success && 'retentionDays' in absent.data).toBe(false)
  })

  it.each([
    ['a grace window over a day', { guestSelfDeleteGraceSeconds: 90_000 }],
    ['a retention of zero days', { retentionDays: 0 }],
    ['a retention beyond ten years', { retentionDays: 4_000 }],
    ['a per-guest limit of zero', { maxPhotosPerGuest: 0 }],
    ['a moderation mode outside the set', { moderation: 'sometimes' }],
  ])('rejects %s', (_label, patch) => {
    expect(updateSettingsBody.safeParse(patch).success).toBe(false)
  })

  it('accepts a grace window of zero, meaning no self-deletion window at all', () => {
    expect(updateSettingsBody.safeParse({ guestSelfDeleteGraceSeconds: 0 }).success).toBe(true)
  })
})

describe('eventStatusBody', () => {
  it.each(['draft', 'live', 'closed', 'archived'])('accepts %s', (status) => {
    expect(eventStatusBody.safeParse({ status }).success).toBe(true)
  })

  it('rejects a status the lifecycle does not have', () => {
    expect(eventStatusBody.safeParse({ status: 'paused' }).success).toBe(false)
  })
})

describe('eventScheduleBody', () => {
  const OPEN_AT = '2026-06-20T16:00:00.000Z'
  const CLOSE_AT = '2026-06-21T00:00:00.000Z'

  it('accepts two instants in UTC', () => {
    expect(
      eventScheduleBody.safeParse({ scheduledOpenAt: OPEN_AT, scheduledCloseAt: CLOSE_AT }).success,
    ).toBe(true)
  })

  it.each([
    '2026-06-20T18:00:00+02:00',
    '2026-06-20T18:00:00-05:00',
    '2026-06-20T18:00:00.000+02:00',
  ])('accepts the offset %s, which a client outside UTC naturally sends', (value) => {
    // Bare `z.string().datetime()` refuses every one of these. It accepted only `Z`
    // while this schema's own comment and docs/API.md §6 both promised otherwise, so a
    // third-party client in Paris got `400 request.invalid` for a valid instant.
    expect(
      eventScheduleBody.safeParse({ scheduledOpenAt: value, scheduledCloseAt: null }).success,
    ).toBe(true)
  })

  it.each(['2026-06-20T18:00:00', '2026-06-20T18:00', '2026-06-20', '20/06/2026 18:00'])(
    'rejects %p, because the server does not know what time it is at the venue',
    (value) => {
      expect(
        eventScheduleBody.safeParse({ scheduledOpenAt: value, scheduledCloseAt: null }).success,
      ).toBe(false)
    },
  )

  it('accepts null on either half, which is "I will do this one myself"', () => {
    expect(
      eventScheduleBody.safeParse({ scheduledOpenAt: null, scheduledCloseAt: CLOSE_AT }).success,
    ).toBe(true)
    expect(
      eventScheduleBody.safeParse({ scheduledOpenAt: null, scheduledCloseAt: null }).success,
    ).toBe(true)
  })

  it.each(['scheduledOpenAt', 'scheduledCloseAt'])('requires %s to be present', (key) => {
    // Not a partial update: both fields are read together on one form, and an absent
    // key could mean either "leave it alone" or "there is no closing".
    const body: Record<string, string | null> = {
      scheduledOpenAt: OPEN_AT,
      scheduledCloseAt: CLOSE_AT,
    }
    delete body[key]

    expect(eventScheduleBody.safeParse(body).success).toBe(false)
  })

  it('is strict: an unexpected key is refused rather than silently ignored', () => {
    expect(
      eventScheduleBody.safeParse({
        scheduledOpenAt: OPEN_AT,
        scheduledCloseAt: CLOSE_AT,
        timezone: 'Europe/Paris',
      }).success,
    ).toBe(false)
  })

  it('does not decide whether the closing follows the opening', () => {
    // Shape only. The ordering rule, and the "already in the past" rule that needs the
    // clock, are `Event.reschedule`'s — a `z.refine` here would be a second copy.
    expect(
      eventScheduleBody.safeParse({ scheduledOpenAt: CLOSE_AT, scheduledCloseAt: OPEN_AT }).success,
    ).toBe(true)
  })
})

describe('moderationDecisionBody', () => {
  it.each(['publish', 'reject', 'hide'])('accepts the decision %s', (decision) => {
    expect(moderationDecisionBody.safeParse({ decision }).success).toBe(true)
  })

  it('rejects a photo status posted as a decision', () => {
    // The client sends the host's verb, never the resulting state. Keeping the two
    // vocabularies apart is what stops a client inventing a status.
    expect(moderationDecisionBody.safeParse({ decision: 'published' }).success).toBe(false)
  })
})

describe('bulkModerationBody', () => {
  it('accepts a screenful of ids', () => {
    const photoIds = Array.from({ length: 60 }, () => UUID)

    expect(bulkModerationBody.safeParse({ photoIds, decision: 'publish' }).success).toBe(true)
  })

  it('rejects an empty selection', () => {
    expect(bulkModerationBody.safeParse({ photoIds: [], decision: 'publish' }).success).toBe(false)
  })

  it('bounds the batch, so one request cannot hold a transaction across a whole album', () => {
    const photoIds = Array.from({ length: 201 }, () => UUID)

    expect(bulkModerationBody.safeParse({ photoIds, decision: 'publish' }).success).toBe(false)
  })

  it('rejects a non-uuid id in the batch', () => {
    expect(
      bulkModerationBody.safeParse({ photoIds: [UUID, '3'], decision: 'publish' }).success,
    ).toBe(false)
  })
})

describe('captionBody and reactionBody', () => {
  it('accepts null to clear a caption', () => {
    expect(captionBody.safeParse({ caption: null }).success).toBe(true)
  })

  it('requires the caption key, so a clear is explicit rather than an omission', () => {
    expect(captionBody.safeParse({}).success).toBe(false)
  })

  it.each(['love', 'laugh', 'wow', 'cheers', 'clap'])('accepts the reaction %s', (kind) => {
    expect(reactionBody.safeParse({ kind }).success).toBe(true)
  })

  it('rejects an arbitrary emoji, because the set is closed on purpose', () => {
    // Arbitrary emoji projected in front of a family is not acceptable.
    expect(reactionBody.safeParse({ kind: '🍆' }).success).toBe(false)
  })
})

describe('moderationQueueQuery', () => {
  it('defaults to the pending filter, which is what a host opens the console for', () => {
    const result = moderationQueueQuery.safeParse({})

    expect(result.success && result.data.status).toBe('pending')
    expect(result.success && result.data.limit).toBe(60)
  })

  it('coerces a numeric limit from its string form', () => {
    const result = moderationQueueQuery.safeParse({ limit: '25' })

    expect(result.success && result.data.limit).toBe(25)
  })

  it.each([
    ['zero', '0'],
    ['a fraction', '1.5'],
    ['over the cap', '500'],
    ['not a number', 'many'],
  ])('rejects a limit of %s', (_label, limit) => {
    expect(moderationQueueQuery.safeParse({ limit }).success).toBe(false)
  })

  /**
   * The queue answers `nextCursor: null` and always will: the domain orders the whole
   * filtered set before applying `limit`, so there is no stable position for a cursor to
   * name. Accepting one anyway — which this schema did for two reviews — told a caller
   * their page token had been read when the answer was the first page again.
   */
  it('refuses a cursor, because this queue is not cursor-paged and cannot be', () => {
    expect(moderationQueueQuery.safeParse({ cursor: 'photo-40' }).success).toBe(false)
  })

  it('refuses a cursor even alongside a filter and a limit it does accept', () => {
    const result = moderationQueueQuery.safeParse({
      status: 'pending',
      limit: '20',
      cursor: 'photo-40',
    })

    expect(result.success).toBe(false)
  })

  it('leaves the gallery its cursor, which is the paged surface', () => {
    // `photoListQuery` is the newest-first, stable listing; the two are not the same
    // endpoint and only one of them can resume.
    expect(photoListQuery.safeParse({ cursor: 'photo-40' }).success).toBe(true)
  })
})

describe('guestListQuery', () => {
  it('accepts the empty query, which is the only request this endpoint takes', () => {
    expect(guestListQuery.safeParse({}).success).toBe(true)
  })

  /**
   * The schema used to declare `activeWithinMinutes` 1..1440 (default 30) and the route
   * discarded it, so a host asking for two hours was answered with `listGuests`'s own
   * five-minute window and told nothing. What counts as "at the party" is one rule, so
   * the field is refused rather than threaded through.
   */
  it.each(['120', '30', '1'])(
    'refuses activeWithinMinutes=%s rather than appearing to honour it',
    (minutes) => {
      expect(guestListQuery.safeParse({ activeWithinMinutes: minutes }).success).toBe(false)
    },
  )

  it('refuses any other query parameter, as every query schema here does', () => {
    expect(guestListQuery.safeParse({ limit: '10' }).success).toBe(false)
  })
})

describe('wallQuery', () => {
  it('rejects a layout, which is the projector’s own choice and not the server’s', () => {
    // Accepting one would have the server hold a single screen's presentation state for
    // the length of a request. The display URL's `?layout=` is read in the browser.
    expect(wallQuery.safeParse({ layout: 'mosaic' }).success).toBe(false)
  })

  // Still accepted, and read by nothing on the server: the wall route passes
  // `slideIntervalMs: null` whatever the flag says, and the overrides are applied in the
  // browser off the display URL. Pinned as it is rather than as it should be, because
  // docs/API.md §9.5 is the entry that owns removing them — the `.strict()` refusal here
  // is what makes that a one-line change with a failing test in front of it.
  it('still accepts the e2e timing hooks the server does not read — API.md §9.5', () => {
    const result = wallQuery.safeParse({ e2e_interval: '250', e2e_transition: '0' })

    expect(result.success && result.data.e2e_interval).toBe(250)
    expect(result.success && result.data.e2e_transition).toBe(0)
  })

  it('rejects an interval below the floor, so a hook cannot spin the wall', () => {
    expect(wallQuery.safeParse({ e2e_interval: '1' }).success).toBe(false)
  })

  it('rejects an unknown query parameter', () => {
    expect(wallQuery.safeParse({ autoplay: 'true' }).success).toBe(false)
  })
})

describe('the second-factor bodies', () => {
  it('reads a body naming one proof as that proof', () => {
    expect(secondFactorProofOf({ code: '123456' })).toEqual({ code: '123456' })
    expect(secondFactorProofOf({ recoveryCode: 'AAAA-AAAA-AAAA-AAAA' })).toEqual({
      recoveryCode: 'AAAA-AAAA-AAAA-AAAA',
    })
  })

  it('reads a body naming none as none, and one naming both as ambiguous', () => {
    expect(secondFactorProofOf({})).toBeNull()
    expect(secondFactorProofOf({ code: '123456', recoveryCode: 'AAAA' })).toBe('both')
  })

  it('refuses a field of another name on every one of them: they are strict', () => {
    for (const schema of [
      secondFactorLoginBody,
      enrollSecondFactorBody,
      confirmSecondFactorBody,
      stepUpBody,
    ]) {
      expect(schema.safeParse({ password: 'x', code: '1', userId: 'someone-else' }).success).toBe(
        false,
      )
    }
  })

  it('takes the account from the session and never from the body of a step-up', () => {
    expect(stepUpBody.safeParse({ password: 'x', userId: 'someone-else' }).success).toBe(false)
  })

  it('bounds what it reads, so a megabyte of "code" costs nothing', () => {
    expect(secondFactorLoginBody.safeParse({ code: '1'.repeat(33) }).success).toBe(false)
    expect(secondFactorLoginBody.safeParse({ recoveryCode: 'A'.repeat(65) }).success).toBe(false)
    expect(stepUpBody.safeParse({ password: 'p'.repeat(1_001) }).success).toBe(false)
  })

  it('wants the password to enrol and to step up', () => {
    expect(enrollSecondFactorBody.safeParse({}).success).toBe(false)
    expect(stepUpBody.safeParse({ code: '123456' }).success).toBe(false)
  })
})

describe('unknown keys, decided per schema', () => {
  const objects = Object.entries(allSchemas).filter(
    (entry): entry is [string, z.ZodObject] => entry[1] instanceof z.ZodObject,
  )
  const strict = objects.filter(([name]) => !name.endsWith('Params'))

  it('found the schemas it sweeps', () => {
    // Vacuous otherwise: an export renamed out of reach of the sweep would be a schema
    // nobody checks, and the sweep would still be green.
    expect(strict.length).toBeGreaterThanOrEqual(30)
    expect(objects.length - strict.length).toBeGreaterThanOrEqual(8)
  })

  it.each(strict)(
    '%s refuses a key it does not declare, because every body and query is strict',
    (_name, schema) => {
      const outcome = schema.safeParse({ zzz: 1 })

      const unknown = outcome.success
        ? []
        : outcome.error.issues.flatMap((issue) =>
            issue.code === 'unrecognized_keys' ? issue.keys : [],
          )
      expect(unknown).toContain('zzz')
    },
  )

  it('refuses the retired darkroom on the way in: legacy names are read, never written', () => {
    const theme = {
      accentHue: 200,
      fonts: THEME_FONTS[0],
      frame: THEME_FRAMES[0],
      material: THEME_MATERIALS[0],
      ambiance: 'darkroom',
    }

    expect(updateSettingsBody.safeParse({ theme }).success).toBe(false)
  })

  it('refuses a key the theme does not declare, inside a settings body that is otherwise fine', () => {
    // zod 4 keeps `.strict()` as a legacy method and spells it `z.strictObject`; a nested object
    // that quietly went back to stripping would save a theme the host never chose.
    const theme = {
      accentHue: 200,
      fonts: THEME_FONTS[0],
      frame: THEME_FRAMES[0],
      material: THEME_MATERIALS[0],
      ambiance: THEME_AMBIANCES[0],
    }

    expect(updateSettingsBody.safeParse({ theme }).success).toBe(true)
    expect(updateSettingsBody.safeParse({ theme: { ...theme, zzz: 1 } }).success).toBe(false)
  })

  it('drops a key a path-parameter schema does not declare, since the route pattern owns its keys', () => {
    const parsed = eventSlugParams.safeParse({ eventSlug: 'mariage', zzz: 1 })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ eventSlug: 'mariage' })
  })
})

describe('the id shape the routes accept', () => {
  const NIL_ISH = '00000000-0000-0000-0000-000000000001'

  it.each([UUID, UUID.toUpperCase(), NIL_ISH, 'ffffffff-ffff-ffff-ffff-ffffffffffff'])(
    'accepts %s: eight, four, four, four and twelve hexadecimal digits, as zod 3 read an id',
    (photoId) => {
      // zod 4's `z.uuid()` would refuse the third: it carries no RFC 9562 version. A dependency
      // upgrade does not get to change which requests the API answers.
      expect(photoParams.safeParse({ eventSlug: 'mariage', photoId }).success).toBe(true)
    },
  )

  it.each([
    ['braces', `{${UUID}}`],
    ['a urn prefix', `urn:uuid:${UUID}`],
    ['a trailing newline', `${UUID}\n`],
    ['no hyphens', UUID.replaceAll('-', '')],
    ['a non-hexadecimal digit', `g${UUID.slice(1)}`],
    ['a missing digit', UUID.slice(0, -1)],
  ])('rejects an id with %s', (_label, photoId) => {
    expect(photoParams.safeParse({ eventSlug: 'mariage', photoId }).success).toBe(false)
  })

  it('applies the same shape to the ids a body or a form carries', () => {
    expect(uploadFields.safeParse({ missionId: NIL_ISH }).success).toBe(true)
    expect(uploadFields.safeParse({ missionId: 'not-an-id' }).success).toBe(false)
    expect(createEventBody.safeParse({ name: 'X', clientId: NIL_ISH }).success).toBe(true)
    expect(createEventBody.safeParse({ name: 'X', clientId: 'not-an-id' }).success).toBe(false)
    expect(bulkModerationBody.safeParse({ photoIds: [NIL_ISH], decision: 'publish' }).success).toBe(
      true,
    )
    expect(
      bulkModerationBody.safeParse({ photoIds: ['not-an-id'], decision: 'publish' }).success,
    ).toBe(false)
  })
})

describe('the instants a request may carry', () => {
  const body = (scheduledOpenAt: string) => ({ scheduledOpenAt, scheduledCloseAt: null })

  it.each(['2026-06-20T18:00Z', '2026-06-20T18:00:00Z', '2026-06-20T18:00:00.123456789Z'])(
    'accepts %s as a start, in UTC, with or without seconds and a fraction',
    (startsAt) => {
      // zod 4's own reading requires seconds, so `18:00Z` became a 400 for a client that had
      // always been answered.
      expect(createEventBody.safeParse({ name: 'X', startsAt }).success).toBe(true)
    },
  )

  it.each([
    '2026-06-20T18:00:00+02:00',
    '2026-06-20T18:00:00+0200',
    '2026-06-20T18:00+02:00',
    '2026-06-20T18:00:00.000-05:30',
  ])('accepts the scheduled instant %s, whichever way it writes its offset', (value) => {
    expect(eventScheduleBody.safeParse(body(value)).success).toBe(true)
  })

  it.each([
    '2026-06-20T18:00:00+02',
    '2026-06-20T18:00:00 +02:00',
    '2026-06-20T18:00:00ZZ',
    '2026-06-20T18:00:00+02:000',
    '2026-06-20T18:00:00+02:00x',
    '2026-06-20T18:00:00+02000',
    '2026-06-20T18:00:00+020000',
  ])('rejects the scheduled instant %s, which is neither Z nor an offset', (value) => {
    expect(eventScheduleBody.safeParse(body(value)).success).toBe(false)
  })

  it('refuses an offset on a start, which is read as an instant in UTC and nothing else', () => {
    expect(
      createEventBody.safeParse({ name: 'X', startsAt: '2026-06-20T18:00:00+02:00' }).success,
    ).toBe(false)
  })

  it.each([
    ['a day that month does not have', '2026-02-30T18:00:00Z'],
    ['a leap day in a year that is not one', '2027-02-29T18:00:00Z'],
    ['an hour past 23', '2026-06-20T24:00:00Z'],
    ['a minute past 59', '2026-06-20T18:60:00Z'],
    ['a trailing newline', '2026-06-20T18:00:00Z\n'],
    // The seconds are the only guard a start has: `Event.create` never reads `startsAt`, and
    // `new Date('2026-06-20T18:00:99Z')` is an Invalid Date that throws when it is written.
    ['seconds past 59', '2026-06-20T18:00:60Z'],
    ['seconds that are not seconds', '2026-06-20T18:00:99Z'],
    ['a fraction with no digits', '2026-06-20T18:00:00.Z'],
    ['a lower-case z', '2026-06-20T18:00:00z'],
    ['text before the date', 'junk2026-06-20T18:00:00Z'],
    ['a leading space', ' 2026-06-20T18:00:00Z'],
  ])('rejects %s', (_label, startsAt) => {
    expect(createEventBody.safeParse({ name: 'X', startsAt }).success).toBe(false)
  })

  it('accepts a leap day in a year that has one', () => {
    expect(createEventBody.safeParse({ name: 'X', startsAt: '2028-02-29T18:00:00Z' }).success).toBe(
      true,
    )
  })
})

describe('integers too large to be integers', () => {
  it.each([
    ['a quota', () => createEventBody.safeParse({ name: 'X', quotaBytes: 2 ** 53 })],
    ['a link lifetime', () => shareLinkBody.safeParse({ expiresInDays: 2 ** 53 })],
    [
      'a grant expiry',
      () => galleryGrantQuery.safeParse({ e: '9007199254740993', s: 'a'.repeat(43) }),
    ],
  ])('refuses %s past 2^53, which a double cannot tell from its neighbour', (_label, parse) => {
    // zod 3 accepted these and rounded them; zod 4's `.int()` means a safe integer.
    expect(parse().success).toBe(false)
  })
})

describe('the two bodies of an invitation (G2-09)', () => {
  // A union, so the sweep over `z.ZodObject` exports does not reach it: each of its two arms is
  // `z.strictObject`, and these cases are what hold that. No field of either can name an account.
  const CHOSEN = { password: 'une-phrase-de-passe-longue', displayName: 'Camille' }

  it.each([
    ['the signed-in account, with nothing', {}],
    ['a person choosing how to sign in', CHOSEN],
  ])('accepts %s', (_name, body) => {
    expect(acceptInvitationBody.safeParse(body).success).toBe(true)
  })

  it.each([
    ['an account id with nothing else', { userId: UUID }],
    ['an address with nothing else', { email: 'autre@example.test' }],
    ['an account id beside a name and a password', { ...CHOSEN, userId: UUID }],
    ['an address beside a name and a password', { ...CHOSEN, email: 'autre@example.test' }],
    ['a password with no name', { password: CHOSEN.password }],
    ['a name with no password', { displayName: CHOSEN.displayName }],
    ['an empty password', { ...CHOSEN, password: '' }],
    ['an empty name', { ...CHOSEN, displayName: '' }],
    ['a name past its bound', { ...CHOSEN, displayName: 'x'.repeat(201) }],
    ['a password past its bound', { ...CHOSEN, password: 'x'.repeat(1_001) }],
  ])('refuses %s, so an acceptance names no account but the session', (_name, body) => {
    expect(acceptInvitationBody.safeParse(body).success).toBe(false)
  })

  // G2-20: the tick of the terms of use rides either form, and is the one key besides the
  // credentials. It is a boolean and no more; the version recorded is never a request's.
  it.each([
    ['the signed-in account, with the tick', { acceptTerms: true }],
    ['the signed-in account, with the box unticked', { acceptTerms: false }],
    ['a person choosing how to sign in, with the tick', { ...CHOSEN, acceptTerms: true }],
    ['a person choosing how to sign in, with the box unticked', { ...CHOSEN, acceptTerms: false }],
  ])('accepts %s', (_name, body) => {
    expect(acceptInvitationBody.safeParse(body).success).toBe(true)
  })

  it.each([
    ['a word as the tick', { acceptTerms: 'yes' }],
    ['a number as the tick', { ...CHOSEN, acceptTerms: 1 }],
    ['null as the tick', { acceptTerms: null }],
    ['a version the request chose', { ...CHOSEN, acceptTerms: true, version: '1999-01' }],
    ['a version with the signed-in form', { acceptTerms: true, termsVersion: '1999-01' }],
    ['an account id beside the tick', { acceptTerms: true, userId: UUID }],
  ])('refuses %s', (_name, body) => {
    expect(acceptInvitationBody.safeParse(body).success).toBe(false)
  })

  it('refuses a key the form does not declare, and says which', () => {
    const outcome = moderatorInvitationBody.safeParse({ email: 'a@example.test', zzz: 1 })

    expect(outcome.success).toBe(false)
    expect(JSON.stringify(outcome.error?.issues)).toContain('zzz')
  })

  it('refuses what the 2.x form sent, which the 3.0 route no longer takes', () => {
    expect(
      moderatorInvitationBody.safeParse({ email: 'a@example.test', temporaryPassword: 'x' })
        .success,
    ).toBe(false)
    expect(
      moderatorInvitationBody.safeParse({ email: 'a@example.test', displayName: 'Camille' })
        .success,
    ).toBe(false)
  })

  it('writes the invitation in French when the form names no language', () => {
    expect(moderatorInvitationBody.parse({ email: 'a@example.test' }).locale).toBe('fr')
  })
})

/**
 * Every closed vocabulary a request names is built from the domain constant that owns it
 * (HTTP-M-11). They were literal arrays beside comments saying the vocabulary came from the
 * domain, so a value the domain gained was a `400` at the boundary with nothing red. Each case
 * walks the constant: add a value there and it is accepted here, or the case that names it says so.
 */
describe('the vocabularies a request names come from the domain (HTTP-M-11)', () => {
  const PHOTO = '11111111-1111-4111-8111-111111111111'
  const NO_SUCH_WORD = 'applause'

  it.each(REACTION_KINDS)('accepts the reaction kind %s, in a body and in a path', (kind) => {
    expect(reactionBody.safeParse({ kind }).success).toBe(true)
    expect(reactionParams.safeParse({ eventSlug: 'mariage', photoId: PHOTO, kind }).success).toBe(
      true,
    )
  })

  it.each(MODERATION_DECISIONS)(
    'accepts the moderation decision %s, alone and in bulk',
    (decision) => {
      expect(moderationDecisionBody.safeParse({ decision }).success).toBe(true)
      expect(bulkModerationBody.safeParse({ photoIds: [PHOTO], decision }).success).toBe(true)
    },
  )

  it.each(SERVED_VARIANTS)(
    'accepts the media variant %s, for a host and for a gallery',
    (variant) => {
      expect(
        photoVariantParams.safeParse({ eventSlug: 'mariage', photoId: PHOTO, variant }).success,
      ).toBe(true)
      expect(galleryMediaParams.safeParse({ linkId: PHOTO, photoId: PHOTO, variant }).success).toBe(
        true,
      )
    },
  )

  it.each([...PHOTO_STATUSES, 'all'])('accepts the photo filter %s, in both listings', (status) => {
    expect(photoListQuery.safeParse({ status }).success).toBe(true)
    expect(moderationQueueQuery.safeParse({ status }).success).toBe(true)
  })

  it.each(EVENT_STATUSES)('accepts the event status %s', (status) => {
    expect(eventStatusBody.safeParse({ status }).success).toBe(true)
  })

  it.each(MODERATION_MODES)('accepts the moderation mode %s in the settings', (moderation) => {
    expect(updateSettingsBody.safeParse({ moderation }).success).toBe(true)
  })

  it('refuses a word that no vocabulary holds, in each of them', () => {
    expect(reactionBody.safeParse({ kind: NO_SUCH_WORD }).success).toBe(false)
    expect(
      reactionParams.safeParse({ eventSlug: 'mariage', photoId: PHOTO, kind: NO_SUCH_WORD })
        .success,
    ).toBe(false)
    expect(moderationDecisionBody.safeParse({ decision: NO_SUCH_WORD }).success).toBe(false)
    expect(
      bulkModerationBody.safeParse({ photoIds: [PHOTO], decision: NO_SUCH_WORD }).success,
    ).toBe(false)
    expect(moderationQueueQuery.safeParse({ status: NO_SUCH_WORD }).success).toBe(false)
    expect(
      galleryMediaParams.safeParse({ linkId: PHOTO, photoId: PHOTO, variant: NO_SUCH_WORD })
        .success,
    ).toBe(false)
    expect(
      photoVariantParams.safeParse({
        eventSlug: 'mariage',
        photoId: PHOTO,
        variant: NO_SUCH_WORD,
      }).success,
    ).toBe(false)
    expect(photoListQuery.safeParse({ status: NO_SUCH_WORD }).success).toBe(false)
    expect(eventStatusBody.safeParse({ status: NO_SUCH_WORD }).success).toBe(false)
    expect(updateSettingsBody.safeParse({ moderation: NO_SUCH_WORD }).success).toBe(false)
  })

  it('keeps the staged upload out of what a request may ask to be served', () => {
    // `source` is the guest's un-stripped original, on its way to the transcoder: it is a
    // stored variant and never a served one.
    expect(
      photoVariantParams.safeParse({ eventSlug: 'mariage', photoId: PHOTO, variant: 'source' })
        .success,
    ).toBe(false)
    // And the public gallery, which hands originals to strangers, is the surface where it matters most.
    expect(
      galleryMediaParams.safeParse({ linkId: PHOTO, photoId: PHOTO, variant: 'source' }).success,
    ).toBe(false)
  })

  it('bounds a host’s page at 200 rows in both listings', () => {
    for (const schema of [photoListQuery, moderationQueueQuery]) {
      expect(schema.safeParse({ limit: '200' }).success).toBe(true)
      expect(schema.safeParse({ limit: '201' }).success).toBe(false)
    }
  })
})

/** One bound for an e-mail address wherever a person types one (HTTP-L-09). */
describe('an e-mail address has one bound where a person types one (HTTP-L-09)', () => {
  const longest = `${'a'.repeat(EmailAddress.maxLength - '@example.org'.length)}@example.org`
  const oneTooLong = `a${longest}`
  const places: readonly (readonly [string, (email: string) => boolean])[] = [
    ['the sign-in', (email) => loginBody.safeParse({ email, password: 'x' }).success],
    [
      'the password reset request',
      (email) => passwordResetRequestBody.safeParse({ email }).success,
    ],
    ['the moderator invitation', (email) => moderatorInvitationBody.safeParse({ email }).success],
  ]

  it('is the length the domain lets an address be, 254', () => {
    expect(EmailAddress.maxLength).toBe(254)
    expect(longest).toHaveLength(254)
    expect(oneTooLong).toHaveLength(255)
  })

  it.each(places)('accepts 254 characters and refuses 255 in %s', (_place, accepts) => {
    expect(accepts(longest)).toBe(true)
    expect(accepts(oneTooLong)).toBe(false)
  })
})
