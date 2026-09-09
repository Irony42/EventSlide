import { describe, expect, it } from 'vitest'
import { AT, aGuest, aPhoto, aReaction, aUser, anEvent, anEventSettings, atPlus } from './builders'

describe('builders', () => {
  it('builds an event that is live and therefore accepts uploads', async () => {
    const event = anEvent()

    expect(event.status).toBe('live')
    expect(event.acceptsUploads()).toBe(true)
  })

  it('derives every timestamp from the one fixed instant', async () => {
    expect(anEvent().createdAt.toISOString()).toBe(AT.toISOString())
    expect(aPhoto().createdAt.toISOString()).toBe(AT.toISOString())
    expect(aGuest().joinedAt.toISOString()).toBe(AT.toISOString())
    expect(aUser().createdAt.toISOString()).toBe(AT.toISOString())
    expect(aReaction().createdAt.toISOString()).toBe(AT.toISOString())
  })

  it('applies an override without disturbing the other defaults', async () => {
    const event = anEvent({ quotaBytes: 4_096 })

    expect(event.quotaBytes).toBe(4_096)
    expect(event.slug.value).toBe('camille-et-sacha')
  })

  it('stamps closedAt on a closed event, so the retention clock actually runs', async () => {
    const event = anEvent({ status: 'closed', settings: { retentionDays: 1 } })

    expect(event.retentionDeadline()).not.toBeNull()
  })

  it('leaves a live event with no closing time', async () => {
    expect(anEvent({ status: 'live' }).closedAt).toBeNull()
  })

  it('accepts a settings object as readily as a patch', async () => {
    const event = anEvent({ settings: anEventSettings({ moderation: 'auto' }) })

    expect(event.settings.moderation).toBe('auto')
  })

  it('builds settings on the domain defaults', async () => {
    const settings = anEventSettings()

    expect(settings.moderation).toBe('manual')
    expect(settings.retentionDays).toBeNull()
  })

  it('builds a pending photo from a guest, which is what ingest produces', async () => {
    const photo = aPhoto()

    expect(photo.status).toBe('pending')
    expect(photo.author).toEqual({ kind: 'guest', guestId: 'guest-1' })
    expect(photo.review).toBeNull()
  })

  it('records a decision on a photo built past pending', async () => {
    const photo = aPhoto({ status: 'published', createdAt: atPlus(1_000) })

    expect(photo.review).toEqual({ kind: 'automatic', at: atPlus(1_000) })
  })

  it('accepts an explicit host decision', async () => {
    const photo = aPhoto({
      status: 'rejected',
      review: { kind: 'host', userId: 'user-7', at: atPlus(2_000) },
    })

    expect(photo.review).toEqual({ kind: 'host', userId: 'user-7', at: atPlus(2_000) })
  })

  it('builds a photo authored by a host', async () => {
    const photo = aPhoto({ author: { kind: 'host', id: 'user-7' } })

    expect(photo.author).toEqual({ kind: 'host', userId: 'user-7' })
  })

  it('derives a valid content hash from the photo id', async () => {
    expect(aPhoto({ id: 'p1' }).contentHash.value).toMatch(/^[0-9a-f]{64}$/)
  })

  it('derives the same hash for the same id, so a duplicate upload is reproducible', async () => {
    expect(aPhoto({ id: 'p1', eventId: 'a' }).contentHash.value).toBe(
      aPhoto({ id: 'p1', eventId: 'b' }).contentHash.value,
    )
  })

  it('derives a different hash per id, so two fixtures never collide on the index', async () => {
    expect(aPhoto({ id: 'p1' }).contentHash.value).not.toBe(aPhoto({ id: 'p2' }).contentHash.value)
  })

  it('builds a guest with a name and a guest without one', async () => {
    expect(aGuest().label()).toBe('Léa')
    expect(aGuest({ displayName: null }).label()).toBeNull()
  })

  it('builds an active guest whose token still grants uploads', async () => {
    expect(aGuest().isActive()).toBe(true)
  })

  it('builds a user who can sign in and has never done so', async () => {
    const user = aUser()

    expect(user.canSignIn()).toBe(true)
    expect(user.lastLoginAt).toBeNull()
  })

  it('normalises a user email the way the login lookup will', async () => {
    expect(aUser({ email: 'Hote@Example.TEST' }).email.value).toBe('hote@example.test')
  })

  it('builds a reaction from the closed set', async () => {
    expect(aReaction({ kind: 'cheers' }).kind).toBe('cheers')
  })

  const invalidFixtures: readonly { readonly label: string; readonly build: () => unknown }[] = [
    { label: 'an event with a reserved slug', build: () => anEvent({ slug: 'admin' }) },
    { label: 'an event with no quota', build: () => anEvent({ quotaBytes: 0 }) },
    { label: 'an event with a one-letter name', build: () => anEvent({ name: 'x' }) },
    { label: 'an event with a short join code', build: () => anEvent({ joinCode: 'ABC' }) },
    {
      label: 'settings with a negative grace window',
      build: () => anEventSettings({ guestSelfDeleteGraceSeconds: -1 }),
    },
    { label: 'a photo with no bytes', build: () => aPhoto({ byteSize: 0 }) },
    { label: 'a photo with a malformed hash', build: () => aPhoto({ contentHash: 'nope' }) },
    { label: 'a photo with a zero edge', build: () => aPhoto({ width: 0 }) },
    {
      label: 'a photo with an oversized caption',
      build: () => aPhoto({ caption: 'x'.repeat(141) }),
    },
    {
      label: 'a guest with an oversized name',
      build: () => aGuest({ displayName: 'x'.repeat(41) }),
    },
    { label: 'a user with a malformed email', build: () => aUser({ email: 'pas-un-email' }) },
    { label: 'a user with an empty password hash', build: () => aUser({ passwordHash: '  ' }) },
    { label: 'a reaction outside the closed set', build: () => aReaction({ kind: 'shrug' }) },
  ]

  // A builder is test infrastructure: a fixture the domain refuses must fail here and
  // now, rather than travel through a test as a silently wrong value.
  it.each(invalidFixtures)('throws on $label', async ({ build }) => {
    expect(build).toThrow(/invalid fixture/)
  })
})
