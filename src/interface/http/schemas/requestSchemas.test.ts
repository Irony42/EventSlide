import { describe, expect, it } from 'vitest'
import {
  bulkModerationBody,
  captionBody,
  changePasswordBody,
  createEventBody,
  eventSlugParams,
  eventStatusBody,
  joinBody,
  loginBody,
  guestListQuery,
  moderationDecisionBody,
  moderationQueueQuery,
  photoListQuery,
  photoParams,
  photoVariantParams,
  reactionBody,
  updateSettingsBody,
  wallQuery,
} from './requestSchemas'
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
