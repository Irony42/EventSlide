import { beforeEach, describe, expect, it } from 'vitest'
import {
  MODERATOR,
  OWNER,
  PARTY,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'

describe('enableGuestInvite and disableGuestInvite (spec 29)', () => {
  let scene: GuestInviteScene

  beforeEach(async () => {
    scene = await guestInviteScene()
  })

  const lines = async () =>
    (await scene.audit.list({ limit: 10 })).items.map((l) => l.action).reverse()

  it('switches the link on once the invitation has a date', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, ...PARTY })

    const enabled = await scene.enable({ eventId: WEDDING, actorId: OWNER })

    expect(enabled.ok && enabled.value.invite?.enabled).toBe(true)
    expect((await scene.invites.findByEvent(WEDDING))?.enabled).toBe(true)
    expect(await lines()).toEqual(['event.guestInviteSaved', 'event.guestInviteEnabled'])
  })

  it('refuses to switch on an invitation with no date, and writes nothing', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête' })

    const enabled = await scene.enable({ eventId: WEDDING, actorId: OWNER })

    expect(!enabled.ok && enabled.error.code).toBe('guestInvite.needsDate')
    expect((await scene.invites.findByEvent(WEDDING))?.enabled).toBe(false)
  })

  it('refuses to switch on before anything was saved, and creates no row', async () => {
    const enabled = await scene.enable({ eventId: WEDDING, actorId: OWNER })

    expect(!enabled.ok && enabled.error.code).toBe('guestInvite.needsDate')
    expect(await scene.invites.findByEvent(WEDDING)).toBeNull()
    expect(await lines()).toEqual([])
  })

  it('treats a second tap as no act: no write, no audit line', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, ...PARTY })
    await scene.enable({ eventId: WEDDING, actorId: OWNER })

    const again = await scene.enable({ eventId: WEDDING, actorId: OWNER })

    expect(again.ok && again.value.invite?.enabled).toBe(true)
    expect(await lines()).toEqual(['event.guestInviteSaved', 'event.guestInviteEnabled'])
  })

  it('switches off and keeps the text and the token, so the same link comes back', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    const token = (await scene.invites.findByEvent(WEDDING))?.token.value

    const disabled = await scene.disable({ eventId: WEDDING, actorId: OWNER })
    const back = await scene.enable({ eventId: WEDDING, actorId: OWNER })

    expect(disabled.ok && disabled.value.invite?.enabled).toBe(false)
    expect(disabled.ok && disabled.value.invite?.content.title).toBe('Fête')
    expect(back.ok && back.value.invite?.token.value).toBe(token)
    expect(await lines()).toEqual([
      'event.guestInviteSaved',
      'event.guestInviteEnabled',
      'event.guestInviteDisabled',
      'event.guestInviteEnabled',
    ])
  })

  it('treats switching off what is already off as no act', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, ...PARTY })

    const disabled = await scene.disable({ eventId: WEDDING, actorId: OWNER })

    expect(disabled.ok && disabled.value.invite?.enabled).toBe(false)
    expect(await lines()).toEqual(['event.guestInviteSaved'])
  })

  it('answers guestInvite.notFound when there is nothing to switch off', async () => {
    const disabled = await scene.disable({ eventId: WEDDING, actorId: OWNER })

    expect(!disabled.ok && disabled.error.code).toBe('guestInvite.notFound')
  })

  it('is the owner’s: a moderator is refused both ways', async () => {
    const on = await scene.enable({ eventId: WEDDING, actorId: MODERATOR })
    const off = await scene.disable({ eventId: WEDDING, actorId: MODERATOR })

    expect(!on.ok && on.error.code).toBe('auth.forbidden')
    expect(!off.ok && off.error.code).toBe('auth.forbidden')
  })
})
