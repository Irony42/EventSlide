import { beforeEach, describe, expect, it } from 'vitest'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId, asGuestRsvpId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
import { DomainError } from '../../../domain/shared/errors'
import { AT, anEvent } from '../../testing/builders'
import { OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'
import { makeCreateGuestbookEntry } from '../guestbook/createGuestbookEntry'
import { makePostAbsentNote } from './postAbsentNote'

/**
 * The word of those who cannot come (spec 30, lot 4): a guest who answered "no" leaves a message in the
 * guestbook, by the guestbook's own door. An author is made for it (`via_rsvp`, in no count of guests),
 * one note per reply, the guestbook's ceilings and moderation apply, a refusal leaves nothing behind,
 * and erasing the reply erases the note.
 */

const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code
const LINK = '7QX0M4TZ2KD9WB3H'

describe('a note left by a guest who cannot come (spec 30, lot 4)', () => {
  let scene: RsvpScene
  let token: string
  let editToken: string

  /** The wedding with its guestbook on (and the moderation of the test), as the host leaves it. */
  const guestbookOn = (settings: Record<string, unknown> = {}) =>
    scene.events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        settings: { allowGuestbook: true, moderation: 'auto', ...settings },
      }),
    )

  beforeEach(async () => {
    scene = await rsvpScene()
    guestbookOn()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    token = await scene.token()
    const sent = await scene.submit({ token, name: 'Léa Martin', answer: 'no' })
    if (!sent.ok) throw new Error('the reply was refused')
    editToken = sent.value.editToken ?? ''
  })

  const write = (overrides: Record<string, unknown> = {}) =>
    scene.postAbsentNote({ token, editToken, text: 'Dommage, on pense à vous', ...overrides })
  const entries = () => scene.guestbook.listByStatuses(WEDDING, ['published', 'pending'], 50)
  const reply = async () => (await scene.rsvps.listByEvent(WEDDING))[0]

  it('writes the note through the guestbook, signed with the first word of the reply’s name', async () => {
    const posted = await write()

    expect(posted.ok).toBe(true)
    const [entry] = await entries()
    expect(entry?.text?.value).toBe('Dommage, on pense à vous')
    // Always held for the host, even on an event that publishes on arrival.
    expect(entry?.status).toBe('pending')
    const author = await scene.guests.findById(WEDDING, entry?.guestId as never)
    expect(author?.displayName?.value).toBe('Léa')
    expect(author?.viaRsvp).toBe(true)
    expect((await reply())?.absentNoteGuestId).toBe(entry?.guestId)
  })

  it('tells the host’s console, which is the guestbook’s own signal', async () => {
    const before = scene.bus.published.length

    await write()

    expect(scene.bus.published.slice(before).map((event) => event.type)).toEqual([
      'guestbook.changed',
    ])
  })

  it('is held for the host whatever the event’s moderation mode, automatic included', async () => {
    for (const moderation of ['auto', 'manual']) {
      guestbookOn({ moderation })
      await scene.deleteOwn({ token, editToken })
      const sent = await scene.submit({ token, name: 'Léa Martin', answer: 'no' })
      const fresh = sent.ok ? (sent.value.editToken ?? '') : ''

      await scene.postAbsentNote({ token, editToken: fresh, text: `Mot ${moderation}` })
    }

    expect((await entries()).map((entry) => entry.status)).toEqual(['pending', 'pending'])
  })

  it('does not hold the guests’ own messages: the flag is the note’s alone', async () => {
    guestbookOn({ moderation: 'auto' })
    const created = await makeCreateGuestbookEntry({
      events: scene.events,
      guestbook: scene.guestbook,
      ids: scene.ids,
      bus: scene.bus,
      clock: scene.clock,
    })({ eventId: WEDDING, guestId: 'someone' as never, text: 'Bravo' })

    expect(created.ok && created.value.entry.status).toBe('published')
  })

  describe('the signature', () => {
    it('is the guest’s own, as they edited it, and judged like a name', async () => {
      await write({ signature: 'Léa & Hugo' })

      const [entry] = await entries()
      const author = await scene.guests.findById(WEDDING, entry?.guestId as never)
      expect(author?.displayName?.value).toBe('Léa & Hugo')
    })

    it('stays anonymous when emptied, and is the first word when not given at all', async () => {
      await write({ signature: '   ' })
      const [anonymous] = await entries()
      expect(
        (await scene.guests.findById(WEDDING, anonymous?.guestId as never))?.displayName,
      ).toBeNull()
    })

    it.each([
      ['too long', 'A'.repeat(41), 'displayName.tooLong'],
      ['not text', 4, 'displayName.invalid'],
    ])(
      'refuses a signature that is %s before anything is made',
      async (_name, signature, expected) => {
        expect(code(await write({ signature }))).toBe(expected)

        expect(await entries()).toEqual([])
        expect((await reply())?.absentNoteGuestId).toBeNull()
      },
    )
  })

  it('cuts the first word at forty characters, and signs nobody when there is no name to give', async () => {
    await scene.deleteOwn({ token, editToken })
    const sent = await scene.submit({ token, name: 'A'.repeat(55), answer: 'no' })
    const long = sent.ok ? (sent.value.editToken ?? '') : ''

    await scene.postAbsentNote({ token, editToken: long, text: 'Merci' })

    const [entry] = await entries()
    const author = await scene.guests.findById(WEDDING, entry?.guestId as never)
    expect(author?.displayName?.value).toBe('A'.repeat(40))
  })

  it('is in no count of the party’s guests: not in the list, not among those present', async () => {
    await write()

    expect(await scene.guests.list(WEDDING)).toEqual([])
    expect(await scene.guests.countActive(WEDDING, new Date(AT.getTime() - 1000))).toBe(0)
  })

  it('works with a household’s link as the key, for the household’s one reply', async () => {
    await scene.deleteOwn({ token, editToken })
    scene.households.seed(
      aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, name: 'Famille Martin', places: 4 }),
    )
    await scene.submit({ token, householdToken: LINK, name: 'Famille Martin', answer: 'no' })

    const posted = await scene.postAbsentNote({
      token,
      editToken: undefined,
      householdToken: LINK,
      text: 'On pense à vous',
    })

    expect(posted.ok).toBe(true)
    const [entry] = await entries()
    expect(
      (await scene.guests.findById(WEDDING, entry?.guestId as never))?.displayName?.value,
    ).toBe('Famille Martin')
  })

  describe('what is refused', () => {
    it('is one neutral 404 for a page that cannot be served, and rsvp.notFound for a key that opens nothing', async () => {
      expect(code(await write({ token: 'nope' }))).toBe('guestInvite.notAvailable')
      expect(code(await write({ editToken: 'wrong' }))).toBe('rsvp.notFound')
      expect(code(await write({ editToken: undefined }))).toBe('rsvp.notFound')
      expect(code(await write({ editToken: 'x'.repeat(200) }))).toBe('rsvp.notFound')
      expect(code(await write({ householdToken: 'ZZZZ' }))).toBe('rsvp.notFound')
      expect(await entries()).toEqual([])
    })

    it('is rsvp.absentNoteUnavailable for a guest who did not answer no', async () => {
      await scene.updateOwn({ token, editToken, name: 'Léa Martin', answer: 'yes', adults: 1 })

      expect(code(await write())).toBe('rsvp.absentNoteUnavailable')
      expect(await scene.guests.list(WEDDING)).toEqual([])
    })

    it('is rsvp.absentNoteUnavailable when the host switched the note off', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { absentNote: false } })

      expect(code(await write())).toBe('rsvp.absentNoteUnavailable')
    })

    it('is rsvp.absentNoteUnavailable when the guestbook is off, or no longer takes entries', async () => {
      guestbookOn({ allowGuestbook: false })
      expect(code(await write())).toBe('rsvp.absentNoteUnavailable')

      guestbookOn()
      scene.clock.set(new Date(AT.getTime() + 30 * 24 * 3600_000))
      scene.events.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: 'camille-et-sacha',
          joinCode: 'H7K2QM',
          status: 'closed',
          closedAt: AT,
          settings: { allowGuestbook: true },
        }),
      )
      expect(code(await write())).toBe('rsvp.absentNoteUnavailable')
    })

    it('judges the text by the guestbook’s rules before anything is made', async () => {
      expect(code(await write({ text: '   ' }))).toBe('guestbook.empty')
      expect(code(await write({ text: 'x'.repeat(600) }))).toBe('guestbook.tooLong')
      expect(code(await write({ text: 4 }))).toBe('guestbook.invalid')

      expect(await scene.guests.list(WEDDING)).toEqual([])
      expect((await reply())?.absentNoteGuestId).toBeNull()
    })

    it('allows one note per reply', async () => {
      await write()

      expect(code(await write({ text: 'Encore' }))).toBe('rsvp.absentNoteSent')
      expect(await entries()).toHaveLength(1)
    })

    it('makes no second author when the note was claimed in between, and says it was sent', async () => {
      const made: string[] = []
      const ids = {
        guestId: () => {
          const id = scene.ids.guestId()
          made.push(id)
          return id
        },
      }
      const losing = makePostAbsentNote({
        events: scene.events,
        invites: scene.invites,
        rsvps: {
          findByEditTokenHash: (...args) => scene.rsvps.findByEditTokenHash(...args),
          findByHousehold: (...args) => scene.rsvps.findByHousehold(...args),
          claimAbsentNote: async () => false,
          releaseAbsentNote: async () => undefined,
        },
        households: scene.households,
        secrets: scene.secrets,
        guests: scene.guests,
        createEntry: async () => err(DomainError.conflict('never')),
        ids,
        clock: scene.clock,
      })

      const posted = await losing({ token, editToken, text: 'Merci' })

      expect(code(posted)).toBe('rsvp.absentNoteSent')
      expect(made).toHaveLength(1)
      expect(await scene.guests.findById(WEDDING, made[0] as never)).toBeNull()
      expect(await entries()).toEqual([])
    })

    it('takes everything back when the guestbook refuses, and lets the guest try again', async () => {
      const made: string[] = []
      const ids = {
        guestId: () => {
          const id = scene.ids.guestId()
          made.push(id)
          return id
        },
      }
      const refused = makePostAbsentNote({
        events: scene.events,
        invites: scene.invites,
        rsvps: scene.rsvps,
        households: scene.households,
        secrets: scene.secrets,
        guests: scene.guests,
        createEntry: async () => err(DomainError.conflict('guestbook.eventFull', { max: 500 })),
        ids,
        clock: scene.clock,
      })

      const posted = await refused({ token, editToken, text: 'Merci' })

      expect(code(posted)).toBe('guestbook.eventFull')
      expect((await reply())?.absentNoteGuestId).toBeNull()
      expect(made).toHaveLength(1)
      expect(await scene.guests.findById(WEDDING, made[0] as never)).toBeNull()
      expect((await write()).ok).toBe(true)
    })

    it('answers a script as a person and writes nothing', async () => {
      const posted = await write({ website: 'http://spam.example' })

      expect(posted.ok).toBe(true)
      expect(await entries()).toEqual([])
      expect((await reply())?.absentNoteGuestId).toBeNull()
      expect(await scene.guests.list(WEDDING)).toEqual([])
    })

    it('does not reach another event’s reply with this event’s link', async () => {
      scene.rsvps.seed(
        aRsvp({
          id: asGuestRsvpId('other'),
          eventId: asEventId('another-event'),
          answer: 'no',
          editTokenHash: scene.secrets.digestOf('secret-other'),
        }),
      )

      expect(code(await write({ editToken: 'secret-other' }))).toBe('rsvp.notFound')
    })
  })

  describe('a store that fails half way', () => {
    const failing = (
      made: string[],
      overrides: Partial<Parameters<typeof makePostAbsentNote>[0]>,
    ) =>
      makePostAbsentNote({
        events: scene.events,
        invites: scene.invites,
        rsvps: scene.rsvps,
        households: scene.households,
        secrets: scene.secrets,
        guests: scene.guests,
        createEntry: makeCreateGuestbookEntry({
          events: scene.events,
          guestbook: scene.guestbook,
          ids: scene.ids,
          bus: scene.bus,
          clock: scene.clock,
        }),
        ids: {
          guestId: () => {
            const id = scene.ids.guestId()
            made.push(id)
            return id
          },
        },
        clock: scene.clock,
        ...overrides,
      })

    it('gives the claim back and removes the author when the guestbook throws, and tells the failure', async () => {
      const made: string[] = []
      const post = failing(made, {
        createEntry: async () => {
          throw new Error('disk full')
        },
      })

      await expect(post({ token, editToken, text: 'Merci' })).rejects.toThrow('disk full')

      expect((await reply())?.absentNoteGuestId).toBeNull()
      expect(await scene.guests.findById(WEDDING, made[0] as never)).toBeNull()
      expect((await write()).ok).toBe(true)
    })

    it('gives the claim back and removes the author when the claim itself throws', async () => {
      const made: string[] = []
      const post = failing(made, {
        rsvps: {
          findByEditTokenHash: (...args) => scene.rsvps.findByEditTokenHash(...args),
          findByHousehold: (...args) => scene.rsvps.findByHousehold(...args),
          claimAbsentNote: async () => {
            throw new Error('locked')
          },
          releaseAbsentNote: (...args) => scene.rsvps.releaseAbsentNote(...args),
        },
      })

      await expect(post({ token, editToken, text: 'Merci' })).rejects.toThrow('locked')

      expect(await scene.guests.findById(WEDDING, made[0] as never)).toBeNull()
    })

    it('removes what was made, and tells the failure, when saving the author throws', async () => {
      const made: string[] = []
      const post = failing(made, {
        guests: {
          save: async () => {
            throw new Error('readonly')
          },
          delete: (...args) => scene.guests.delete(...args),
        },
      })

      await expect(post({ token, editToken, text: 'Merci' })).rejects.toThrow('readonly')

      expect((await reply())?.absentNoteGuestId).toBeNull()
    })

    it('tells the original failure even when taking back fails too', async () => {
      const made: string[] = []
      const post = failing(made, {
        createEntry: async () => {
          throw new Error('first')
        },
        guests: {
          save: (...args) => scene.guests.save(...args),
          delete: async () => {
            throw new Error('second')
          },
        },
      })

      await expect(post({ token, editToken, text: 'Merci' })).rejects.toThrow('first')
    })
  })

  describe('erasing the reply tells what prints the guestbook', () => {
    const erased = (eventId = WEDDING) => [
      `export:${eventId}:guestbookChanged`,
      `book:${eventId}:messageRemoved`,
    ]

    it('retires the archive and the book before, the book again and the signal after, for the guest’s own deletion', async () => {
      await write()
      scene.retired.length = 0
      const before = scene.bus.published.length

      await scene.deleteOwn({ token, editToken })

      expect(scene.retired).toEqual([...erased(), `book:${WEDDING}:messageRemoved`])
      expect(scene.bus.published.slice(before).map((event) => event.type)).toEqual([
        'rsvp.changed',
        'guestbook.changed',
      ])
    })

    it('does the same for the host’s deletion', async () => {
      await write()
      const held = await reply()
      scene.retired.length = 0
      const before = scene.bus.published.length

      await scene.hostDelete({ eventId: WEDDING, actorId: OWNER, rsvpId: held?.id as never })

      expect(scene.retired).toEqual([...erased(), `book:${WEDDING}:messageRemoved`])
      expect(scene.bus.published.slice(before).map((event) => event.type)).toEqual([
        'rsvp.changed',
        'guestbook.changed',
      ])
    })

    it('does the same, once for each event, for the retention sweep, and only for an event that held a note', async () => {
      await write()
      scene.rsvps.setEventDates(WEDDING, {
        closedAt: new Date(AT.getTime() - 60 * 86_400_000),
        startsAt: null,
      })
      scene.retired.length = 0
      const before = scene.bus.published.length

      const report = await scene.purge()

      expect(report.deleted).toBeGreaterThan(0)
      expect(scene.retired).toEqual([...erased(), `book:${WEDDING}:messageRemoved`])
      expect(scene.bus.published.slice(before).map((event) => event.type)).toEqual([
        'guestbook.changed',
      ])
    })

    it('says nothing of the guestbook for a reply that held no note', async () => {
      scene.retired.length = 0
      const before = scene.bus.published.length

      await scene.deleteOwn({ token, editToken })

      expect(scene.retired).toEqual([])
      expect(scene.bus.published.slice(before).map((event) => event.type)).toEqual(['rsvp.changed'])
    })

    it('sweeps nothing and tells nothing when no expired reply holds a note', async () => {
      scene.rsvps.setEventDates(WEDDING, {
        closedAt: new Date(AT.getTime() - 60 * 86_400_000),
        startsAt: null,
      })
      scene.retired.length = 0

      await scene.purge()

      expect(scene.retired).toEqual([])
    })
  })

  describe('erasing the reply', () => {
    it('asks for the note’s author to go with the reply, the guest’s own deletion included', async () => {
      await write()
      const authorId = (await reply())?.absentNoteGuestId

      await scene.deleteOwn({ token, editToken })

      expect(scene.rsvps.deletedNoteGuests).toEqual([authorId])
    })

    it('and the host’s', async () => {
      await write()
      const held = await reply()

      await scene.hostDelete({ eventId: WEDDING, actorId: OWNER, rsvpId: held?.id as never })

      expect(scene.rsvps.deletedNoteGuests).toEqual([held?.absentNoteGuestId])
    })

    it('and the retention sweep’s', async () => {
      await write()
      const authorId = (await reply())?.absentNoteGuestId
      scene.rsvps.setEventDates(WEDDING, {
        closedAt: new Date(AT.getTime() - 60 * 86_400_000),
        startsAt: null,
      })

      await scene.purge()

      expect(scene.rsvps.deletedNoteGuests).toEqual([authorId])
    })
  })

  describe('what the invitation page says', () => {
    it('offers the note while the host allows it and the guestbook takes entries, and not otherwise', async () => {
      const page = async () => {
        const viewed = await scene.view({ token })
        return viewed.ok && viewed.value.rsvp.absentNoteAvailable
      }

      expect(await page()).toBe(true)
      guestbookOn({ allowGuestbook: false })
      expect(await page()).toBe(false)
      guestbookOn()
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { absentNote: false } })
      expect(await page()).toBe(false)
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { absentNote: true } })
      expect(await page()).toBe(true)
    })

    it('stops offering it once the guestbook no longer takes entries: a week after the event closed', async () => {
      const closed = (days: number) =>
        scene.events.seed(
          anEvent({
            id: WEDDING,
            ownerId: OWNER,
            slug: 'camille-et-sacha',
            joinCode: 'H7K2QM',
            status: 'closed',
            closedAt: AT,
            settings: { allowGuestbook: true },
          }),
        ) && scene.clock.set(new Date(AT.getTime() + days * 24 * 3600_000))
      const page = async () => {
        const viewed = await scene.view({ token })
        return viewed.ok && viewed.value.rsvp.absentNoteAvailable
      }

      closed(3)
      expect(await page()).toBe(true)
      closed(8)
      expect(await page()).toBe(false)
    })
  })
})
