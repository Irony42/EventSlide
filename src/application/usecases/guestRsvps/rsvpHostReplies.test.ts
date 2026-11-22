import { beforeEach, describe, expect, it } from 'vitest'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { MAX_RSVPS_PER_EVENT } from '../../../domain/guestRsvps/rsvpLimits'
import { asGuestRsvpId } from '../../../domain/shared/ids'
import { aGuestInvite, anEvent } from '../../testing/builders'
import { makeHostAddRsvp } from './hostAddRsvp'
import { makeHostDeleteRsvp } from './hostDeleteRsvp'
import { makeHostUpdateRsvp } from './hostUpdateRsvp'
import { makeSaveRsvpForm } from './saveRsvpForm'
import { makeCloseRsvps } from './closeRsvps'
import {
  GALA,
  MODERATOR,
  OWNER,
  PARTY,
  WEDDING,
  rsvpScene,
  type RsvpScene,
} from '../../testing/rsvpScene'
import { asEventId } from '../../../domain/shared/ids'

/**
 * The replies the host reads and writes (spec 30): the list with its figures, the replies the host
 * types, corrects and deletes, the spreadsheet, the badge, and the erasure by the sweeper.
 */

describe('the replies of an event, on the host’s side (spec 30)', () => {
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
    scene.hostAdd({
      eventId: WEDDING,
      actorId: OWNER,
      name: 'Léa Martin',
      answer: 'yes',
      adults: 2,
      kids: 1,
      ...overrides,
    })

  describe('hostAddRsvp', () => {
    it('stores a reply typed by the host: source host, no token, judged by the form', async () => {
      const added = await add({ diet: 'sans gluten', message: 'Au téléphone' })

      expect(added.ok && added.value.toProps()).toMatchObject({
        eventId: WEDDING,
        name: 'Léa Martin',
        answer: 'yes',
        adults: 2,
        kids: 1,
        diet: 'sans gluten',
        message: 'Au téléphone',
        source: 'host',
        editTokenHash: null,
        householdId: null,
        createdAt: scene.clock.now(),
      })
      expect(await scene.rsvps.listByEvent(WEDDING)).toHaveLength(1)
    })

    it('audits the act without any content and announces it', async () => {
      await add({ name: 'Secret', diet: 'noix' })

      expect(await act()).toEqual(['event.rsvpHostAdded'])
      expect(JSON.stringify((await scene.audit.list({ limit: 50 })).items)).not.toContain('Secret')
      expect(signals()).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
    })

    it('judges the reply with the form of the moment, and writes nothing on a refusal', async () => {
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        form: { maybe: false, partySize: { max: 3 } },
      })

      const maybe = await add({ answer: 'maybe' })
      const big = await add({ adults: 3, kids: 1 })
      const nameless = await add({ name: ' ' })

      expect(!maybe.ok && maybe.error.code).toBe('rsvp.maybeNotOffered')
      expect(!big.ok && big.error.code).toBe('rsvp.partyTooBig')
      expect(!nameless.ok && nameless.error.code).toBe('rsvp.nameEmpty')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(await act()).toEqual(['event.rsvpFormSaved'])
    })

    it('is allowed when the window is closed, and is not held to the places', async () => {
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        enabled: true,
        form: { partySize: { max: 10 } },
      })
      await scene.close({ eventId: WEDDING, actorId: OWNER })
      scene.rsvps.seed(aRsvp({ id: 'seed-1', eventId: WEDDING, adults: 3 }))

      const added = await add({ adults: 5, kids: 5 })

      expect(added.ok).toBe(true)
    })

    it('stops at a thousand replies: 409 rsvp.tooMany, and nothing announced', async () => {
      for (let i = 0; i < MAX_RSVPS_PER_EVENT; i += 1) {
        scene.rsvps.seed(aRsvp({ id: `seed-${i}`, eventId: WEDDING, answer: 'no' }))
      }
      const before = signals().length

      const refused = await add()

      expect(!refused.ok && refused.error.code).toBe('rsvp.tooMany')
      expect(!refused.ok && refused.error.kind).toBe('conflict')
      expect(signals()).toHaveLength(before)
    })

    it('needs the invitation', async () => {
      const bare = await rsvpScene({ invited: false })

      const refused = await bare.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
      })

      expect(!refused.ok && refused.error.code).toBe('rsvp.inviteRequired')
    })
  })

  describe('hostUpdateRsvp', () => {
    it('replaces the reply and keeps its id, its token digest, its source and its creation', async () => {
      scene.rsvps.seed(
        aRsvp({
          id: 'r-1',
          eventId: WEDDING,
          editTokenHash: 'digest',
          source: 'open',
          createdAt: new Date('2026-06-01T10:00:00Z'),
        }),
      )
      scene.clock.advance(3_600_000)

      const updated = await scene.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
        name: 'Léa M.',
        answer: 'no',
      })

      expect(updated.ok && updated.value.toProps()).toMatchObject({
        id: 'r-1',
        editTokenHash: 'digest',
        source: 'open',
        createdAt: new Date('2026-06-01T10:00:00Z'),
        name: 'Léa M.',
        answer: 'no',
        adults: 0,
        updatedAt: scene.clock.now(),
      })
      expect((await scene.rsvps.findById(WEDDING, asGuestRsvpId('r-1')))?.name).toBe('Léa M.')
      expect(await act()).toEqual(['event.rsvpHostEdited'])
      expect(signals()).toHaveLength(1)
    })

    it('is not held to the places', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { partySize: { max: 10 } } })
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING, answer: 'no' }))

      const updated = await scene.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
        name: 'Léa',
        answer: 'yes',
        adults: 9,
      })

      expect(updated.ok).toBe(true)
    })

    it('refuses an invalid reply and changes nothing', async () => {
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING, name: 'Avant' }))

      const refused = await scene.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
        name: '',
        answer: 'yes',
        adults: 1,
      })

      expect(!refused.ok && refused.error.code).toBe('rsvp.nameEmpty')
      expect((await scene.rsvps.findById(WEDDING, asGuestRsvpId('r-1')))?.name).toBe('Avant')
      expect(await act()).toEqual([])
    })

    it('finds nothing for a reply that does not exist or is another event’s', async () => {
      scene.rsvps.seed(aRsvp({ id: 'r-gala', eventId: GALA }))
      const input = { eventId: WEDDING, actorId: OWNER, name: 'Léa', answer: 'yes', adults: 1 }

      const missing = await scene.hostUpdate({ ...input, rsvpId: asGuestRsvpId('nope') })
      const foreign = await scene.hostUpdate({ ...input, rsvpId: asGuestRsvpId('r-gala') })

      expect(!missing.ok && missing.error.code).toBe('rsvp.notFound')
      expect(!foreign.ok && foreign.error.code).toBe('rsvp.notFound')
    })

    it('needs the invitation', async () => {
      const bare = await rsvpScene({ invited: false })

      const refused = await bare.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
        name: 'Léa',
        answer: 'yes',
        adults: 1,
      })

      expect(!refused.ok && refused.error.code).toBe('rsvp.inviteRequired')
    })
  })

  describe('hostDeleteRsvp', () => {
    it('deletes the reply, audits it and announces it', async () => {
      scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING }))

      const deleted = await scene.hostDelete({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
      })

      expect(deleted.ok).toBe(true)
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(await act()).toEqual(['event.rsvpHostDeleted'])
      expect(signals()).toHaveLength(1)
    })

    it('finds nothing for a reply that is gone or another event’s, and keeps the other', async () => {
      scene.rsvps.seed(aRsvp({ id: 'r-gala', eventId: GALA }))

      const foreign = await scene.hostDelete({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-gala'),
      })

      expect(!foreign.ok && foreign.error.code).toBe('rsvp.notFound')
      expect(await scene.rsvps.listByEvent(GALA)).toHaveLength(1)
      expect(await act()).toEqual([])
    })

    it('needs no invitation: a host must be able to remove the names an invitation once collected', async () => {
      const bare = await rsvpScene({ invited: false })
      bare.rsvps.seed(aRsvp({ id: 'r-1', eventId: WEDDING }))

      const deleted = await bare.hostDelete({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: asGuestRsvpId('r-1'),
      })

      expect(deleted.ok).toBe(true)
    })
  })

  describe('listRsvps', () => {
    it('lists the replies, the most recently changed first, with their figures', async () => {
      scene.rsvps.seed(
        aRsvp({
          id: 'a',
          eventId: WEDDING,
          adults: 2,
          kids: 1,
          updatedAt: new Date('2026-06-01T10:00:00Z'),
        }),
        aRsvp({
          id: 'b',
          eventId: WEDDING,
          answer: 'no',
          updatedAt: new Date('2026-06-02T10:00:00Z'),
        }),
        aRsvp({ id: 'g', eventId: GALA }),
      )

      const listed = await scene.list({ eventId: WEDDING, actorId: OWNER })

      expect(listed.ok && listed.value.rsvps.map((rsvp) => rsvp.id)).toEqual(['b', 'a'])
      expect(listed.ok && listed.value.stats.yes).toEqual({
        responses: 1,
        people: 3,
        adults: 2,
        kids: 1,
      })
      expect(listed.ok && listed.value.stats.no.responses).toBe(1)
    })

    it('counts what the host has not seen, and reading does not mark anything seen', async () => {
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING }), aRsvp({ id: 'b', eventId: WEDDING }))

      const first = await scene.list({ eventId: WEDDING, actorId: OWNER })
      const second = await scene.list({ eventId: WEDDING, actorId: OWNER })

      expect(first.ok && first.value.unseen).toBe(2)
      expect(second.ok && second.value.unseen).toBe(2)
    })

    it('answers an empty list for an event with no invitation', async () => {
      const bare = await rsvpScene({ invited: false })

      const listed = await bare.list({ eventId: WEDDING, actorId: OWNER })

      expect(listed.ok && listed.value.rsvps).toEqual([])
      expect(listed.ok && listed.value.state).toBeNull()
    })
  })

  describe('markRsvpsSeen and countUnseenRsvps', () => {
    it('makes the badge count from now on, for this member only', async () => {
      scene.rsvps.seed(
        aRsvp({ id: 'a', eventId: WEDDING, updatedAt: new Date('2026-06-01T10:00:00Z') }),
      )
      expect(await scene.countUnseen({ eventId: WEDDING, actorId: OWNER })).toBe(1)

      const seen = await scene.markSeen({ eventId: WEDDING, actorId: OWNER })

      expect(seen.ok).toBe(true)
      expect(await scene.countUnseen({ eventId: WEDDING, actorId: OWNER })).toBe(0)
      scene.rsvps.seed(
        aRsvp({
          id: 'b',
          eventId: WEDDING,
          updatedAt: new Date(scene.clock.now().getTime() + 1000),
        }),
      )
      expect(await scene.countUnseen({ eventId: WEDDING, actorId: OWNER })).toBe(1)
      expect(await scene.countUnseen({ eventId: WEDDING, actorId: MODERATOR })).toBe(0)
    })

    it('audits and announces nothing', async () => {
      await scene.markSeen({ eventId: WEDDING, actorId: OWNER })

      expect(await act()).toEqual([])
      expect(signals()).toEqual([])
    })
  })

  describe('exportRsvps', () => {
    it('writes the spreadsheet in the language of the invitation, and audits the download', async () => {
      await scene.save({ eventId: WEDDING, actorId: OWNER, language: 'en' })
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING, name: 'Léa', adults: 2 }))

      const exported = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'all' })

      expect(exported.ok && exported.value.csv).toContain('Name;Answer;Adults;Children')
      expect(exported.ok && exported.value.csv).toContain('Léa;Yes;2;0')
      expect(exported.ok && exported.value.slug).toBe('camille-et-sacha')
      expect(await act()).toEqual(['event.rsvpsExported'])
    })

    it('writes the caterer view without the people who do not come and without any word', async () => {
      scene.rsvps.seed(
        aRsvp({ id: 'a', eventId: WEDDING, name: 'Léa', message: 'privé' }),
        aRsvp({ id: 'b', eventId: WEDDING, name: 'Hugo', answer: 'no' }),
      )

      const exported = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'caterer' })

      expect(exported.ok && exported.value.csv).toContain('Léa')
      expect(exported.ok && exported.value.csv).not.toContain('Hugo')
      expect(exported.ok && exported.value.csv).not.toContain('privé')
    })

    it('speaks French when the event has no invitation, and exports nothing else', async () => {
      const bare = await rsvpScene({ invited: false })

      const exported = await bare.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'all' })

      expect(exported.ok && exported.value.csv).toContain('Nom;Réponse')
    })
  })

  describe('purgeExpiredRsvps', () => {
    it('erases the replies of an event whose time has come, and reports how many', async () => {
      scene.rsvps.seed(
        aRsvp({ id: 'a', eventId: WEDDING }),
        aRsvp({ id: 'b', eventId: WEDDING }),
        aRsvp({ id: 'g', eventId: GALA }),
      )
      scene.rsvps.setEventDates(WEDDING, {
        closedAt: new Date(scene.clock.now().getTime() - 30 * 86_400_000),
        startsAt: null,
      })

      const report = await scene.purge()

      expect(report).toEqual({ deleted: 2 })
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(await scene.rsvps.listByEvent(GALA)).toHaveLength(1)
    })

    it('keeps the replies of an event that has a day left', async () => {
      scene.rsvps.seed(aRsvp({ id: 'a', eventId: WEDDING }))
      scene.rsvps.setEventDates(WEDDING, {
        closedAt: new Date(scene.clock.now().getTime() - 29 * 86_400_000),
        startsAt: null,
      })

      expect(await scene.purge()).toEqual({ deleted: 0 })
    })
  })
})

