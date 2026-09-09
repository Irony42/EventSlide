import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../shared/ids'
import { DisplayName } from './displayName'
import { Guest, type GuestProps } from './guest'

const eventId = asEventId('evt-camille-et-sacha')
const guestId = asGuestId('gst-lea')

const JOINED_AT = new Date('2026-06-20T18:00:00.000Z')
const IDLE_MS = 120_000

const at = (offsetMs: number): Date => new Date(JOINED_AT.getTime() + offsetMs)

/** Setup only: a name this test file cannot parse is a broken test, not a rule. */
const nameOf = (raw: string): DisplayName => {
  const parsed = DisplayName.create(raw)
  if (!parsed.ok) throw new Error(`test setup: ${raw} is not a valid display name`)
  return parsed.value
}

const aGuest = (overrides: Partial<GuestProps> = {}): Guest =>
  Guest.restore({
    id: guestId,
    eventId,
    displayName: null,
    joinedAt: JOINED_AT,
    lastSeenAt: JOINED_AT,
    revokedAt: null,
    photoCount: 0,
    ...overrides,
  })

describe('Guest.create', () => {
  it('counts joining as having been seen', () => {
    const result = Guest.create({ eventId, displayName: null }, guestId, JOINED_AT)

    expect(result.ok && result.value.joinedAt).toEqual(JOINED_AT)
    expect(result.ok && result.value.lastSeenAt).toEqual(JOINED_AT)
  })

  it('starts a guest with no photos to their name', () => {
    const result = Guest.create({ eventId, displayName: null }, guestId, JOINED_AT)

    expect(result.ok && result.value.photoCount).toBe(0)
  })

  it('starts a guest whose device token works', () => {
    const result = Guest.create({ eventId, displayName: null }, guestId, JOINED_AT)

    expect(result.ok && result.value.isActive()).toBe(true)
  })

  it('keeps the name the guest chose on the join screen', () => {
    const lea = nameOf('Léa')

    const result = Guest.create({ eventId, displayName: lea }, guestId, JOINED_AT)

    expect(result.ok && result.value.displayName).toBe(lea)
  })

  it('binds the guest to the single event they joined', () => {
    const result = Guest.create({ eventId, displayName: null }, guestId, JOINED_AT)

    expect(result.ok && result.value.eventId).toBe(eventId)
    expect(result.ok && result.value.id).toBe(guestId)
  })
})

describe('Guest.rename', () => {
  it('puts the new name under the photos', () => {
    const guest = aGuest({ displayName: nameOf('Léa') })

    const renamed = guest.rename(nameOf('Sacha'))

    expect(renamed.ok && renamed.value.label()).toBe('Sacha')
  })

  it('lets a guest go back to being anonymous', () => {
    const guest = aGuest({ displayName: nameOf('Léa') })

    const renamed = guest.rename(null)

    expect(renamed.ok && renamed.value.label()).toBeNull()
  })

  it('leaves the guest it was called on untouched', () => {
    const guest = aGuest({ displayName: nameOf('Léa') })

    guest.rename(nameOf('Sacha'))

    expect(guest.label()).toBe('Léa')
  })

  it('refuses to rename a guest the host has removed', () => {
    const guest = aGuest({ displayName: nameOf('Léa'), revokedAt: at(60_000) })

    const renamed = guest.rename(nameOf('Sacha'))

    expect(!renamed.ok && renamed.error.code).toBe('guest.revoked')
  })

  it('treats a removed guest as forbidden rather than as bad input', () => {
    const guest = aGuest({ revokedAt: at(60_000) })

    const renamed = guest.rename(nameOf('Sacha'))

    expect(!renamed.ok && renamed.error.kind).toBe('forbidden')
  })
})

describe('Guest.label', () => {
  it('is the display name of a guest who gave one', () => {
    expect(aGuest({ displayName: nameOf('Léa') }).label()).toBe('Léa')
  })

  it('is absent for an anonymous guest, so the UI picks its own wording', () => {
    expect(aGuest().label()).toBeNull()
  })
})

describe('Guest.touch', () => {
  it('moves lastSeenAt forward when the guest comes back', () => {
    const guest = aGuest()

    const seen = guest.touch(at(30_000))

    expect(seen.lastSeenAt).toEqual(at(30_000))
  })

  it('ignores a timestamp older than the one already recorded', () => {
    const guest = aGuest({ lastSeenAt: at(30_000) })

    const seen = guest.touch(at(10_000))

    expect(seen.lastSeenAt).toEqual(at(30_000))
  })

  it('ignores a timestamp equal to the one already recorded', () => {
    const guest = aGuest({ lastSeenAt: at(30_000) })

    expect(guest.touch(at(30_000))).toBe(guest)
  })

  it('leaves the guest it was called on untouched', () => {
    const guest = aGuest()

    guest.touch(at(30_000))

    expect(guest.lastSeenAt).toEqual(JOINED_AT)
  })
})

