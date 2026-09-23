import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId } from '../../../domain/shared/ids'
import { atPlus } from '../../testing/builders'
import {
  buildGalleryWorld,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import { makeOpenGallery } from './openGallery'
import { makeRevokeShareLink } from './revokeShareLink'

const HOUR = 60 * 60 * 1000

describe('revokeShareLink', () => {
  let world: GalleryWorld

  const revoke = (actorId = OWNER, eventId = WEDDING) =>
    makeRevokeShareLink(world)({ eventId, actorId })

  beforeEach(() => {
    world = buildGalleryWorld()
  })

  it('shuts the link at once: the next open answers not available', async () => {
    const { token } = world.seedLink()
    world.clock.advance(HOUR)

    const result = await revoke()

    expect(result.ok).toBe(true)
    expect(await world.shareLinks.findCurrent(WEDDING)).toBeNull()
    expect(world.shareLinks.all()[0]?.revokedAt).toEqual(atPlus(HOUR))
    const opened = await makeOpenGallery(world)({ token, unlockProof: null })
    expect(!opened.ok && opened.error.code).toBe('gallery.notAvailable')
  })

  it('succeeds when there is nothing to revoke, so a second press is not an error', async () => {
    expect((await revoke()).ok).toBe(true)
  })

  it('leaves another event’s link alone', async () => {
    world.seedLink({ id: 'gala-link', eventId: GALA, createdBy: STRANGER })

    await revoke()

    expect((await world.shareLinks.findCurrent(GALA))?.id).toBe('gala-link')
  })

  it('refuses a moderator, and the link stays open', async () => {
    world.seedLink()

    const result = await revoke(MODERATOR)

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect(await world.shareLinks.findCurrent(WEDDING)).not.toBeNull()
  })

  it('answers the owner of another event as though this one did not exist', async () => {
    world.seedLink()

    const result = await revoke(STRANGER)

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(await world.shareLinks.findCurrent(WEDDING)).not.toBeNull()
  })

  it('answers an unknown event with event.notFound', async () => {
    const result = await revoke(OWNER, asEventId('evt-nope'))

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
