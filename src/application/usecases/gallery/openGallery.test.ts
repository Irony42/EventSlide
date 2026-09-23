import { beforeEach, describe, expect, it } from 'vitest'
import { AT, aPhoto, aUser, atPlus } from '../../testing/builders'
import {
  buildGalleryWorld,
  CO_OWNER,
  MODERATOR,
  OWNER,
  WEDDING,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import { isArchiveGrantSigned, issueUnlock } from './galleryAccess'
import { makeOpenGallery } from './openGallery'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('openGallery', () => {
  let world: GalleryWorld

  const open = (token: string, unlockProof: string | null = null) =>
    makeOpenGallery(world)({ token, unlockProof })

  beforeEach(() => {
    world = buildGalleryWorld()
  })

  it('opens an available link onto its event', async () => {
    const { token, link } = world.seedLink()

    const result = await open(token)

    expect(result.ok && result.value.event.id).toBe(WEDDING)
    expect(result.ok && result.value.link.id).toBe(link.id)
  })

  it('counts only what the wall shows', async () => {
    const { token } = world.seedLink()
    world.photos.seed(
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }),
      aPhoto({ id: 'p2', eventId: WEDDING, status: 'published' }),
      aPhoto({ id: 'p3', eventId: WEDDING, status: 'pending' }),
      aPhoto({ id: 'p4', eventId: WEDDING, status: 'rejected' }),
      aPhoto({ id: 'p5', eventId: WEDDING, status: 'hidden' }),
      aPhoto({ id: 'p6', eventId: 'evt-gala', status: 'published' }),
    )

    const result = await open(token)

    expect(result.ok && result.value.photoCount).toBe(2)
  })

  it('hands out an archive grant signed for this link, good for an hour', async () => {
    const { token, link } = world.seedLink()

    const result = await open(token)
    if (!result.ok) throw new Error('expected the gallery')
    const { archive } = result.value

    expect(archive.linkId).toBe(link.id)
    expect(archive.expiresAt).toEqual(atPlus(HOUR))
    expect(
      isArchiveGrantSigned(
        world.signer,
        { linkId: link.id, expiresAtMs: archive.expiresAt.getTime() },
        archive.signature,
      ),
    ).toBe(true)
  })

  describe('a link that no longer grants anything', () => {
    /**
     * Every way a link dies, and one answer for all of them. A guest holding a dead link
     * learns that it is dead and not why — see `galleryAccess.ts`.
     */
    const scenarios: readonly (readonly [string, (world: GalleryWorld) => Promise<string>])[] = [
      ['a token nobody issued', async () => 'token-never-minted'],
      [
        'a link past its expiry',
        async (w) => {
          const { token } = w.seedLink({ lifetimeDays: 1 })
          w.clock.advance(DAY)
          return token
        },
      ],
      ['a revoked link', async (w) => w.seedLink({ revokedAt: AT }).token],
      [
        'a link whose creator was switched off',
        async (w) => {
          const { token } = w.seedLink()
          await w.users.save(aUser({ id: OWNER, email: 'hote@example.test', disabledAt: AT }))
          return token
        },
      ],
      [
        'a link whose creator is now only a moderator',
        async (w) => {
          const { token } = w.seedLink({ createdBy: CO_OWNER })
          await w.memberships.grant({
            eventId: WEDDING,
            userId: CO_OWNER,
            role: 'moderator',
            grantedAt: AT,
          })
          return token
        },
      ],
      [
        'a link made by somebody who was never an owner',
        async (w) => w.seedLink({ createdBy: MODERATOR }).token,
      ],
      [
        'a link whose creator left the event',
        async (w) => {
          const { token } = w.seedLink({ createdBy: CO_OWNER })
          await w.memberships.revoke(WEDDING, CO_OWNER)
          return token
        },
      ],
      [
        'a link to an event that has been purged',
        async (w) => {
          const { token } = w.seedLink()
          await w.events.delete(WEDDING)
          return token
        },
      ],
    ]

    it.each(scenarios)('answers %s with the one neutral refusal', async (_label, arrange) => {
      const token = await arrange(world)

      const result = await open(token)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect({
        kind: result.error.kind,
        code: result.error.code,
        details: result.error.details,
      }).toEqual({
        kind: 'notFound',
        code: 'gallery.notAvailable',
        details: {},
      })
    })
  })

  describe('a link with a password', () => {
    const PASSWORD = 'hash:les mariés de juin'

    it('asks for the password before it says anything about the album', async () => {
      const { token } = world.seedLink({ passwordHash: PASSWORD })

      const result = await open(token)

      expect(!result.ok && result.error.code).toBe('gallery.passwordRequired')
      expect(!result.ok && result.error.kind).toBe('unauthenticated')
    })

    it('opens with a live unlock for this link', async () => {
      const { token, link } = world.seedLink({ passwordHash: PASSWORD })
      const { proof } = issueUnlock(world.signer, link, world.clock.now())

      expect((await open(token, proof)).ok).toBe(true)
    })

    it('asks again once the unlock has run out', async () => {
      const { token, link } = world.seedLink({ passwordHash: PASSWORD })
      const { proof } = issueUnlock(world.signer, link, world.clock.now())
      world.clock.advance(2 * HOUR)

      expect(!(await open(token, proof)).ok).toBe(true)
    })

    it('does not accept an unlock issued for another link', async () => {
      // A new link replaces the old one; the password typed for the old one must not
      // open the new one, which may have a different password.
      const first = world.seedLink({ id: 'link-a', passwordHash: PASSWORD, revokedAt: AT })
      const second = world.seedLink({ id: 'link-b', passwordHash: PASSWORD })
      const { proof } = issueUnlock(world.signer, first.link, world.clock.now())

      const result = await open(second.token, proof)

      expect(!result.ok && result.error.code).toBe('gallery.passwordRequired')
    })

    it('does not accept an unlock whose expiry was pushed later', async () => {
      const { token, link } = world.seedLink({ passwordHash: PASSWORD })
      const { proof } = issueUnlock(world.signer, link, world.clock.now())
      const signature = proof.slice(proof.indexOf('.') + 1)
      const later = `${atPlus(30 * DAY).getTime()}.${signature}`
      world.clock.advance(3 * HOUR)

      const result = await open(token, later)

      expect(!result.ok && result.error.code).toBe('gallery.passwordRequired')
    })

    it.each([
      ['an empty cookie', ''],
      ['a cookie with no separator', 'abcdef'],
      ['a cookie with no expiry', '.sig-00'],
      ['a cookie that is only an expiry', '9999999999999.'],
    ])('treats %s as no unlock at all', async (_label, proof) => {
      const { token } = world.seedLink({ passwordHash: PASSWORD })

      const result = await open(token, proof)

      expect(!result.ok && result.error.code).toBe('gallery.passwordRequired')
    })

    it('still says not available, rather than asking for a password, once revoked', async () => {
      // The password prompt is only for a link that would open: asking for one on a dead
      // link would tell whoever holds it that it used to be protected.
      const { token } = world.seedLink({ passwordHash: PASSWORD, revokedAt: AT })

      const result = await open(token)

      expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
    })
  })
})
