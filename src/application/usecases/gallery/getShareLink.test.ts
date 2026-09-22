import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aUser } from '../../testing/builders'
import {
  buildGalleryWorld,
  CO_OWNER,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import { makeGetShareLink } from './getShareLink'

const DAY = 24 * 60 * 60 * 1000

describe('getShareLink', () => {
  let world: GalleryWorld

  const get = (actorId = OWNER, eventId = WEDDING) => makeGetShareLink(world)({ eventId, actorId })

  beforeEach(() => {
    world = buildGalleryWorld()
  })

  it('answers null for an event that has never had a link', async () => {
    expect(await get()).toEqual({ ok: true, value: null })
  })

  it('answers the current link, and that it opens', async () => {
    const { link } = world.seedLink()

    const result = await get()

    expect(result.ok && result.value?.link.id).toBe(link.id)
    expect(result.ok && result.value?.available).toBe(true)
  })

  it('still answers an expired link, and says it no longer opens', async () => {
    world.seedLink({ lifetimeDays: 1 })
    world.clock.advance(2 * DAY)

    const result = await get()

    expect(result.ok && result.value?.available).toBe(false)
  })

  it('says a link made by a co-owner who was since switched off opens nothing', async () => {
    // The case a host cannot see from the dates, and the reason `available` exists.
    world.seedLink({ createdBy: CO_OWNER })
    await world.users.save(aUser({ id: CO_OWNER, email: 'co-hote@example.test', disabledAt: AT }))

    const result = await get()

    expect(result.ok && result.value?.available).toBe(false)
  })

  it('answers nothing for a revoked link, which is not current any more', async () => {
    world.seedLink({ revokedAt: AT })

    expect(await get()).toEqual({ ok: true, value: null })
  })

  it('refuses a moderator', async () => {
    const result = await get(MODERATOR)

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
  })

  it('answers a stranger as though the event did not exist', async () => {
    world.seedLink()

    const result = await get(STRANGER)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers an unknown event with event.notFound', async () => {
    const result = await get(OWNER, asEventId('evt-nope'))

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
