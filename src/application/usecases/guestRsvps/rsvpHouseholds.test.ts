import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_HOUSEHOLDS_PER_EVENT } from '../../../domain/guestRsvps/household'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId, asGuestHouseholdId, asGuestRsvpId } from '../../../domain/shared/ids'
import { aGuestInvite, anEvent } from '../../testing/builders'
import {
  ARCHIVED,
  FROZEN,
  GALA,
  MODERATOR,
  OWNER,
  PARTY,
  STRANGER,
  WEDDING,
  rsvpScene,
  type RsvpScene,
} from '../../testing/rsvpScene'

/**
 * The guest list on the host's side (spec 30, lot 3): listing, adding, changing, pasting and
 * deleting households, their links, the host's own "relancé" note, and filing a reply under one.
 * The owner's door as the replies have it; every act names its event; no household is another
 * event's; nothing audited carries a name.
 */

const H1 = asGuestHouseholdId('household-1')
const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('the guest list, on the host’s side (spec 30, lot 3)', () => {
  let scene: RsvpScene

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
  })

  const act = async () =>
    (await scene.audit.list({ limit: 50 })).items
      .map((line) => line.action)
      .filter((action) => !action.startsWith('event.guestInvite'))
      .reverse()
  const signals = () => scene.bus.published.filter((event) => event.type === 'rsvp.changed')
  const add = (overrides: Record<string, unknown> = {}) =>
    scene.saveHousehold({
      eventId: WEDDING,
      actorId: OWNER,
      name: 'Famille Martin',
      places: 4,
      ...overrides,
    })
  const list = async () => {
    const listed = await scene.listHouseholds({ eventId: WEDDING, actorId: OWNER })
    if (!listed.ok) throw new Error(listed.error.code)
    return listed.value
  }

  describe('saveHousehold, to add one', () => {
    it('stores a household with a link of its own and no reply, and announces it', async () => {
      const added = await add()

      expect(added.ok && added.value.reply).toBeNull()
      expect(added.ok && added.value.household.toProps()).toMatchObject({
        id: 'household-1',
        eventId: WEDDING,
        name: 'Famille Martin',
        places: 4,
        remindedAt: null,
        createdAt: scene.clock.now(),
      })
      expect(added.ok && added.value.household.token.value).toHaveLength(16)
      expect(await scene.households.listByEvent(WEDDING)).toHaveLength(1)
      expect(signals()).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
    })

    it('gives every household a different link', async () => {
      const first = await add()
      const second = await add({ name: 'Les Durand' })

      expect(first.ok && second.ok && first.value.household.token.value).not.toBe(
        second.ok && second.value.household.token.value,
      )
    })

    it('judges the name and the places, and writes and announces nothing on a refusal', async () => {
      const nameless = await add({ name: '  ' })
      const heavy = await add({ places: 11 })

      expect(code(nameless)).toBe('household.nameEmpty')
      expect(code(heavy)).toBe('household.placesInvalid')
      expect(await scene.households.listByEvent(WEDDING)).toEqual([])
      expect(signals()).toEqual([])
    })

    it('needs the invitation, as there is no link to give without one', async () => {
      const bare = await rsvpScene({ invited: false })

      const refused = await bare.saveHousehold({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Martin',
        places: 2,
      })

      expect(code(refused)).toBe('rsvp.inviteRequired')
    })

    it('refuses the 501st household of an event, and is not held back by another event’s list', async () => {
      scene.households.seed(
        ...Array.from({ length: MAX_HOUSEHOLDS_PER_EVENT }, (_, i) =>
          aHousehold({ id: `h-${i}`, eventId: WEDDING, token: `T${String(i).padStart(15, '0')}` }),
        ),
      )

      const refused = await add()

      expect(code(refused)).toBe('household.tooMany')
      expect(signals()).toEqual([])
    })
  })

  describe('saveHousehold, to change one', () => {
    it('changes the name and places and keeps the link, the note and the reply', async () => {
      await add()
      await scene.markHouseholdReminded({ eventId: WEDDING, actorId: OWNER, householdId: H1 })
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING, householdId: 'household-1' }))
      const before = (await list())[0]
      scene.clock.advance(1_000)

      const changed = await add({ householdId: H1, name: 'Les Martin', places: 2 })

      expect(changed.ok && changed.value.household).toMatchObject({
        name: 'Les Martin',
        places: 2,
        updatedAt: scene.clock.now(),
      })
      expect(changed.ok && changed.value.household.token.value).toBe(before?.household.token.value)
      expect(changed.ok && changed.value.household.remindedAt).toEqual(before?.household.remindedAt)
      expect(changed.ok && changed.value.reply?.id).toBe('r-1')
      expect((await scene.rsvps.findById(WEDDING, asGuestRsvpId('r-1')))?.adults).toBe(1)
    })

    it('finds nothing for a household that is another event’s, or gone', async () => {
      scene.households.seed(aHousehold({ id: 'h-gala', eventId: GALA }))

      const foreign = await add({ householdId: asGuestHouseholdId('h-gala') })
      const gone = await add({ householdId: asGuestHouseholdId('nope') })

      expect(code(foreign)).toBe('household.notFound')
      expect(code(gone)).toBe('household.notFound')
      expect((await scene.households.listByEvent(GALA))[0]?.name).toBe('Famille Martin')
    })

    it('says nothing when the household went between the read and the write', async () => {
      await add()
      const signalsBefore = signals().length
      scene.households.update = async () => false

      const refused = await add({ householdId: H1, name: 'Autre' })

      expect(code(refused)).toBe('household.notFound')
      expect(signals()).toHaveLength(signalsBefore)
    })

    it('judges the new values before touching anything', async () => {
      await add()

      const refused = await add({ householdId: H1, places: 0 })

      expect(code(refused)).toBe('household.placesInvalid')
      expect((await list())[0]?.household.places).toBe(4)
    })
  })

  describe('importHouseholds', () => {
    const paste = (text: unknown) =>
      scene.importHouseholds({ eventId: WEDDING, actorId: OWNER, text })

    it('stores one household per line, in the paste’s order, each with its own link', async () => {
      const imported = await paste('Famille Martin ; 4\nLéa Durand ; 2\nHugo')

      expect(imported.ok && imported.value.households.map((h) => [h.name, h.places])).toEqual([
        ['Famille Martin', 4],
        ['Léa Durand', 2],
        ['Hugo', 1],
      ])
      expect((await list()).map((entry) => entry.household.name)).toEqual([
        'Famille Martin',
        'Léa Durand',
        'Hugo',
      ])
      const tokens = new Set((await list()).map((entry) => entry.household.token.value))
      expect(tokens.size).toBe(3)
    })

    it('says which lines it left out, and why, and stores the rest', async () => {
      await add({ name: 'Martin' })

      const imported = await paste('martin ; 2\nDurand ; 40\nNouveau ; 3')

      expect(imported.ok && imported.value.skipped).toEqual([
        { line: 1, reason: 'duplicate' },
        { line: 2, reason: 'places' },
      ])
      expect((await list()).map((entry) => entry.household.name)).toEqual(['Martin', 'Nouveau'])
    })

    it('audits once without any name, and announces it', async () => {
      await paste('Secrète ; 2\nAutre ; 3')

      expect(await act()).toEqual(['event.householdsImported'])
      expect(JSON.stringify((await scene.audit.list({ limit: 50 })).items)).not.toContain('Secrète')
      expect(signals()).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
    })

    it('writes, audits and announces nothing when there is nothing to add', async () => {
      const imported = await paste('\n  \nDurand ; 40')

      expect(imported.ok && imported.value.households).toEqual([])
      expect(imported.ok && imported.value.skipped).toEqual([{ line: 3, reason: 'places' }])
      expect(await act()).toEqual([])
      expect(signals()).toEqual([])
    })

    it('refuses a paste of more than 300 lines and what is not text, and writes nothing', async () => {
      const long = Array.from({ length: 301 }, (_, i) => `F${i}`).join('\n')

      expect(code(await paste(long))).toBe('household.importTooLong')
      expect(code(await paste(42))).toBe('household.importInvalid')
      expect(await scene.households.listByEvent(WEDDING)).toEqual([])
      expect(await act()).toEqual([])
    })

    it('refuses the whole paste, with no audit line, when the list would pass 500', async () => {
      scene.households.seed(
        ...Array.from({ length: MAX_HOUSEHOLDS_PER_EVENT - 1 }, (_, i) =>
          aHousehold({ id: `h-${i}`, eventId: WEDDING, token: `T${String(i).padStart(15, '0')}` }),
        ),
      )

      const refused = await paste('Un\nDeux')

      expect(code(refused)).toBe('household.tooMany')
      expect(await scene.households.count(WEDDING)).toBe(MAX_HOUSEHOLDS_PER_EVENT - 1)
      expect(await act()).toEqual([])
    })

    it('stores nothing when the ceiling is reached between the count and the write', async () => {
      scene.households.addAll = async () => false

      const refused = await paste('Un')

      expect(code(refused)).toBe('household.tooMany')
      expect(signals()).toEqual([])
      // The line is written after the write: a refusal leaves none.
      expect(await act()).toEqual([])
    })

    it('needs the invitation', async () => {
      const bare = await rsvpScene({ invited: false })

      const refused = await bare.importHouseholds({
        eventId: WEDDING,
        actorId: OWNER,
        text: 'Martin ; 2',
      })

      expect(code(refused)).toBe('rsvp.inviteRequired')
    })
  })

  describe('listHouseholds', () => {
    it('lists the households in order, each with the reply that answers for it', async () => {
      await add({ name: 'A' })
      await add({ name: 'B' })
      scene.rsvps.seed(
        aRsvp({
          id: 'r-b',
          eventId: WEDDING,
          householdId: 'household-2',
          answer: 'yes',
          adults: 2,
          kids: 1,
        }),
        aRsvp({ id: 'r-open', eventId: WEDDING }),
      )

      const listed = await list()

      expect(listed.map((entry) => [entry.household.name, entry.reply])).toEqual([
        ['A', null],
        ['B', { id: 'r-b', answer: 'yes', people: 3 }],
      ])
    })

    it('lists nothing of another event', async () => {
      scene.households.seed(aHousehold({ id: 'h-gala', eventId: GALA }))

      expect(await list()).toEqual([])
    })

    it('is a read: it works on a closed event and without an invitation, and says nothing', async () => {
      const bare = await rsvpScene({ invited: false })

      const listed = await bare.listHouseholds({ eventId: WEDDING, actorId: OWNER })

      expect(listed.ok && listed.value).toEqual([])
      expect(signals()).toEqual([])
    })
  })

  describe('deleteHousehold', () => {
    const remove = (overrides: Record<string, unknown> = {}) =>
      scene.deleteHousehold({ eventId: WEDDING, actorId: OWNER, householdId: H1, ...overrides })

    it('deletes the household and keeps its reply, detached', async () => {
      await add()
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING, householdId: 'household-1' }))

      const deleted = await remove()

      expect(deleted.ok).toBe(true)
      expect(await scene.households.listByEvent(WEDDING)).toEqual([])
      const kept = await scene.rsvps.findById(WEDDING, asGuestRsvpId('r-1'))
      expect(kept?.householdId).toBeNull()
      expect(kept?.name).toBe('Léa Martin')
    })

    it('audits the act without a name and announces it', async () => {
      await add({ name: 'Secrète' })

      await remove()

      expect(await act()).toEqual(['event.householdDeleted'])
      expect(JSON.stringify((await scene.audit.list({ limit: 50 })).items)).not.toContain('Secrète')
      expect(signals().length).toBeGreaterThan(1)
    })

    it('leaves no reply pointing at the household when a guest answers while it is being deleted', async () => {
      const added = await add()
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
      const token = await scene.token()
      const link = added.ok ? added.value.household.token.value : ''
      const delet = scene.households.delete.bind(scene.households)
      // The household's own answer lands between the use case's read and its write.
      scene.households.delete = async (eventId, id) => {
        const answered = await scene.submit({
          token,
          householdToken: link,
          name: 'Famille Martin',
          answer: 'yes',
          adults: 2,
        })
        expect(answered.ok).toBe(true)
        return delet(eventId, id)
      }

      const deleted = await remove()

      expect(deleted.ok).toBe(true)
      const replies = await scene.rsvps.listByEvent(WEDDING)
      expect(replies).toHaveLength(1)
      expect(replies[0]?.householdId).toBeNull()
      // And the link opens nothing any more: no answer can be filed under a household that is gone.
      const late = await scene.submit({
        token,
        householdToken: link,
        name: 'Famille Martin',
        answer: 'no',
      })
      expect(code(late)).toBe('rsvp.notFound')
    })

    it('finds nothing for a household that is another event’s or already gone, and audits nothing', async () => {
      scene.households.seed(aHousehold({ id: 'h-gala', eventId: GALA }))

      const foreign = await remove({ householdId: asGuestHouseholdId('h-gala') })
      const gone = await remove()

      expect(code(foreign)).toBe('household.notFound')
      expect(code(gone)).toBe('household.notFound')
      expect(await scene.households.listByEvent(GALA)).toHaveLength(1)
      expect(await act()).toEqual([])
    })

    it('says nothing when the household went between the read and the delete', async () => {
      await add()
      const signalsBefore = signals().length
      scene.households.delete = async () => false

      const refused = await remove()

      expect(code(refused)).toBe('household.notFound')
      expect(signals()).toHaveLength(signalsBefore)
    })

    it('is allowed on an archived event, as the list holds names; a suspended client still cannot', async () => {
      scene.households.seed(
        aHousehold({ id: 'h-arch', eventId: ARCHIVED, token: '00000000000000AA' }),
        aHousehold({ id: 'h-frozen', eventId: FROZEN, token: '00000000000000BB' }),
      )

      const archived = await remove({
        eventId: ARCHIVED,
        householdId: asGuestHouseholdId('h-arch'),
      })
      const frozen = await remove({ eventId: FROZEN, householdId: asGuestHouseholdId('h-frozen') })

      expect(archived.ok).toBe(true)
      expect(code(frozen)).toBe('client.suspended')
      expect(await scene.households.listByEvent(FROZEN)).toHaveLength(1)
    })
  })

  describe('rotateHouseholdToken and markHouseholdReminded', () => {
    const rotate = (overrides: Record<string, unknown> = {}) =>
      scene.rotateHouseholdToken({
        eventId: WEDDING,
        actorId: OWNER,
        householdId: H1,
        ...overrides,
      })
    const remind = (overrides: Record<string, unknown> = {}) =>
      scene.markHouseholdReminded({
        eventId: WEDDING,
        actorId: OWNER,
        householdId: H1,
        ...overrides,
      })

    it('gives a new link, which finds the household, and kills the old one at once', async () => {
      const added = await add()
      const oldToken = added.ok ? added.value.household.token : null
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING, householdId: 'household-1' }))

      const rotated = await rotate()

      expect(rotated.ok && rotated.value.household.token.value).not.toBe(oldToken?.value)
      expect(rotated.ok && rotated.value.reply?.id).toBe('r-1')
      expect(oldToken && (await scene.households.findByToken(WEDDING, oldToken))).toBeNull()
      const stored = (await list())[0]
      expect(stored?.household.token.value).toBe(
        rotated.ok ? rotated.value.household.token.value : '',
      )
      expect(stored?.household.name).toBe('Famille Martin')
      expect(await act()).toEqual(['event.householdTokenRotated'])
    })

    it('notes the reminder without any audit line, and keeps the link', async () => {
      const added = await add()
      scene.clock.advance(5_000)

      const reminded = await remind()

      expect(reminded.ok && reminded.value.household.remindedAt).toEqual(scene.clock.now())
      expect(reminded.ok && reminded.value.household.token.value).toBe(
        added.ok && added.value.household.token.value,
      )
      expect((await list())[0]?.household.remindedAt).toEqual(scene.clock.now())
      expect(await act()).toEqual([])
      expect(signals().length).toBeGreaterThan(1)
    })

    it('finds nothing for a household that is not this event’s, and changes nothing', async () => {
      scene.households.seed(aHousehold({ id: 'h-gala', eventId: GALA }))
      const foreign = asGuestHouseholdId('h-gala')

      expect(code(await rotate({ householdId: foreign }))).toBe('household.notFound')
      expect(code(await remind({ householdId: foreign }))).toBe('household.notFound')
      expect(code(await rotate())).toBe('household.notFound')
      expect(code(await remind())).toBe('household.notFound')
      expect((await scene.households.listByEvent(GALA))[0]?.remindedAt).toBeNull()
      expect(await act()).toEqual([])
    })

    it('says nothing when the household went between the read and the write', async () => {
      await add()
      const signalsBefore = signals().length
      scene.households.rotateToken = async () => false
      scene.households.markReminded = async () => false

      expect(code(await rotate())).toBe('household.notFound')
      expect(code(await remind())).toBe('household.notFound')
      expect(signals()).toHaveLength(signalsBefore)
    })
  })

  describe('attachRsvpToHousehold', () => {
    const attach = (overrides: Record<string, unknown> = {}) =>
      scene.attachRsvp({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
        householdId: H1,
        ...overrides,
      })

    beforeEach(async () => {
      await add()
      scene.rsvps.seed(
        aRsvp({ id: 'r-1', eventId: WEDDING, updatedAt: new Date('2026-06-01T10:00:00Z') }),
      )
    })

    it('files the reply under the household, so it is no longer without one, and touches nothing else', async () => {
      const attached = await attach()

      expect(attached.ok && attached.value.householdId).toBe('household-1')
      expect(attached.ok && attached.value.updatedAt).toEqual(new Date('2026-06-01T10:00:00Z'))
      expect((await list())[0]?.reply?.id).toBe('r-1')
      expect(signals().length).toBeGreaterThan(1)
    })

    it('refuses a reply of more people than the household has places, and files nothing', async () => {
      scene.rsvps.seed(aRsvp({ id: 'r-big', eventId: WEDDING, adults: 4, kids: 1 }))

      const refused = await attach({ rsvpId: asGuestRsvpId('r-big') })
      const exact = await attach({ rsvpId: asGuestRsvpId('r-1') })

      expect(code(refused)).toBe('household.placesExceeded')
      expect(!refused.ok && refused.error.details).toEqual({ places: 4, people: 5 })
      expect((await scene.rsvps.findById(WEDDING, asGuestRsvpId('r-big')))?.householdId).toBeNull()
      expect(exact.ok).toBe(true)
    })

    it('detaches a large reply all the same: the places only limit what is filed', async () => {
      scene.rsvps.seed(
        aRsvp({ id: 'r-big', eventId: WEDDING, adults: 9, householdId: 'household-1' }),
      )

      const detached = await attach({ rsvpId: asGuestRsvpId('r-big'), householdId: null })

      expect(detached.ok && detached.value.householdId).toBeNull()
    })

    it('detaches it with null', async () => {
      await attach()

      const detached = await attach({ householdId: null })

      expect(detached.ok && detached.value.householdId).toBeNull()
      expect((await list())[0]?.reply).toBeNull()
    })

    it('refuses a second reply for one household, and keeps the first', async () => {
      await attach()
      scene.rsvps.seed(aRsvp({ id: 'r-2', eventId: WEDDING }))

      const refused = await attach({ rsvpId: asGuestRsvpId('r-2') })

      expect(code(refused)).toBe('household.alreadyAnswered')
      expect((await scene.rsvps.findByHousehold(WEDDING, 'household-1'))?.id).toBe('r-1')
    })

    it('finds nothing for a household or a reply of another event, or gone', async () => {
      scene.households.seed(aHousehold({ id: 'h-gala', eventId: GALA, token: '00000000000000CC' }))
      scene.rsvps.seed(aRsvp({ id: 'r-gala', eventId: GALA }))

      expect(code(await attach({ householdId: asGuestHouseholdId('h-gala') }))).toBe(
        'household.notFound',
      )
      expect(code(await attach({ rsvpId: asGuestRsvpId('r-gala') }))).toBe('rsvp.notFound')
      expect(code(await attach({ rsvpId: asGuestRsvpId('nope') }))).toBe('rsvp.notFound')
      expect((await scene.rsvps.findById(GALA, asGuestRsvpId('r-gala')))?.householdId).toBeNull()
    })

    it('says the reply is gone when it vanished between the write and the read', async () => {
      const findById = scene.rsvps.findById.bind(scene.rsvps)
      let reads = 0
      scene.rsvps.findById = async (eventId, id) => {
        reads += 1
        // The first read is the places check, the second the answer after the write.
        if (reads === 2) await scene.rsvps.delete(eventId, id)
        return findById(eventId, id)
      }

      expect(code(await attach())).toBe('rsvp.notFound')
    })

    it('says the reply is gone when detaching one that does not exist', async () => {
      const detached = await attach({ rsvpId: asGuestRsvpId('nope'), householdId: null })

      expect(code(detached)).toBe('rsvp.notFound')
    })
  })

  describe('the owner’s door, as the replies have it', () => {
    const asks = (eventId: typeof WEDDING, actorId: typeof OWNER) => ({
      list: () => scene.listHouseholds({ eventId, actorId }),
      save: () => scene.saveHousehold({ eventId, actorId, name: 'A', places: 1 }),
      import: () => scene.importHouseholds({ eventId, actorId, text: 'A' }),
      remove: () => scene.deleteHousehold({ eventId, actorId, householdId: H1 }),
      rotate: () => scene.rotateHouseholdToken({ eventId, actorId, householdId: H1 }),
      remind: () => scene.markHouseholdReminded({ eventId, actorId, householdId: H1 }),
      attach: () =>
        scene.attachRsvp({ eventId, actorId, rsvpId: asGuestRsvpId('r-1'), householdId: null }),
    })

    it('refuses a moderator, and tells a stranger the event does not exist', async () => {
      for (const [name, ask] of Object.entries(asks(WEDDING, MODERATOR))) {
        expect([name, code(await ask())]).toEqual([name, 'auth.forbidden'])
      }
      for (const [name, ask] of Object.entries(asks(WEDDING, STRANGER))) {
        expect([name, code(await ask())]).toEqual([name, 'event.notFound'])
      }
      expect(await scene.households.listByEvent(WEDDING)).toEqual([])
    })

    it('refuses every write on an archived event but the deletion, and every act of a suspended client', async () => {
      for (const [name, ask] of Object.entries(asks(ARCHIVED, OWNER))) {
        if (name === 'list' || name === 'remove') continue
        expect([name, code(await ask())]).toEqual([name, 'guestInvite.eventArchived'])
      }
      for (const [name, ask] of Object.entries(asks(FROZEN, OWNER))) {
        expect([name, code(await ask())]).toEqual([name, 'client.suspended'])
      }
    })
  })

  describe('hostUpdateRsvp on a reply filed under a household', () => {
    it('judges it by the household’s places, not by the form’s maximum of 4; a stray reply keeps the form’s', async () => {
      await add({ places: 8 })
      scene.rsvps.seed(
        aRsvp({ id: 'r-h', eventId: WEDDING, householdId: 'household-1' }),
        aRsvp({ id: 'r-open', eventId: WEDDING }),
        aRsvp({ id: 'r-lost', eventId: WEDDING, householdId: 'deleted-household' }),
      )
      const update = (rsvpId: string) =>
        scene.hostUpdate({
          eventId: WEDDING,
          actorId: OWNER,
          rsvpId: asGuestRsvpId(rsvpId),
          name: 'Léa',
          answer: 'yes',
          adults: 6,
          kids: 0,
        })

      const filed = await update('r-h')
      const open = await update('r-open')
      const lost = await update('r-lost')

      expect(filed.ok && filed.value.adults).toBe(6)
      expect(code(open)).toBe('rsvp.partyTooBig')
      expect(code(lost)).toBe('rsvp.partyTooBig')
    })
  })

  describe('the figures', () => {
    it('count the households with no reply, and the places kept for them, in the list', async () => {
      await add({ name: 'A', places: 4 })
      await add({ name: 'B', places: 2 })
      await add({ name: 'C', places: 3 })
      scene.rsvps.seed(
        aRsvp({ id: 'r-a', eventId: WEDDING, householdId: 'household-1', answer: 'no' }),
      )

      const listed = await scene.list({ eventId: WEDDING, actorId: OWNER })

      expect(listed.ok && listed.value.stats.noReply).toEqual({ households: 2, places: 5 })
    })
  })

  describe('the erasure by the sweeper', () => {
    it('erases the households with the replies, on the same dates, whatever the hold says', async () => {
      await add()
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING }))
      const closed = new Date('2026-12-01T00:00:00Z')
      scene.rsvps.setEventDates(WEDDING, { closedAt: closed, startsAt: null })
      scene.households.setEventDates(WEDDING, { closedAt: closed, startsAt: null })

      scene.clock.set(new Date('2026-12-30T23:59:59Z'))
      expect(await scene.purge()).toEqual({ deleted: 0 })
      scene.clock.set(new Date('2026-12-31T00:00:00Z'))
      expect(await scene.purge()).toEqual({ deleted: 2 })

      expect(await scene.households.listByEvent(WEDDING)).toEqual([])
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })
  })
})

