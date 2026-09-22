import { beforeEach, describe, expect, it } from 'vitest'
import { anEvent, AT } from '../../testing/builders'
import {
  buildGalleryWorld,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import type { GallerySigner } from '../../ports/gallerySigner'
import { asEventId } from '../../../domain/shared/ids'
import { makeCreateShareLink, type CreateShareLinkInput } from './createShareLink'

const DAY = 24 * 60 * 60 * 1000

describe('createShareLink', () => {
  let world: GalleryWorld

  const create = (
    input: Partial<CreateShareLinkInput> = {},
    signer: GallerySigner = world.signer,
  ) => makeCreateShareLink({ ...world, signer })({ eventId: WEDDING, actorId: OWNER, ...input })

  beforeEach(() => {
    world = buildGalleryWorld()
  })

  it('gives the owner an open link for a month, and the token that opens it', async () => {
    const result = await create()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.token).toBe('token-1')
    expect(result.value.link.eventId).toBe(WEDDING)
    expect(result.value.link.createdBy).toBe(OWNER)
    expect(result.value.link.expiresAt).toEqual(new Date(AT.getTime() + 30 * DAY))
    expect(result.value.link.isOpenAt(AT)).toBe(true)
    expect((await world.shareLinks.findCurrent(WEDDING))?.id).toBe(result.value.link.id)
  })

  it('stores the digest of the token and never the token itself', async () => {
    const result = await create()
    if (!result.ok) throw new Error('expected a link')

    const stored = world.shareLinks.all()

    expect(stored.map((link) => link.tokenDigest)).toEqual([world.signer.digestOf('token-1')])
    expect(JSON.stringify(stored.map((link) => link.toProps()))).not.toContain('token-1')
  })

  it('honours the lifetime the host chose', async () => {
    const result = await create({ lifetimeDays: 7 })

    expect(result.ok && result.value.link.expiresAt).toEqual(new Date(AT.getTime() + 7 * DAY))
  })

  it('refuses a lifetime past the ceiling and stores nothing', async () => {
    const result = await create({ lifetimeDays: 365 })

    expect(!result.ok && result.error.code).toBe('shareLink.lifetimeInvalid')
    expect(world.shareLinks.all()).toEqual([])
  })

  it('hashes a password with the account hasher, so the link asks for it', async () => {
    const result = await create({ password: 'les mariés de juin' })

    expect(result.ok && result.value.link.passwordHash).toBe('hash:les mariés de juin')
    expect(result.ok && result.value.link.requiresPassword).toBe(true)
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an empty field', ''],
  ])('makes a link with no password when the password is %s', async (_label, password) => {
    const result = await create({ password })

    expect(result.ok && result.value.link.requiresPassword).toBe(false)
  })

  it('refuses a password the account policy would refuse, and stores nothing', async () => {
    const result = await create({ password: 'court' })

    expect(!result.ok && result.error.code).toBe('password.tooShort')
    expect(world.shareLinks.all()).toEqual([])
  })

  it('refuses the event’s own name as its password', async () => {
    const result = await create({ password: 'Camille & Sacha' })

    expect(!result.ok && result.error.code).toBe('password.sameAsName')
  })

  it('revokes the previous link in the same act, so a leaked link stops opening', async () => {
    const first = await create()
    if (!first.ok) throw new Error('expected a link')
    world.clock.advance(DAY)

    const second = await create()

    expect(second.ok && second.value.token).toBe('token-2')
    const old = world.shareLinks.all().find((link) => link.id === first.value.link.id)
    expect(old?.revokedAt).toEqual(new Date(AT.getTime() + DAY))
    expect((await world.shareLinks.findCurrent(WEDDING))?.id).not.toBe(first.value.link.id)
  })

  it('makes a link for an archived event, because that is when an album is sent', async () => {
    world.events.seed(
      anEvent({
        id: 'evt-archived',
        ownerId: OWNER,
        slug: 'archive',
        joinCode: 'A2B3C4',
        status: 'archived',
      }),
    )
    world.memberships.seed({
      eventId: asEventId('evt-archived'),
      userId: OWNER,
      role: 'owner',
      grantedAt: AT,
    })

    const result = await create({ eventId: asEventId('evt-archived') })

    expect(result.ok).toBe(true)
  })

  it('refuses a moderator, who may not publish the album to the outside', async () => {
    const result = await create({ actorId: MODERATOR })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect(world.shareLinks.all()).toEqual([])
  })

  it('answers a stranger as though the event did not exist', async () => {
    const result = await create({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers the owner of another event as though this one did not exist', async () => {
    // The wrong-tenant case: the gala's owner reaching for the wedding.
    const result = await create({ eventId: WEDDING, actorId: STRANGER })
    const theirOwn = await create({ eventId: GALA, actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(theirOwn.ok).toBe(true)
    expect(await world.shareLinks.findCurrent(WEDDING)).toBeNull()
  })

  it('answers an unknown event with event.notFound', async () => {
    const result = await create({ eventId: asEventId('evt-nope') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses to store a link whose digest is not a digest, rather than write the token down', async () => {
    // A signer that "stored" the token itself is the mistake the entity's check exists
    // for; the use case must surface it rather than persist it.
    const leaky: GallerySigner = {
      mintToken: () => ({ token: 'secret-token', digest: 'secret-token' }),
      digestOf: (token) => token,
      sign: () => 'x',
      verify: () => false,
    }

    const result = await create({}, leaky)

    expect(!result.ok && result.error.code).toBe('shareLink.digestInvalid')
    expect(world.shareLinks.all()).toEqual([])
  })
})
