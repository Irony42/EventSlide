import { beforeEach, describe, expect, it } from 'vitest'
import {
  ARCHIVED,
  CLOSED,
  DRAFT,
  FROZEN,
  GALA,
  MODERATOR,
  OWNER,
  PARTY,
  STRANGER,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'

describe('saveGuestInvite (spec 29)', () => {
  let scene: GuestInviteScene

  beforeEach(async () => {
    scene = await guestInviteScene()
  })

  const lines = async () => (await scene.audit.list({ limit: 10 })).items

  it('creates the invitation on the first save: switched off, with a token and the wall language', async () => {
    const saved = await scene.save({
      eventId: WEDDING,
      actorId: OWNER,
      title: 'Léa fête ses 40 ans',
      ...PARTY,
    })

    expect(saved.ok && saved.value.invite?.enabled).toBe(false)
    expect(saved.ok && saved.value.invite?.token.value).toHaveLength(16)
    expect(saved.ok && saved.value.invite?.content.language).toBe('fr')
    expect((await scene.invites.findByEvent(WEDDING))?.content.title).toBe('Léa fête ses 40 ans')
  })

  it('takes the language the save names on the first save', async () => {
    const saved = await scene.save({ eventId: WEDDING, actorId: OWNER, language: 'de' })

    expect(saved.ok && saved.value.invite?.content.language).toBe('de')
  })

  it('leaves what a later save does not name as it was, and keeps the switch and the token', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    const before = await scene.invites.findByEvent(WEDDING)

    await scene.save({ eventId: WEDDING, actorId: OWNER, message: 'Venez' })

    const after = await scene.invites.findByEvent(WEDDING)
    expect(after?.content).toMatchObject({ title: 'Fête', message: 'Venez' })
    expect(after?.enabled).toBe(true)
    expect(after?.token.value).toBe(before?.token.value)
  })

  it('writes nothing, dates nothing and audits nothing for a save that changes nothing', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    const before = await scene.invites.findByEvent(WEDDING)
    scene.clock.advance(60_000)

    const again = await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête', ...PARTY })
    const empty = await scene.save({ eventId: WEDDING, actorId: OWNER })

    expect(again.ok && again.value.invite).toBe(before)
    expect(empty.ok && empty.value.invite).toBe(before)
    expect((await scene.invites.findByEvent(WEDDING))?.updatedAt).toEqual(before?.updatedAt)
    expect(await lines()).toHaveLength(1)
  })

  it('creates no row for a save with nothing in it: it answers what a read would', async () => {
    const empty = await scene.save({ eventId: WEDDING, actorId: OWNER })

    expect(empty.ok && empty.value.invite).toBeNull()
    expect(await scene.invites.findByEvent(WEDDING)).toBeNull()
    expect(await lines()).toEqual([])
  })

  it('refuses to take the date away from an invitation that is switched on, and writes nothing', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, ...PARTY })
    await scene.enable({ eventId: WEDDING, actorId: OWNER })

    const saved = await scene.save({
      eventId: WEDDING,
      actorId: OWNER,
      startsAt: null,
      timeZone: null,
    })

    expect(!saved.ok && saved.error.code).toBe('guestInvite.needsDate')
    expect((await scene.invites.findByEvent(WEDDING))?.content.startsAt).not.toBeNull()
  })

  it('never puts an older switch or token back over what changed since it was read', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, ...PARTY })
    const racing = await scene.invites.findByEvent(WEDDING)
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.rotate({ eventId: WEDDING, actorId: OWNER })
    const current = await scene.invites.findByEvent(WEDDING)
    // A save that read the row before the two acts above and writes after them.
    const edited = racing?.withContent({ title: 'Après' }, scene.clock.now())
    if (!edited?.ok) throw new Error('edit')
    await scene.invites.saveContent(edited.value)

    const after = await scene.invites.findByEvent(WEDDING)
    expect(after?.enabled).toBe(true)
    expect(after?.token.value).toBe(current?.token.value)
    expect(after?.content.title).toBe('Après')
  })

  it('writes one audit line that says it happened and carries no content', async () => {
    await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Secret', address: '1 rue X' })

    const written = await lines()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      action: 'event.guestInviteSaved',
      subject: { type: 'event', id: WEDDING },
      details: {},
    })
    expect(JSON.stringify(written[0])).not.toContain('Secret')
    expect(JSON.stringify(written[0])).not.toContain('rue X')
  })

  it('refuses an invalid field with its own code, writes nothing and leaves no audit line', async () => {
    const saved = await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'x'.repeat(81) })

    expect(!saved.ok && saved.error.code).toBe('guestInvite.titleTooLong')
    expect(await scene.invites.findByEvent(WEDDING)).toBeNull()
    expect(await lines()).toEqual([])
  })

  it('may edit a draft and a closed event, whose invitation is still the host’s text', async () => {
    for (const eventId of [DRAFT, CLOSED]) {
      const saved = await scene.save({ eventId, actorId: OWNER, title: 'Fête' })
      expect(saved.ok, eventId).toBe(true)
    }
  })

  it('refuses an archived event: it is a record', async () => {
    const saved = await scene.save({ eventId: ARCHIVED, actorId: OWNER, title: 'Fête' })

    expect(!saved.ok && saved.error.code).toBe('guestInvite.eventArchived')
    expect(await scene.invites.findByEvent(ARCHIVED)).toBeNull()
  })

  it('refuses the host of a suspended client: they read, they do not write', async () => {
    const saved = await scene.save({ eventId: FROZEN, actorId: OWNER, title: 'Fête' })

    expect(!saved.ok && saved.error.code).toBe('client.suspended')
  })

  it('is the owner’s: a moderator is told auth.forbidden, a stranger event.notFound', async () => {
    const moderator = await scene.save({ eventId: WEDDING, actorId: MODERATOR, title: 'x' })
    const stranger = await scene.save({ eventId: WEDDING, actorId: STRANGER, title: 'x' })

    expect(!moderator.ok && moderator.error.code).toBe('auth.forbidden')
    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
    expect(await scene.invites.findByEvent(WEDDING)).toBeNull()
  })

  it('cannot reach the invitation of another event', async () => {
    await scene.save({ eventId: GALA, actorId: STRANGER, title: 'Gala' })

    const ours = await scene.save({ eventId: WEDDING, actorId: OWNER, title: 'Mariage' })
    const theirs = await scene.save({ eventId: GALA, actorId: OWNER, title: 'Piraté' })

    expect(ours.ok).toBe(true)
    expect(!theirs.ok && theirs.error.code).toBe('event.notFound')
    expect((await scene.invites.findByEvent(GALA))?.content.title).toBe('Gala')
  })

  it('is event.notFound for an event that does not exist', async () => {
    const saved = await scene.save({
      eventId: 'evt-nowhere' as typeof WEDDING,
      actorId: OWNER,
      title: 'x',
    })

    expect(!saved.ok && saved.error.code).toBe('event.notFound')
  })
})
