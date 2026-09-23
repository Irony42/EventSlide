import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asShareLinkId } from '../../../domain/shared/ids'
import type { ShareLinkRepository } from '../../ports/shareLinkRepository'
import { AT, aShareLink, atPlus } from '../builders'

/**
 * The behaviour every `ShareLinkRepository` must have, run against the fake **and**
 * against SQLite.
 *
 * Most of it is about the two rules the schema enforces and a fake could forget: one
 * current link per event, and one link per token digest. A critical bug shipped in this
 * repository once because a fake accepted what a UNIQUE index refused, so both are asked
 * here of both implementations rather than of SQLite alone.
 */

/**
 * The rows both implementations need before the contract runs. SQLite's foreign keys
 * point at `events` and `users`; the fake ignores them.
 */
export const SHARE_LINK_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-1'],
} as const

export interface ShareLinkRepositorySubject {
  readonly repo: ShareLinkRepository
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const HOUR = 60 * 60 * 1000

export const shareLinkRepositoryContract = (
  name: string,
  makeSubject: () => Promise<ShareLinkRepositorySubject>,
): void => {
  describe(`ShareLinkRepository contract: ${name}`, () => {
    let subject: ShareLinkRepositorySubject
    let repo: ShareLinkRepository

    beforeEach(async () => {
      subject = await makeSubject()
      repo = subject.repo
      return async () => {
        await subject.dispose?.()
      }
    })

    it('finds a link by the digest of its token, with every field intact', async () => {
      const link = aShareLink({
        id: 'link-1',
        eventId: 'evt-wedding',
        passwordHash: 'hash:un-mot-de-passe-long',
        lifetimeDays: 7,
      })
      await repo.replaceCurrent(link, AT)

      const found = await repo.findByTokenDigest(link.tokenDigest)

      expect(found?.toProps()).toEqual(link.toProps())
    })

    it('finds nothing for a digest it was never given', async () => {
      await repo.replaceCurrent(aShareLink({ id: 'link-1', eventId: 'evt-wedding' }), AT)

      expect(await repo.findByTokenDigest('f'.repeat(64))).toBeNull()
    })

    it('finds a link by its id, which is what a signed media URL names', async () => {
      const link = aShareLink({ id: 'link-1', eventId: 'evt-wedding' })
      await repo.replaceCurrent(link, AT)

      expect((await repo.findById(asShareLinkId('link-1')))?.eventId).toBe(WEDDING)
      expect(await repo.findById(asShareLinkId('link-nope'))).toBeNull()
    })

    it('answers the current link of the event asked about, and of no other', async () => {
      await repo.replaceCurrent(aShareLink({ id: 'link-w', eventId: 'evt-wedding' }), AT)
      await repo.replaceCurrent(aShareLink({ id: 'link-g', eventId: 'evt-gala' }), AT)

      expect((await repo.findCurrent(WEDDING))?.id).toBe('link-w')
      expect((await repo.findCurrent(GALA))?.id).toBe('link-g')
    })

    it('still answers an expired link as current, so the host is told it expired', async () => {
      const link = aShareLink({ id: 'link-1', eventId: 'evt-wedding', lifetimeDays: 1 })
      await repo.replaceCurrent(link, AT)

      const current = await repo.findCurrent(WEDDING)

      expect(current?.id).toBe('link-1')
      expect(current?.isOpenAt(atPlus(48 * HOUR))).toBe(false)
    })

    it('revokes the previous link in the same act that makes a new one current', async () => {
      await repo.replaceCurrent(aShareLink({ id: 'link-old', eventId: 'evt-wedding' }), AT)

      await repo.replaceCurrent(
        aShareLink({ id: 'link-new', eventId: 'evt-wedding' }),
        atPlus(HOUR),
      )

      expect((await repo.findCurrent(WEDDING))?.id).toBe('link-new')
      const old = await repo.findById(asShareLinkId('link-old'))
      expect(old?.revokedAt).toEqual(atPlus(HOUR))
      // The old token no longer opens anything, and is still recognisable as revoked
      // rather than as unknown — the use case answers both the same way, on purpose.
      expect((await repo.findByTokenDigest(old?.tokenDigest ?? ''))?.revokedAt).toEqual(
        atPlus(HOUR),
      )
    })

    it('leaves another event’s link alone when replacing one', async () => {
      await repo.replaceCurrent(aShareLink({ id: 'link-g', eventId: 'evt-gala' }), AT)

      await repo.replaceCurrent(aShareLink({ id: 'link-w', eventId: 'evt-wedding' }), AT)

      expect((await repo.findById(asShareLinkId('link-g')))?.revokedAt).toBeNull()
    })

    it('refuses a second link with the same token digest, and keeps the first current', async () => {
      const first = aShareLink({
        id: 'link-1',
        eventId: 'evt-wedding',
        tokenDigest: 'c'.repeat(64),
      })
      await repo.replaceCurrent(first, AT)

      await expect(
        repo.replaceCurrent(
          aShareLink({ id: 'link-2', eventId: 'evt-gala', tokenDigest: 'c'.repeat(64) }),
          AT,
        ),
      ).rejects.toThrow(/UNIQUE/)
      expect((await repo.findCurrent(WEDDING))?.id).toBe('link-1')
      expect(await repo.findCurrent(GALA)).toBeNull()
    })

    it('rolls a refused replacement back, so the old link is still the current one', async () => {
      await repo.replaceCurrent(
        aShareLink({ id: 'link-g', eventId: 'evt-gala', tokenDigest: 'd'.repeat(64) }),
        AT,
      )
      await repo.replaceCurrent(aShareLink({ id: 'link-w', eventId: 'evt-wedding' }), AT)

      await expect(
        repo.replaceCurrent(
          aShareLink({ id: 'link-w2', eventId: 'evt-wedding', tokenDigest: 'd'.repeat(64) }),
          atPlus(HOUR),
        ),
      ).rejects.toThrow(/UNIQUE/)

      const current = await repo.findCurrent(WEDDING)
      expect(current?.id).toBe('link-w')
      expect(current?.revokedAt).toBeNull()
    })

    it('revokes the current link and answers it', async () => {
      await repo.replaceCurrent(aShareLink({ id: 'link-1', eventId: 'evt-wedding' }), AT)

      const revoked = await repo.revokeCurrent(WEDDING, atPlus(HOUR))

      expect(revoked?.id).toBe('link-1')
      expect(revoked?.revokedAt).toEqual(atPlus(HOUR))
      expect(await repo.findCurrent(WEDDING)).toBeNull()
      expect((await repo.findById(asShareLinkId('link-1')))?.revokedAt).toEqual(atPlus(HOUR))
    })

    it('answers null when there is nothing to revoke', async () => {
      expect(await repo.revokeCurrent(WEDDING, AT)).toBeNull()
    })

    it('revokes only the event asked about', async () => {
      await repo.replaceCurrent(aShareLink({ id: 'link-g', eventId: 'evt-gala' }), AT)

      expect(await repo.revokeCurrent(WEDDING, AT)).toBeNull()
      expect((await repo.findCurrent(GALA))?.id).toBe('link-g')
    })
  })
}
