import { beforeEach, describe, expect, it } from 'vitest'
import {
  ARCHIVED,
  FROZEN,
  MODERATOR,
  OWNER,
  PARTY,
  STRANGER,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'

describe('getGuestInvite (spec 29)', () => {
  let scene: GuestInviteScene

  beforeEach(async () => {
    scene = await guestInviteScene()
  })

  it('answers the event and no invitation before the host wrote one, creating nothing', async () => {
    const got = await scene.get({ eventId: WEDDING, actorId: OWNER })

    expect(got.ok && got.value.invite).toBeNull()
    expect(got.ok && got.value.event.id).toBe(WEDDING)
    expect(await scene.invites.findByEvent(WEDDING)).toBeNull()
  })

  it('answers the saved invitation', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })

    const got = await scene.get({ eventId: WEDDING, actorId: OWNER })

    expect(got.ok && got.value.invite?.content.title).toBe('Fête')
  })

  it('still reads an archived event: only the writes are refused', async () => {
    const got = await scene.get({ eventId: ARCHIVED, actorId: OWNER })

    expect(got.ok).toBe(true)
  })

  it('refuses the host of a suspended client, who no longer reads either', async () => {
    const got = await scene.get({ eventId: FROZEN, actorId: OWNER })

    expect(!got.ok && got.error.code).toBe('client.suspended')
  })

  it('refuses an event the operator took down, as an event that is not there', async () => {
    await scene.events.setTakenDown(WEDDING, new Date('2026-11-21T10:00:00Z'))

    const got = await scene.get({ eventId: WEDDING, actorId: OWNER })

    expect(!got.ok && got.error.code).toBe('event.notFound')
  })

  it('is the owner’s: a moderator is told auth.forbidden, a stranger event.notFound', async () => {
    const moderator = await scene.get({ eventId: WEDDING, actorId: MODERATOR })
    const stranger = await scene.get({ eventId: WEDDING, actorId: STRANGER })

    expect(!moderator.ok && moderator.error.code).toBe('auth.forbidden')
    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
  })

  it('is event.notFound for an event that does not exist', async () => {
    const got = await scene.get({ eventId: 'evt-nowhere' as typeof WEDDING, actorId: OWNER })

    expect(!got.ok && got.error.code).toBe('event.notFound')
  })
})