describe('the guest list passes a refusal of the audit log back, before it changes anything', () => {
  const UNAUDITABLE = asEventId('evt not auditable')

  const unauditable = async () => {
    const scene = await rsvpScene({ invited: false })
    scene.events.seed(
      anEvent({ id: UNAUDITABLE, ownerId: OWNER, slug: 'sans-audit', joinCode: 'K9M2NP' }),
    )
    await scene.memberships.grant({
      eventId: UNAUDITABLE,
      userId: OWNER,
      role: 'owner',
      grantedAt: scene.clock.now(),
    })
    // An invitation exists, but the log refuses every line about this event.
    scene.invites.seed(aGuestInvite({ eventId: UNAUDITABLE, tokenByte: 7, ...PARTY }))
    scene.households.seed(aHousehold({ id: 'h-seed', eventId: UNAUDITABLE, token: LINK }))
    return scene
  }
  const LINK = '7QX0M4TZ2KD9WB3H'

  it('importHouseholds, deleteHousehold, rotateHouseholdToken', async () => {
    const scene = await unauditable()
    const SEED = asGuestHouseholdId('h-seed')
    const act = { eventId: UNAUDITABLE, actorId: OWNER }

    const imported = await scene.importHouseholds({ ...act, text: 'Nouveau ; 2' })
    const deleted = await scene.deleteHousehold({ ...act, householdId: SEED })
    const rotated = await scene.rotateHouseholdToken({ ...act, householdId: SEED })

    expect([imported.ok, deleted.ok, rotated.ok]).toEqual([false, false, false])
    const kept = await scene.households.listByEvent(UNAUDITABLE)
    expect(kept.map((household) => [household.name, household.token.value])).toEqual([
      ['Famille Martin', LINK],
    ])
    expect(scene.bus.published).toEqual([])
  })
})

describe('an entropy source that hands back the wrong number of bytes makes no household', () => {
  it('saveHousehold, importHouseholds, rotateHouseholdToken', async () => {
    const scene = await rsvpScene()
    scene.households.seed(aHousehold({ id: 'household-1', eventId: WEDDING }))
    Object.assign(scene.ids, { bytes: () => new Uint8Array(3) })
    const act = { eventId: WEDDING, actorId: OWNER }

    const saved = await scene.saveHousehold({ ...act, name: 'A', places: 2 })
    const imported = await scene.importHouseholds({ ...act, text: 'B ; 2' })
    const rotated = await scene.rotateHouseholdToken({ ...act, householdId: H1 })

    expect([code(saved), code(imported), code(rotated)]).toEqual([
      'household.tokenInvalid',
      'household.tokenInvalid',
      'household.tokenInvalid',
    ])
    const stored = await scene.households.listByEvent(WEDDING)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.token.value).toBe('7QX0M4TZ2KD9WB3H')
    expect(
      await scene.audit.list({ limit: 50 }).then((l) => l.items.map((i) => i.action)),
    ).not.toContain('event.householdTokenRotated')
  })
})
