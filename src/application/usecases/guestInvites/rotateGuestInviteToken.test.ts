import { beforeEach, describe, expect, it } from 'vitest'
import {
  MODERATOR,
  OWNER,
  PARTY,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'

describe('rotateGuestInviteToken (spec 29)', () => {
  let scene: GuestInviteScene

  beforeEach(async () => {
    scene = await guestInviteScene()
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
  })

  it('mints a new token, and the old link stops answering at once', async () => {
    const oldToken = (await scene.invites.findByEvent(WEDDING))?.token.value
    expect((await scene.view({ token: oldToken })).ok).toBe(true)

    const rotated = await scene.rotate({ eventId: WEDDING, actorId: OWNER })

    const newToken = rotated.ok ? rotated.value.invite?.token.value : undefined
    expect(newToken).toHaveLength(16)
    expect(newToken).not.toBe(oldToken)
    const old = await scene.view({ token: oldToken })
    expect(!old.ok && old.error.code).toBe('guestInvite.notAvailable')
    expect((await scene.view({ token: newToken })).ok).toBe(true)
  })

  it('keeps the switch and the text, and does not touch the join code', async () => {
    const rotated = await scene.rotate({ eventId: WEDDING, actorId: OWNER })

    expect(rotated.ok && rotated.value.invite).toMatchObject({ enabled: true })
    expect(rotated.ok && rotated.value.invite?.content.title).toBe('Fête')
    expect((await scene.events.findById(WEDDING))?.joinCode.value).toBe('H7K2QM')
  })

  it('writes one audit line without content', async () => {
    await scene.rotate({ eventId: WEDDING, actorId: OWNER })

    const written = (await scene.audit.list({ limit: 10 })).items
    expect(written[0]).toMatchObject({ action: 'event.guestInviteRotated', details: {} })
  })

  it('answers guestInvite.notFound when there is nothing to rotate', async () => {
    const fresh = await guestInviteScene()

    const rotated = await fresh.rotate({ eventId: WEDDING, actorId: OWNER })

    expect(!rotated.ok && rotated.error.code).toBe('guestInvite.notFound')
  })

  it('is the owner’s: a moderator is refused', async () => {
    const rotated = await scene.rotate({ eventId: WEDDING, actorId: MODERATOR })

    expect(!rotated.ok && rotated.error.code).toBe('auth.forbidden')
  })
})
