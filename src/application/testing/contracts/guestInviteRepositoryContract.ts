import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { DEFAULT_RSVP_SETTINGS } from '../../../domain/guestRsvps/rsvpSettings'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { asEventId } from '../../../domain/shared/ids'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import { AT, aGuestInvite } from '../builders'

/**
 * The behaviour every `GuestInviteRepository` must have, run against the fake **and** SQLite:
 * one invitation per event, found by event or by token, replaced by a save, and a token that two
 * events never share. A fake that answered another event's invitation would make every ring-2
 * test about the public page prove the opposite of what production does.
 */

/** Rows the SQLite harness must create before the contract runs; the fake ignores them. */
export const GUEST_INVITE_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-host'],
} as const

export interface GuestInviteRepositorySubject {
  readonly repo: GuestInviteRepository
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const LATER = new Date('2026-11-22T10:00:00Z')

const tokenOf = (byte: number): GuestInviteToken => {
  const made = GuestInviteToken.fromBytes(new Uint8Array(16).fill(byte))
  if (!made.ok) throw new Error('token')
  return made.value
}

export const guestInviteRepositoryContract = (
  name: string,
  makeSubject: () => Promise<GuestInviteRepositorySubject>,
): void => {
  describe(`GuestInviteRepository contract: ${name}`, () => {
    let subject: GuestInviteRepositorySubject
    let repo: GuestInviteRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
    })

    it('has no invitation until one is created', async () => {
      expect(await repo.findByEvent(WEDDING)).toBeNull()
      expect(await repo.findByToken(tokenOf(1))).toBeNull()
    })

    it('keeps everything a creation wrote, to the letter', async () => {
      const invite = aGuestInvite({
        eventId: 'evt-wedding',
        enabled: true,
        title: 'Léa fête ses 40 ans',
        startsAt: '2026-12-13T18:00:00Z',
        endsAt: '2026-12-14T02:00:00Z',
        timeZone: 'Europe/Paris',
        venueName: 'Salle des fêtes',
        address: '1 rue de la Gare\n22100 Plouër',
        message: 'Venez comme vous êtes.\nOn mange à 20 h.',
        language: 'de',
      })

      await repo.create(invite)
      const read = await repo.findByEvent(WEDDING)

      expect(read?.enabled).toBe(true)
      expect(read?.token.value).toBe(invite.token.value)
      expect(read?.content).toEqual(invite.content)
      expect(read?.updatedAt.toISOString()).toBe(invite.updatedAt.toISOString())
    })

    it('keeps a blank, switched-off invitation with its nulls', async () => {
      await repo.create(aGuestInvite({ eventId: 'evt-wedding' }))

      const read = await repo.findByEvent(WEDDING)

      expect(read?.enabled).toBe(false)
      expect(read?.content).toMatchObject({
        title: null,
        startsAt: null,
        endsAt: null,
        timeZone: null,
        venueName: null,
        address: null,
        message: null,
        language: 'fr',
      })
    })

    it('finds an invitation by its token, switched on or not', async () => {
      await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 7 }))

      const read = await repo.findByToken(tokenOf(7))