describe('the replies use cases pass a refusal of the audit log back, before they change anything', () => {
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
    return scene
  }

  it('saveRsvpForm, closeRsvps, hostAddRsvp, hostUpdateRsvp, hostDeleteRsvp', async () => {
    const scene = await unauditable()
    scene.rsvps.seed(aRsvp({ id: 'r-1', eventId: UNAUDITABLE, name: 'Avant' }))
    const base = { events: scene.events, memberships: scene.memberships, invites: scene.invites }
    const deps = {
      ...base,
      rsvps: scene.rsvps,
      audit: scene.audit,
      bus: scene.bus,
      clock: scene.clock,
    }

    const saved = await makeSaveRsvpForm(deps)({
      eventId: UNAUDITABLE,
      actorId: OWNER,
      enabled: true,
    })
    const closed = await makeCloseRsvps(deps)({ eventId: UNAUDITABLE, actorId: OWNER })
    const added = await makeHostAddRsvp({ ...deps, ids: scene.ids })({
      eventId: UNAUDITABLE,
      actorId: OWNER,
      name: 'Léa',
      answer: 'yes',
      adults: 1,
    })
    const updated = await makeHostUpdateRsvp(deps)({
      eventId: UNAUDITABLE,
      actorId: OWNER,
      rsvpId: asGuestRsvpId('r-1'),
      name: 'Après',
      answer: 'yes',
      adults: 1,
    })
    const deleted = await makeHostDeleteRsvp(deps)({
      eventId: UNAUDITABLE,
      actorId: OWNER,
      rsvpId: asGuestRsvpId('r-1'),
    })

    expect([saved.ok, closed.ok, added.ok, updated.ok, deleted.ok]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
    expect((await scene.invites.findRsvpSettings(UNAUDITABLE))?.enabled).toBe(false)
    expect((await scene.invites.findRsvpSettings(UNAUDITABLE))?.closedAt).toBeNull()
    expect((await scene.rsvps.listByEvent(UNAUDITABLE)).map((rsvp) => rsvp.name)).toEqual(['Avant'])
    expect(scene.bus.published).toEqual([])
  })

  it('exportRsvps hands out no file without its line', async () => {
    const scene = await unauditable()

    const exported = await scene.exportCsv({ eventId: UNAUDITABLE, actorId: OWNER, view: 'all' })

    expect(exported.ok).toBe(false)
  })
})
