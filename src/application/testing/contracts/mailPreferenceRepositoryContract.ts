import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { MailPreferenceRepository } from '../../ports/mailPreferenceRepository'
import { AT, atPlus } from '../builders'

/**
 * The shared `MailPreferenceRepository` contract, run against the fake and the SQLite adapter. Both seed
 * {@link MAIL_PREFERENCE_CONTRACT_FIXTURES}: two accounts, one event, and a membership for each account.
 */
export const MAIL_PREFERENCE_CONTRACT_FIXTURES = {
  eventId: 'event-1',
  otherEventId: 'event-2',
  userIds: ['user-a', 'user-b'],
} as const

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')
const A = asUserId('user-a')
const B = asUserId('user-b')
const GHOST = asUserId('nobody')

export const mailPreferenceRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: MailPreferenceRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`MailPreferenceRepository contract: ${name}`, () => {
    let repo: MailPreferenceRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    it('has both switches on for an account that never touched them', async () => {
      expect(await repo.forUser(A)).toEqual({ rsvp: true, event: true })
    })

    it('has both switches on for an account it does not know', async () => {
      expect(await repo.forUser(GHOST)).toEqual({ rsvp: true, event: true })
    })

    it('remembers the switches an account set, for that account only', async () => {
      await repo.save(A, { rsvp: false, event: true })

      expect(await repo.forUser(A)).toEqual({ rsvp: false, event: true })
      expect(await repo.forUser(B)).toEqual({ rsvp: true, event: true })
    })

    it('replaces both switches at once', async () => {
      await repo.save(A, { rsvp: false, event: false })
      await repo.save(A, { rsvp: true, event: false })

      expect(await repo.forUser(A)).toEqual({ rsvp: true, event: false })
    })

    it('records nothing for an account that does not exist', async () => {
      await repo.save(GHOST, { rsvp: false, event: false })

      expect(await repo.forUser(GHOST)).toEqual({ rsvp: true, event: true })
    })

    it('has no digest for an owner who never ticked it', async () => {
      expect(await repo.digestFor(EVENT, A)).toEqual({ on: false, lastAt: null })
    })

    it('ticks and unticks the digest for one owner of one event', async () => {
      await repo.setDigest(EVENT, A, true)

      expect(await repo.digestFor(EVENT, A)).toEqual({ on: true, lastAt: null })
      expect(await repo.digestFor(EVENT, B)).toEqual({ on: false, lastAt: null })
      expect(await repo.digestFor(OTHER_EVENT, A)).toEqual({ on: false, lastAt: null })

      await repo.setDigest(EVENT, A, false)
      expect(await repo.digestFor(EVENT, A)).toEqual({ on: false, lastAt: null })
    })

    it('has no digest and records none for a membership that does not exist', async () => {
      await repo.setDigest(EVENT, GHOST, true)

      expect(await repo.digestFor(EVENT, GHOST)).toEqual({ on: false, lastAt: null })
      expect(await repo.claimDigest(EVENT, GHOST, null, AT)).toBe(false)
    })

    it('claims the digest when the last one is still what the caller read, and says when', async () => {
      expect(await repo.claimDigest(EVENT, A, null, AT)).toBe(true)
      expect((await repo.digestFor(EVENT, A)).lastAt).toEqual(AT)

      expect(await repo.claimDigest(EVENT, A, AT, atPlus(86_400_000))).toBe(true)
      expect((await repo.digestFor(EVENT, A)).lastAt).toEqual(atPlus(86_400_000))
    })

    it('lets one of two callers claim the same digest: the winner sends', async () => {
      const results = await Promise.all([
        repo.claimDigest(EVENT, A, null, AT),
        repo.claimDigest(EVENT, A, null, atPlus(1000)),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it('refuses a claim made against a stale reading, either way', async () => {
      await repo.claimDigest(EVENT, A, null, AT)

      expect(await repo.claimDigest(EVENT, A, null, atPlus(1000))).toBe(false)
      expect(await repo.claimDigest(EVENT, A, atPlus(1), atPlus(1000))).toBe(false)
      expect((await repo.digestFor(EVENT, A)).lastAt).toEqual(AT)
    })

    it('keeps the claim when the owner unticks and ticks the digest again', async () => {
      await repo.claimDigest(EVENT, A, null, AT)

      await repo.setDigest(EVENT, A, true)
      await repo.setDigest(EVENT, A, false)

      expect((await repo.digestFor(EVENT, A)).lastAt).toEqual(AT)
    })
  })
}