describe('Guest.isStale', () => {
  it.each([
    { rule: 'a guest seen a moment ago is at the party', elapsedMs: 1_000, stale: false },
    {
      rule: 'a guest seen exactly one idle window ago is at the party',
      elapsedMs: IDLE_MS,
      stale: false,
    },
    {
      rule: 'a guest unseen for longer than the idle window has gone home',
      elapsedMs: IDLE_MS + 1,
      stale: true,
    },
  ])('$rule', ({ elapsedMs, stale }) => {
    expect(aGuest().isStale(at(elapsedMs), IDLE_MS)).toBe(stale)
  })
})

describe('Guest.revoke', () => {
  it('records when the host removed the guest', () => {
    const guest = aGuest()

    const removed = guest.revoke(at(60_000))

    expect(removed.revokedAt).toEqual(at(60_000))
  })

  it('reports a removed guest as no longer holding a working token', () => {
    const removed = aGuest().revoke(at(60_000))

    expect(removed.isActive()).toBe(false)
    expect(removed.isRevoked()).toBe(true)
  })

  it('keeps the first revocation when the host taps the button twice', () => {
    const removed = aGuest().revoke(at(60_000))

    const removedAgain = removed.revoke(at(90_000))

    expect(removedAgain.revokedAt).toEqual(at(60_000))
  })

  it('leaves the guest it was called on untouched', () => {
    const guest = aGuest()

    guest.revoke(at(60_000))

    expect(guest.revokedAt).toBeNull()
  })

  it('reports a guest nobody removed as active', () => {
    const guest = aGuest()

    expect(guest.isActive()).toBe(true)
    expect(guest.isRevoked()).toBe(false)
  })
})

describe('Guest photo count', () => {
  it('counts a photo the guest sent', () => {
    const guest = aGuest({ photoCount: 2 })

    expect(guest.recordPhoto().photoCount).toBe(3)
  })

  it('leaves the guest it was called on untouched', () => {
    const guest = aGuest({ photoCount: 2 })

    guest.recordPhoto()

    expect(guest.photoCount).toBe(2)
  })

  it('gives the slot back when one of their photos is removed', () => {
    const guest = aGuest({ photoCount: 2 })

    expect(guest.forgetPhoto().photoCount).toBe(1)
  })

  it('never lets the count fall below zero', () => {
    const guest = aGuest({ photoCount: 0 })

    expect(guest.forgetPhoto().photoCount).toBe(0)
  })
})

describe('Guest.canUploadMore', () => {
  it.each([
    {
      rule: 'no per-guest limit means the guest keeps uploading',
      photoCount: 12,
      limit: null,
      allowed: true,
    },
    {
      rule: 'a guest below the per-guest limit may send another',
      photoCount: 2,
      limit: 3,
      allowed: true,
    },
    {
      rule: 'a guest at exactly the per-guest limit may not',
      photoCount: 3,
      limit: 3,
      allowed: false,
    },
    {
      rule: 'a guest already past the per-guest limit may not',
      photoCount: 4,
      limit: 3,
      allowed: false,
    },
  ])('$rule', ({ photoCount, limit, allowed }) => {
    expect(aGuest({ photoCount }).canUploadMore(limit)).toBe(allowed)
  })
})

describe('Guest identity', () => {
  it('treats two states of the same guest as the same guest', () => {
    const guest = aGuest()

    expect(guest.touch(at(30_000)).equals(guest)).toBe(true)
  })

  it('treats guests with different ids as different guests', () => {
    const other = aGuest({ id: asGuestId('gst-sacha') })

    expect(aGuest().equals(other)).toBe(false)
  })

  it('exposes every field a repository restored, not only the ones create sets', () => {
    const restored = Guest.restore({
      id: guestId,
      eventId,
      displayName: nameOf('Léa'),
      joinedAt: JOINED_AT,
      lastSeenAt: at(30_000),
      revokedAt: at(60_000),
      photoCount: 4,
    })

    expect(restored.label()).toBe('Léa')
    expect(restored.lastSeenAt).toEqual(at(30_000))
    expect(restored.revokedAt).toEqual(at(60_000))
    expect(restored.photoCount).toBe(4)
  })

  it('snapshots the state a transition produced, not the state it started from', () => {
    const removed = aGuest({ photoCount: 4 }).revoke(at(60_000))

    expect(removed.toProps()).toEqual({
      id: guestId,
      eventId,
      displayName: null,
      joinedAt: JOINED_AT,
      lastSeenAt: JOINED_AT,
      revokedAt: at(60_000),
      photoCount: 4,
    })
  })
})
