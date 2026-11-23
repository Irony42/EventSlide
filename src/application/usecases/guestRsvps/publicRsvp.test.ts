import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { MAX_RSVPS_PER_EVENT } from '../../../domain/guestRsvps/rsvpLimits'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asGuestRsvpId } from '../../../domain/shared/ids'
import { aGuestInvite, anEvent } from '../../testing/builders'
import { GALA, OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'

/**
 * The guests' side of the replies (spec 30): answer on the invitation's page, read, change and
 * delete one's own reply with the token given, and what the page says about answering.
 *
 * The one refusal for a link that cannot be served comes first, then the window, then the token.
 */

const ANSWER = { name: 'Léa Martin', answer: 'yes', adults: 2, kids: 1, diet: 'sans gluten' }

describe('the guests replies, on the guest’s side (spec 30)', () => {
  let scene: RsvpScene
  let token: string
  /** The signals the scene's own set-up sent: not this test's. */
  let setupSignals = 0

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    token = await scene.token()
    setupSignals = scene.bus.published.length
  })

  const signals = () =>
    scene.bus.published.slice(setupSignals).filter((event) => event.type === 'rsvp.changed')
  const submit = (overrides: Record<string, unknown> = {}) =>
    scene.submit({ token, ...ANSWER, ...overrides })
  const code = (result: { ok: boolean; error?: { code: string } }) =>
    result.ok ? undefined : result.error?.code

  describe('submitRsvp', () => {
    it('stores the reply as an open one and hands back the token once, keeping only its digest', async () => {
      const sent = await submit({ message: 'À samedi' })

      expect(sent.ok && sent.value.rsvp.toProps()).toMatchObject({
        eventId: WEDDING,
        name: 'Léa Martin',
        answer: 'yes',
        adults: 2,
        kids: 1,
        diet: 'sans gluten',
        message: 'À samedi',
        source: 'open',
        householdId: null,
      })
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored).toHaveLength(1)
      expect(sent.ok && sent.value.editToken).toBe('secret-1')
      expect(stored[0]?.editTokenHash).toBe(scene.secrets.digestOf('secret-1'))
      expect(JSON.stringify(stored[0]?.toProps())).not.toContain('secret-1')
    })

    it('announces the change without any content, and audits nothing', async () => {
      await submit({ name: 'Secret', diet: 'noix' })

      expect(signals()).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
      const lines = (await scene.audit.list({ limit: 50 })).items.map((line) => line.action)
      expect(lines.filter((action) => action.startsWith('event.rsvp'))).toEqual([
        'event.rsvpFormSaved',
      ])
    })

    it('judges the reply with the form of the moment', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { maybe: false } })
      const announced = signals().length

      const maybe = await submit({ answer: 'maybe' })
      const waitlist = await submit({ answer: 'waitlist' })
      const nameless = await submit({ name: '' })

      expect(code(maybe)).toBe('rsvp.maybeNotOffered')
      expect(code(waitlist)).toBe('rsvp.answerInvalid')
      expect(code(nameless)).toBe('rsvp.nameEmpty')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(signals()).toHaveLength(announced)
    })

    it('is refused 409 rsvp.off while replies are not asked, and 409 rsvp.closed once they stopped', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: false })
      const off = await submit()
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
      await scene.close({ eventId: WEDDING, actorId: OWNER })
      const closed = await submit()

      expect([code(off), code(closed)]).toEqual(['rsvp.off', 'rsvp.closed'])
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('closes by itself at the end of the deadline day, in the invitation’s zone', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, deadline: '2026-07-01' })
      scene.clock.set(new Date('2026-07-01T21:59:00Z'))
      const before = await submit()
      scene.clock.set(new Date('2026-07-01T22:00:00Z'))
      const after = await submit()

      expect([before.ok, code(after)]).toEqual([true, 'rsvp.closed'])
    })

    it('answers the one neutral 404 for a link that cannot be served, whatever the cause', async () => {
      const unknown = await scene.submit({ token: 'ZZZZZZZZZZZZZZZZ', ...ANSWER })
      const malformed = await scene.submit({ token: 'pas un jeton', ...ANSWER })
      const notText = await scene.submit({ token: 42, ...ANSWER })
      await scene.disable({ eventId: WEDDING, actorId: OWNER })
      const disabled = await submit()
      await scene.enable({ eventId: WEDDING, actorId: OWNER })
      await scene.events.setTakenDown(WEDDING, scene.clock.now())
      const takenDown = await submit()

      for (const refused of [unknown, malformed, notText, disabled, takenDown]) {
        expect(code(refused)).toBe('guestInvite.notAvailable')
      }
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('stops at a thousand replies: 409 rsvp.tooMany, and nothing announced', async () => {
      for (let i = 0; i < MAX_RSVPS_PER_EVENT; i += 1) {
        scene.rsvps.seed(aRsvp({ id: `seed-${i}`, eventId: WEDDING, answer: 'no' }))
      }

      const refused = await submit()

      expect(code(refused)).toBe('rsvp.tooMany')
      expect(signals()).toEqual([])
    })

    it('says rsvp.full when the places are taken', async () => {
      scene.rsvps.admit = async () => ({ kind: 'refused', refusal: 'full' })

      expect(code(await submit())).toBe('rsvp.full')
    })

    it.each([
      [
        'a window that is closed',
        async () => scene.close({ eventId: WEDDING, actorId: OWNER }),
        'rsvp.closed',
      ],
      [
        'replies that are not asked',
        async () => scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: false }),
        'rsvp.off',
      ],
    ])(
      'gives the honeypot the refusal of %s, like a real reply',
      async (_name, arrange, expected) => {
        await arrange()

        const real = await submit()
        const trapped = await submit({ website: 'https://spam.example' })

        expect([code(real), code(trapped)]).toEqual([expected, expected])
        expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      },
    )

    it('gives the honeypot the thousand-reply refusal too, and counts without writing', async () => {
      for (let i = 0; i < MAX_RSVPS_PER_EVENT; i += 1) {
        scene.rsvps.seed(aRsvp({ id: `seed-${i}`, eventId: WEDDING, answer: 'no' }))
      }

      const trapped = await submit({ website: 'x' })

      expect(code(trapped)).toBe('rsvp.tooMany')
      expect(await scene.rsvps.count(WEDDING)).toBe(MAX_RSVPS_PER_EVENT)
    })

    it('gives the honeypot the places refusal too, from the people already coming', async () => {
      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        form: { ...DEFAULT_RSVP_FORM, capacity: 3 },
      })
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING, adults: 3 }))
      // The window itself is "full", which still takes a reply to the repository.

      const real = await submit({ adults: 1, kids: 0 })
      const trapped = await submit({ adults: 1, kids: 0, website: 'x' })

      expect([code(real), code(trapped)]).toEqual(['rsvp.full', 'rsvp.full'])
    })

    it('hands a script that fills the honeypot the same 201 and a token that opens nothing', async () => {
      const trapped = await submit({ website: 'https://spam.example' })

      expect(trapped.ok && trapped.value.rsvp.name).toBe('Léa Martin')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(signals()).toEqual([])
      const reopened = await scene.getOwn({
        token,
        editToken: trapped.ok ? trapped.value.editToken : '',
      })
      expect(code(reopened)).toBe('rsvp.notFound')
    })

    it('judges the trapped reply like a real one, so the refusals do not give the trap away, and an empty field is no trap', async () => {
      const refused = await submit({ website: 'x', name: '' })
      const person = await submit({ website: '' })
      const typed = await submit({ website: 12 })

      expect(code(refused)).toBe('rsvp.nameEmpty')
      expect(person.ok).toBe(true)
      expect(typed.ok).toBe(true)
      expect(await scene.rsvps.listByEvent(WEDDING)).toHaveLength(2)
    })

    it('trusts nothing a script adds: the ids, the source and the token are the server’s', async () => {
      const sent = await submit({
        source: 'host',
        id: 'mine',
        editTokenHash: 'x',
        householdId: 'h',
      })

      expect(sent.ok && sent.value.rsvp.toProps()).toMatchObject({
        source: 'open',
        householdId: null,
      })
      expect(sent.ok && sent.value.rsvp.id).not.toBe('mine')
    })
  })

  describe('getOwnRsvp', () => {
    it('gives a guest their own reply back, with the token they hold', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''

      const read = await scene.getOwn({ token, editToken })

      expect(read.ok && read.value.name).toBe('Léa Martin')
    })

    it.each([
      ['an unknown token', 'nope'],
      ['no token', undefined],
      ['an empty token', ''],
      ['a token that is not text', 42],
      ['a token far too long to be one', 'a'.repeat(500)],
    ])('answers 404 rsvp.notFound for %s', async (_name, editToken) => {
      await submit()

      expect(code(await scene.getOwn({ token, editToken }))).toBe('rsvp.notFound')
    })

    it('does not even hash a token that is too long to be one', async () => {
      await submit()
      const digest = vi.spyOn(scene.secrets, 'digestOf')

      await scene.getOwn({ token, editToken: 'a'.repeat(500) })

      expect(digest).not.toHaveBeenCalled()
    })

    it('does not open another event’s reply with its token: the token is bound to the event', async () => {
      scene.rsvps.seed(
        aRsvp({
          id: 'r-gala',
          eventId: GALA,
          editTokenHash: scene.secrets.digestOf('secret-gala'),
        }),
      )

      expect(code(await scene.getOwn({ token, editToken: 'secret-gala' }))).toBe('rsvp.notFound')
    })

    it('does not trust a repository that matched loosely', async () => {
      const sent = await submit()
      scene.rsvps.findByEditTokenHash = async () =>
        (await scene.rsvps.listByEvent(WEDDING))[0] ?? null

      expect(sent.ok).toBe(true)
      expect(code(await scene.getOwn({ token, editToken: 'almost' }))).toBe('rsvp.notFound')
    })

    it('does not open a reply the host typed: it has no token', async () => {
      scene.rsvps.seed(
        aRsvp({ id: 'r-host', eventId: WEDDING, source: 'host', editTokenHash: null }),
      )
      scene.rsvps.findByEditTokenHash = async () =>
        (await scene.rsvps.listByEvent(WEDDING))[0] ?? null

      expect(code(await scene.getOwn({ token, editToken: 'anything' }))).toBe('rsvp.notFound')
    })

    it('stays readable when the window is closed and once the party is over, and stops with the invitation', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      await scene.close({ eventId: WEDDING, actorId: OWNER })
      const closed = await scene.getOwn({ token, editToken })
      scene.events.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: 'camille-et-sacha',
          joinCode: 'H7K2QM',
          status: 'closed',
        }),
      )
      const over = await scene.getOwn({ token, editToken })
      const afterOver = await scene.deleteOwn({ token, editToken: 'nope' })
      await scene.disable({ eventId: WEDDING, actorId: OWNER })
      const disabled = await scene.getOwn({ token, editToken })

      expect(closed.ok).toBe(true)
      expect(over.ok).toBe(true)
      expect(afterOver.ok).toBe(true)
      expect(code(disabled)).toBe('guestInvite.notAvailable')
    })
  })

  describe('updateOwnRsvp', () => {
    it('changes the reply, keeps its identity, and announces it', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      scene.clock.advance(60_000)

      const changed = await scene.updateOwn({
        token,
        editToken,
        name: 'Léa M.',
        answer: 'no',
      })

      expect(changed.ok && changed.value.toProps()).toMatchObject({
        name: 'Léa M.',
        answer: 'no',
        adults: 0,
        source: 'open',
        updatedAt: scene.clock.now(),
      })
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored).toHaveLength(1)
      expect(stored[0]?.editTokenHash).toBe(scene.secrets.digestOf(editToken ?? ''))
      expect(signals()).toHaveLength(2)
    })

    it('is refused once the window is closed, even with the right token, and changes nothing', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      await scene.close({ eventId: WEDDING, actorId: OWNER })

      const refused = await scene.updateOwn({ token, editToken, name: 'Autre', answer: 'yes' })

      expect(code(refused)).toBe('rsvp.closed')
      expect((await scene.rsvps.listByEvent(WEDDING))[0]?.name).toBe('Léa Martin')
    })

    it('judges the change with the form of the moment, and refuses a wrong token', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''

      const invalid = await scene.updateOwn({ token, editToken, name: '', answer: 'yes' })
      const wrong = await scene.updateOwn({ token, editToken: 'nope', name: 'A', answer: 'yes' })

      expect(code(invalid)).toBe('rsvp.nameEmpty')
      expect(code(wrong)).toBe('rsvp.notFound')
    })

    it('does not bring back a reply that was deleted a moment earlier: 404, and still nothing stored', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      const find = scene.rsvps.findByEditTokenHash.bind(scene.rsvps)
      // The reply is found, then deleted (the guest's other tab, the host) before the write lands.
      scene.rsvps.findByEditTokenHash = async (eventId, hash) => {
        const found = await find(eventId, hash)
        if (found !== null) await scene.rsvps.delete(eventId, found.id)
        return found
      }

      const refused = await scene.updateOwn({
        token,
        editToken,
        name: 'Revenu',
        answer: 'yes',
        adults: 1,
      })

      expect(code(refused)).toBe('rsvp.notFound')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('says rsvp.full or rsvp.tooMany when the repository refuses the change', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      const change = () =>
        scene.updateOwn({ token, editToken, name: 'A', answer: 'yes', adults: 1 })

      scene.rsvps.admit = async () => ({ kind: 'refused', refusal: 'full' })
      const full = await change()
      scene.rsvps.admit = async () => ({ kind: 'refused', refusal: 'tooMany' })
      const many = await change()

      expect([code(full), code(many)]).toEqual(['rsvp.full', 'rsvp.tooMany'])
    })
  })

  describe('deleteOwnRsvp', () => {
    it('deletes the reply, announces it, and a second delete is the same wish already done', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''

      const first = await scene.deleteOwn({ token, editToken })
      const second = await scene.deleteOwn({ token, editToken })

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(signals()).toHaveLength(2)
    })

    it('is allowed when the window is closed: the right to erase does not end with it', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      await scene.close({ eventId: WEDDING, actorId: OWNER })

      expect((await scene.deleteOwn({ token, editToken })).ok).toBe(true)
    })

    it('answers a wrong token as it answers a reply already gone, and the neutral 404 for a link that cannot be served', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''

      const wrong = await scene.deleteOwn({ token, editToken: 'nope' })
      const unknown = await scene.deleteOwn({ token: 'ZZZZZZZZZZZZZZZZ', editToken })

      expect([wrong.ok, code(unknown)]).toEqual([true, 'guestInvite.notAvailable'])
      expect(await scene.rsvps.listByEvent(WEDDING)).toHaveLength(1)
    })

    it('says nothing more when the reply went between the read and the delete: still done, no signal', async () => {
      const sent = await submit()
      const editToken = sent.ok ? sent.value.editToken : ''
      scene.rsvps.delete = async () => false
      const before = signals().length

      const refused = await scene.deleteOwn({ token, editToken })

      expect(refused.ok).toBe(true)
      expect(signals()).toHaveLength(before)
    })
  })

  describe('the hot paths read figures, never every reply', () => {
    it('shows the page with who comes, and takes a reply under limited places, without reading a single reply', async () => {
      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        form: { ...DEFAULT_RSVP_FORM, visibility: 'names', capacity: 50 },
      })
      scene.rsvps.seed(
        aRsvp({ id: 'a', eventId: WEDDING, name: 'Léa Martin', details: { showName: true } }),
      )
      scene.rsvps.listByEvent = async () => {
        throw new Error('every reply was read: its diet and its word with it')
      }

      const page = await scene.view({ token })
      const sent = await submit()
      const own = await scene.getOwn({ token, editToken: sent.ok ? sent.value.editToken : '' })

      expect(page.ok && page.value.rsvp.proof).toEqual({ count: 1, names: ['Léa'] })
      expect(sent.ok).toBe(true)
      expect(own.ok).toBe(true)
    })
  })

  describe('the edges of the door', () => {
    it('answers the neutral 404 for an invitation whose event is gone', async () => {
      scene.invites.seed(
        aGuestInvite({
          eventId: 'evt-ghost',
          tokenByte: 9,
          enabled: true,
          startsAt: '2099-12-13T18:00:00Z',
          timeZone: 'Europe/Paris',
        }),
      )
      const ghost = '9999999999999999'

      const sent = await scene.submit({ token: ghost, ...ANSWER })
      const read = await scene.getOwn({ token: ghost, editToken: 'x' })
      const page = await scene.view({ token: ghost })

      expect([code(sent), code(read), code(page)]).toEqual(
        Array(3).fill('guestInvite.notAvailable'),
      )
    })

    it('reads a settings row that vanished meanwhile as replies not asked', async () => {
      scene.invites.findRsvpSettings = async () => null

      const sent = await submit()
      const page = await scene.view({ token })

      expect(code(sent)).toBe('rsvp.off')
      expect(page.ok && page.value.rsvp.state).toBe('off')
    })

    it('says full once the people coming reach the places, still takes a reply to the repository, which refuses it', async () => {
      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        form: { ...DEFAULT_RSVP_FORM, capacity: 3 },
      })
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING, adults: 3 }))

      const page = await scene.view({ token })
      const sent = await submit({ adults: 1, kids: 0 })

      expect(page.ok && page.value.rsvp.state).toBe('full')
      expect(code(sent)).toBe('rsvp.full')
    })

    it('stays open while the places are not all taken', async () => {
      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        form: { ...DEFAULT_RSVP_FORM, capacity: 10 },
      })
      scene.rsvps.seed(
        aRsvp({ id: 'a', eventId: WEDDING, adults: 3 }),
        aRsvp({ id: 'b', eventId: WEDDING, answer: 'maybe', adults: 5 }),
      )

      const page = await scene.view({ token })

      expect(page.ok && page.value.rsvp.state).toBe('open')
    })
  })

  describe('what the page says about answering (viewGuestInvite)', () => {
    const page = async () => {
      const viewed = await scene.view({ token })
      if (!viewed.ok) throw new Error('the page is not served')
      return viewed.value.rsvp
    }

    it('says off until the host asks, then open with the form the guest must see', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: false })
      const off = await page()
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        enabled: true,
        deadline: '2026-12-01',
        form: { maybe: false, partySize: { max: 6 } },
      })

      const open = await page()

      expect(off.state).toBe('off')
      expect(open).toEqual({
        state: 'open',
        deadline: '2026-12-01',
        form: {
          maybe: false,
          partySize: { enabled: true, max: 6 },
          kidsSeparate: true,
          diet: true,
          companionNames: false,
          meals: { enabled: false, options: [] },
          questions: [],
          visibility: 'off',
          moments: [],
        },
        proof: null,
      })
    })

    it('says closed once the host closed it or the day passed, and never carries the closing instant', async () => {
      await scene.close({ eventId: WEDDING, actorId: OWNER })

      const closed = await page()

      expect(closed.state).toBe('closed')
      expect(JSON.stringify(closed)).not.toContain('closedAt')
    })

    it('shows nothing about who comes unless the host chose to, and never a no, a maybe, a message or a diet', async () => {
      scene.rsvps.seed(
        aRsvp({
          id: 'a',
          eventId: WEDDING,
          name: 'Léa Martin',
          adults: 2,
          diet: 'noix',
          details: { showName: true },
        }),
        aRsvp({ id: 'b', eventId: WEDDING, name: 'Hugo Roux', details: { showName: false } }),
        aRsvp({
          id: 'c',
          eventId: WEDDING,
          name: 'Inès Lab',
          answer: 'maybe',
          details: { showName: true },
        }),
        aRsvp({
          id: 'd',
          eventId: WEDDING,
          name: 'Tom Non',
          answer: 'no',
          details: { showName: true },
        }),
      )
      expect((await page()).proof).toBeNull()

      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        form: { ...DEFAULT_RSVP_FORM, visibility: 'names' },
      })

      const proof = (await page()).proof
      expect(proof).toEqual({ count: 3, names: ['Léa'] })
      expect(JSON.stringify(proof)).not.toMatch(/noix|Hugo|Inès|Tom/)
    })

    it('shows only the number when the host chose to count', async () => {
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING, adults: 2, details: { showName: true } }))
      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        form: { ...DEFAULT_RSVP_FORM, visibility: 'count' },
      })

      expect((await page()).proof).toEqual({ count: 2, names: [] })
    })

    it('shows no proof once nothing is asked', async () => {
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING }))
      const settings = await scene.invites.findRsvpSettings(WEDDING)
      await scene.invites.saveRsvpSettings(WEDDING, {
        ...(settings ?? { enabled: true, deadline: null, closedAt: null, form: DEFAULT_RSVP_FORM }),
        enabled: false,
        form: { ...DEFAULT_RSVP_FORM, visibility: 'count' },
      })

      expect((await page()).proof).toBeNull()
    })
  })

  it('reads the same reply under another event’s invitation as no reply at all', async () => {
    scene.rsvps.seed(aRsvp({ id: asGuestRsvpId('r-1'), eventId: GALA }))

    expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
  })
})
