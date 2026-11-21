import { beforeEach, describe, expect, it } from 'vitest'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { asEventId } from '../../../domain/shared/ids'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import { aGuestInvite } from '../builders'

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

    it('has no invitation until one is saved', async () => {
      expect(await repo.findByEvent(WEDDING)).toBeNull()
      expect(await repo.findByToken(tokenOf(1))).toBeNull()
    })

    it('keeps everything a save wrote, to the letter', async () => {
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

      await repo.save(invite)
      const read = await repo.findByEvent(WEDDING)

      expect(read?.enabled).toBe(true)
      expect(read?.token.value).toBe(invite.token.value)
      expect(read?.content).toEqual(invite.content)
      expect(read?.updatedAt.toISOString()).toBe(invite.updatedAt.toISOString())
    })

    it('keeps a blank, switched-off invitation with its nulls', async () => {
      await repo.save(aGuestInvite({ eventId: 'evt-wedding' }))

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
      await repo.save(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 7 }))

      const read = await repo.findByToken(tokenOf(7))

      expect(read?.eventId).toBe(WEDDING)
      expect(await repo.findByToken(tokenOf(8))).toBeNull()
    })

    it('replaces the event row on a second save, and the old token stops answering', async () => {
      const first = aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Avant' })
      await repo.save(first)
      const rotated = first.rotate(tokenOf(2), new Date('2026-11-22T10:00:00Z'))

      await repo.save(rotated)

      expect((await repo.findByEvent(WEDDING))?.token.value).toBe(tokenOf(2).value)
      expect(await repo.findByToken(tokenOf(1))).toBeNull()
      expect((await repo.findByToken(tokenOf(2)))?.content.title).toBe('Avant')
    })

    it('never answers the invitation of another event', async () => {
      await repo.save(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1, title: 'Mariage' }))
      await repo.save(aGuestInvite({ eventId: 'evt-gala', tokenByte: 2, title: 'Gala' }))

      expect((await repo.findByEvent(WEDDING))?.content.title).toBe('Mariage')
      expect((await repo.findByEvent(GALA))?.content.title).toBe('Gala')
      expect((await repo.findByToken(tokenOf(2)))?.eventId).toBe(GALA)
    })

    it('refuses a token another event already holds, and leaves both rows as they were', async () => {
      await repo.save(aGuestInvite({ eventId: 'evt-wedding', tokenByte: 1 }))

      await expect(repo.save(aGuestInvite({ eventId: 'evt-gala', tokenByte: 1 }))).rejects.toThrow(
        /UNIQUE/,
      )

      expect(await repo.findByEvent(GALA)).toBeNull()
      expect((await repo.findByToken(tokenOf(1)))?.eventId).toBe(WEDDING)
    })
  })
}