      expect(read?.eventId).toBe(WEDDING)
      expect(await repo.findByToken(tokenOf(8))).toBeNull()
    })

    it('never answers the invitation of another event', async () => {
      await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Mariage' }))
      await repo.create(aGuestInvite({ eventId: 'evt-gala', tokenByte: 2, title: 'Gala' }))

      expect((await repo.findByEvent(WEDDING))?.content.title).toBe('Mariage')
      expect((await repo.findByEvent(GALA))?.content.title).toBe('Gala')
      expect((await repo.findByToken(tokenOf(2)))?.eventId).toBe(GALA)
    })

    it('refuses a second invitation for the same event', async () => {
      await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1 }))

      await expect(
        repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 2 })),
      ).rejects.toThrow(/UNIQUE/)

      expect((await repo.findByEvent(WEDDING))?.token.value).toBe(tokenOf(1).value)
    })

    it('refuses a token another event already holds, on creation and on rotation', async () => {
      await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1 }))

      await expect(
        repo.create(aGuestInvite({ eventId: 'evt-gala', tokenByte: 1 })),
      ).rejects.toThrow(/UNIQUE/)
      expect(await repo.findByEvent(GALA)).toBeNull()

      await repo.create(aGuestInvite({ eventId: 'evt-gala', tokenByte: 2 }))
      await expect(repo.rotateToken(GALA, tokenOf(1), AT)).rejects.toThrow(/UNIQUE/)
      expect((await repo.findByEvent(GALA))?.token.value).toBe(tokenOf(2).value)
      expect((await repo.findByToken(tokenOf(1)))?.eventId).toBe(WEDDING)
    })

    it('rotates the token: the old one stops answering and the rest is untouched', async () => {
      await repo.create(
        aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Avant', enabled: true }),
      )

      await repo.rotateToken(WEDDING, tokenOf(2), LATER)

      expect(await repo.findByToken(tokenOf(1))).toBeNull()
      const read = await repo.findByToken(tokenOf(2))
      expect(read?.eventId).toBe(WEDDING)
      expect(read?.content.title).toBe('Avant')
      expect(read?.enabled).toBe(true)
      expect(read?.updatedAt.toISOString()).toBe(LATER.toISOString())
    })

    it('switches the link on and off without touching the text or the token', async () => {
      await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Avant' }))

      await repo.setEnabled(WEDDING, true, LATER)
      expect((await repo.findByEvent(WEDDING))?.enabled).toBe(true)
      await repo.setEnabled(WEDDING, false, LATER)

      const read = await repo.findByEvent(WEDDING)
      expect(read?.enabled).toBe(false)
      expect(read?.content.title).toBe('Avant')
      expect(read?.token.value).toBe(tokenOf(1).value)
    })

    it('saves the content and only the content, whatever the invitation it is given had read', async () => {
      const stale = aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Avant' })
      await repo.create(stale)
      // Somebody switches the link on and changes it after `stale` was read.
      await repo.setEnabled(WEDDING, true, LATER)
      await repo.rotateToken(WEDDING, tokenOf(2), LATER)

      const edited = stale.withContent({ title: 'Après', message: 'Venez' }, LATER)
      if (!edited.ok) throw new Error('edit')
      await repo.saveContent(edited.value)

      const read = await repo.findByEvent(WEDDING)
      expect(read?.content).toMatchObject({ title: 'Après', message: 'Venez' })
      expect(read?.enabled).toBe(true)
      expect(read?.token.value).toBe(tokenOf(2).value)
      expect(read?.updatedAt.toISOString()).toBe(LATER.toISOString())
    })

    describe('the replies settings (spec 30)', () => {
      const SETTINGS = {
        enabled: true,
        deadline: '2026-12-05',
        closedAt: null,
        form: { ...DEFAULT_RSVP_FORM, maybe: false, partySize: { enabled: true, max: 7 } },
      } as const

      it('has none for an event with no invitation, and the defaults for one that saved none', async () => {
        expect(await repo.findRsvpSettings(WEDDING)).toBeNull()

        await repo.create(aGuestInvite({ eventId: 'evt-wedding' }))

        expect(await repo.findRsvpSettings(WEDDING)).toEqual(DEFAULT_RSVP_SETTINGS)
      })

      it('keeps the switch, the deadline and the form to the letter', async () => {
        await repo.create(aGuestInvite({ eventId: 'evt-wedding' }))

        await repo.saveRsvpSettings(WEDDING, SETTINGS)

        expect(await repo.findRsvpSettings(WEDDING)).toEqual(SETTINGS)
      })

      it('closes and reopens without touching the rest, and a save does not lift the closing', async () => {
        await repo.create(aGuestInvite({ eventId: 'evt-wedding' }))
        await repo.saveRsvpSettings(WEDDING, SETTINGS)

        await repo.setRsvpClosedAt(WEDDING, LATER)
        await repo.saveRsvpSettings(WEDDING, {
          ...SETTINGS,
          deadline: '2026-12-06',
          closedAt: null,
        })

        const closed = await repo.findRsvpSettings(WEDDING)
        expect(closed?.closedAt?.toISOString()).toBe(LATER.toISOString())
        expect(closed?.deadline).toBe('2026-12-06')
        expect(closed?.form).toEqual(SETTINGS.form)

        await repo.setRsvpClosedAt(WEDDING, null)
        expect(await repo.findRsvpSettings(WEDDING)).toEqual({
          ...SETTINGS,
          deadline: '2026-12-06',
        })
      })

      it('touches neither the text, nor the token, nor the invitation switch, nor its date', async () => {
        await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Avant' }))
        const before = await repo.findByEvent(WEDDING)

        await repo.saveRsvpSettings(WEDDING, SETTINGS)
        await repo.setRsvpClosedAt(WEDDING, LATER)

        const after = await repo.findByEvent(WEDDING)
        expect(after?.content).toEqual(before?.content)
        expect(after?.enabled).toBe(false)
        expect(after?.token.value).toBe(before?.token.value)
        expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString())
      })

      it('keeps the settings of each event apart', async () => {
        await repo.create(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1 }))
        await repo.create(aGuestInvite({ eventId: 'evt-gala', tokenByte: 2 }))

        await repo.saveRsvpSettings(WEDDING, SETTINGS)
        await repo.setRsvpClosedAt(WEDDING, LATER)

        expect(await repo.findRsvpSettings(GALA)).toEqual(DEFAULT_RSVP_SETTINGS)
      })

      it('writes nothing for an event that has no invitation', async () => {
        await repo.saveRsvpSettings(WEDDING, SETTINGS)
        await repo.setRsvpClosedAt(WEDDING, LATER)

        expect(await repo.findRsvpSettings(WEDDING)).toBeNull()
      })
    })

    it('does nothing for an event that has no invitation, whichever write it is', async () => {
      await repo.saveContent(aGuestInvite({ eventId: 'evt-wedding', title: 'Fantôme' }))
      await repo.setEnabled(WEDDING, true, LATER)
      await repo.rotateToken(WEDDING, tokenOf(3), LATER)

      expect(await repo.findByEvent(WEDDING)).toBeNull()
      expect(await repo.findByToken(tokenOf(3))).toBeNull()
    })
  })
}
