import { beforeEach, describe, expect, it } from 'vitest'
import { AT, atPlus } from '../../testing/builders'
import { buildGalleryWorld, type GalleryWorld } from '../../testing/galleryWorld'
import { makeOpenGallery } from './openGallery'
import { makeUnlockGallery } from './unlockGallery'

const HOUR = 60 * 60 * 1000
const PASSWORD = 'les mariés de juin'

describe('unlockGallery', () => {
  let world: GalleryWorld

  const unlock = (token: string, password: string) => makeUnlockGallery(world)({ token, password })

  beforeEach(() => {
    world = buildGalleryWorld()
  })

  it('answers a proof that opens the gallery, for the right password', async () => {
    const { token } = world.seedLink({ passwordHash: `hash:${PASSWORD}` })

    const result = await unlock(token, PASSWORD)
    if (!result.ok) throw new Error(`expected a proof, got ${result.error.code}`)

    expect(result.value.expiresAt).toEqual(atPlus(2 * HOUR))
    expect((await makeOpenGallery(world)({ token, unlockProof: result.value.proof })).ok).toBe(true)
  })

  it('never lets the proof outlive the link', async () => {
    const { token, link } = world.seedLink({
      passwordHash: `hash:${PASSWORD}`,
      lifetimeDays: 1,
      createdAt: new Date(AT.getTime() - 24 * HOUR + HOUR / 2),
    })

    const result = await unlock(token, PASSWORD)

    expect(result.ok && result.value.expiresAt).toEqual(link.expiresAt)
  })

  it('carries neither the password nor the token in the proof', async () => {
    const { token } = world.seedLink({ passwordHash: `hash:${PASSWORD}` })

    const result = await unlock(token, PASSWORD)

    expect(result.ok && result.value.proof).not.toContain(PASSWORD)
    expect(result.ok && result.value.proof).not.toContain(token)
  })

  it('refuses the wrong password', async () => {
    const { token } = world.seedLink({ passwordHash: `hash:${PASSWORD}` })

    const result = await unlock(token, 'les mariés de juillet')

    expect(!result.ok && result.error.code).toBe('gallery.wrongPassword')
    expect(!result.ok && result.error.kind).toBe('unauthenticated')
  })

  it('refuses a dead link before comparing any password', async () => {
    // A dead token costs a lookup and not a bcrypt comparison, so it cannot be used to
    // make the box spend CPU — and it answers exactly what the gallery itself answers.
    const { token } = world.seedLink({ passwordHash: `hash:${PASSWORD}`, revokedAt: AT })

    const result = await unlock(token, PASSWORD)

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
    expect(world.hasher.verifications).toEqual([])
  })

  it('refuses a token nobody issued', async () => {
    const result = await unlock('token-never-minted', PASSWORD)

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
    expect(world.hasher.verifications).toEqual([])
  })

  it('answers a proof for a link with no password, without comparing anything', async () => {
    const { token } = world.seedLink()

    const result = await unlock(token, 'anything')

    expect(result.ok).toBe(true)
    expect(world.hasher.verifications).toEqual([])
  })
})
