import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { UserRepository } from '../../ports/userRepository'
import { AT, aUser, atPlus } from '../builders'

/**
 * The shared `UserRepository` contract.
 *
 * Accounts are not event-scoped — one host runs several weddings — so there is no
 * cross-event case here. What has to behave is the unique email index and the
 * case-folding underneath it: two accounts differing only in capitalisation are the
 * same account, and `isEmpty` decides whether first-run bootstrap creates an owner at
 * all. 1.0 recreated `admin` / `password` on every boot; getting `isEmpty` wrong is how
 * that comes back.
 *
 * The other thing that has to behave identically in both implementations is
 * `siteRoleFor`, which is the read every operator-only route is gated on. A fake that
 * answered `operator` where SQLite answers `none` — for a disabled account, say — would
 * make the ring-2 and ring-4 suites agree with each other about a box neither of them
 * describes.
 *
 * Nothing needs seeding before this suite runs: `users` has no outbound foreign key.
 */

const email = (value: string): EmailAddress => {
  const parsed = EmailAddress.create(value)
  if (!parsed.ok) throw new Error(`invalid fixture email: ${value}`)
  return parsed.value
}

export const userRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: UserRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`UserRepository contract: ${name}`, () => {
    let repo: UserRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    // ------------------------------------------------------------ round trip --

    it('round-trips every field of a saved account', async () => {
      await repo.save(
        aUser({
          id: 'user-host',
          email: 'hote@example.test',
          displayName: 'Camille',
          passwordHash: 'hash:un-mot-de-passe-solide',
          createdAt: atPlus(1_000),
          lastLoginAt: atPlus(2_000),
          mustChangePassword: true,
          disabledAt: atPlus(3_000),
          siteRole: 'operator',
        }),
      )

      const stored = await repo.findById(asUserId('user-host'))

      expect(stored?.email.value).toBe('hote@example.test')
      expect(stored?.displayName).toBe('Camille')
      expect(stored?.passwordHash).toBe('hash:un-mot-de-passe-solide')
      expect(stored?.createdAt.toISOString()).toBe(atPlus(1_000).toISOString())
      expect(stored?.lastLoginAt?.toISOString()).toBe(atPlus(2_000).toISOString())
      expect(stored?.mustChangePassword).toBe(true)
      expect(stored?.disabledAt?.toISOString()).toBe(atPlus(3_000).toISOString())
      expect(stored?.siteRole).toBe('operator')
    })

    it('round-trips an account that has never signed in as three nulls and a false', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      const stored = await repo.findById(asUserId('user-host'))

      expect(stored?.displayName).toBeNull()
      expect(stored?.lastLoginAt).toBeNull()
      expect(stored?.disabledAt).toBeNull()
      expect(stored?.mustChangePassword).toBe(false)
      expect(stored?.siteRole).toBe('none')
    })

    // ------------------------------------------------------------- site role --

    /**
     * The read `requireOperator` makes on every request to an operator's own surface.
     *
     * Four cases and not one, because three of them are refusals that have to be
     * indistinguishable: an ordinary account, an account that is gone, and an account
     * somebody switched off all answer `none`. Getting the last one wrong would leave a
     * dismissed operator running the box from a session nobody can see.
     */
    it('reports the site role an account was created with', async () => {
      await repo.save(aUser({ id: 'user-operator', siteRole: 'operator' }))

      expect(await repo.siteRoleFor(asUserId('user-operator'))).toBe('operator')
    })

    it('reports none for an ordinary account, which is every account by default', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      expect(await repo.siteRoleFor(asUserId('user-host'))).toBe('none')
    })

    it('reports none for an account that does not exist, so a stale session grants nothing', async () => {
      expect(await repo.siteRoleFor(asUserId('nobody'))).toBe('none')
    })

    it('reports none for a disabled operator, because a switched-off account operates nothing', async () => {
      await repo.save(
        aUser({ id: 'user-operator', siteRole: 'operator', disabledAt: atPlus(4_000) }),
      )

      expect(await repo.siteRoleFor(asUserId('user-operator'))).toBe('none')
    })

    it('still hydrates the stored role of a disabled operator, which is a different question', async () => {
      // `siteRoleFor` answers "may this account act"; `findById` answers "what does the
      // row say". Collapsing the two would make re-enabling an account silently demote it
      // the next time anything saved it.
      await repo.save(
        aUser({ id: 'user-operator', siteRole: 'operator', disabledAt: atPlus(4_000) }),
      )

      expect((await repo.findById(asUserId('user-operator')))?.siteRole).toBe('operator')
    })

    // ----------------------------------------------------------- may it act --

    /**
     * The read the two routes that are not event-scoped make: `POST /api/events` and
     * `POST /api/auth/password` ask nothing about an event, so no role lookup would ever
     * notice that the account behind the session has been switched off. The same three
     * answers collapse as they do for `siteRoleFor` — gone and disabled are both `false`.
     */
    it('reports an ordinary account as active', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      expect(await repo.isActive(asUserId('user-host'))).toBe(true)
    })

    it('reports a disabled account as inactive, so its open tab stops creating events', async () => {
      await repo.save(aUser({ id: 'user-host', disabledAt: atPlus(4_000) }))

      expect(await repo.isActive(asUserId('user-host'))).toBe(false)
    })

    it('reports an account that does not exist as inactive, so a session outliving it grants nothing', async () => {
      expect(await repo.isActive(asUserId('nobody'))).toBe(false)
    })

    it('reports an account as active again once it is enabled', async () => {
      const user = aUser({ id: 'user-host' })
      await repo.save(user.disable(AT))

      await repo.save(user.disable(AT).enable())

      expect(await repo.isActive(asUserId('user-host'))).toBe(true)
    })

    it('replaces the stored row when the same account is saved again', async () => {
      const user = aUser({ id: 'user-host' })
      await repo.save(user)

      await repo.save(user.recordLogin(atPlus(5_000)))

      const stored = await repo.findById(asUserId('user-host'))
      expect(stored?.lastLoginAt?.toISOString()).toBe(atPlus(5_000).toISOString())
    })

    it('persists a disabled account rather than dropping it', async () => {
      const user = aUser({ id: 'user-host' })
      await repo.save(user)

      await repo.save(user.disable(AT))

      expect((await repo.findById(asUserId('user-host')))?.canSignIn()).toBe(false)
    })

    // --------------------------------------------------------------- lookups --

    it('returns null for a user id that does not exist', async () => {
      expect(await repo.findById(asUserId('nope'))).toBeNull()
    })

    it('resolves an account by email', async () => {
      await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))

      expect((await repo.findByEmail(email('hote@example.test')))?.id).toBe('user-host')
    })

    it('resolves an account whatever case the host typed at the login form', async () => {
      await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))

      expect((await repo.findByEmail(email('Hote@Example.TEST')))?.id).toBe('user-host')
    })

    it('returns null for an email no account holds', async () => {
      expect(await repo.findByEmail(email('personne@example.test'))).toBeNull()
    })

    // ------------------------------------------------------------ uniqueness --

    it('refuses a second account with an email another account holds', async () => {
      await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))

      await expect(
        repo.save(aUser({ id: 'user-mod', email: 'hote@example.test' })),
      ).rejects.toThrow()
    })

    it('refuses a second account differing from the first only in case', async () => {
      await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))

      await expect(
        repo.save(aUser({ id: 'user-mod', email: 'HOTE@EXAMPLE.TEST' })),
      ).rejects.toThrow()
    })

    it('lets an account keep its own email across a save', async () => {
      const user = aUser({ id: 'user-host', email: 'hote@example.test' })
      await repo.save(user)

      await expect(repo.save(user)).resolves.toBeUndefined()
    })

    // ------------------------------------------------------------- bootstrap --

    it('reports an empty database as empty', async () => {
      expect(await repo.isEmpty()).toBe(true)
    })

    it('reports a database with one account as not empty', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      expect(await repo.isEmpty()).toBe(false)
    })

    it('counts a disabled account, so bootstrap never recreates an owner beside it', async () => {
      await repo.save(aUser({ id: 'user-host', disabledAt: AT }))

      expect(await repo.isEmpty()).toBe(false)
    })

    it('reports empty again once the last account is deleted', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      await repo.delete(asUserId('user-host'))

      expect(await repo.isEmpty()).toBe(true)
    })

    // ---------------------------------------------------------------- delete --

    it('deletes an account', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      await repo.delete(asUserId('user-host'))

      expect(await repo.findById(asUserId('user-host'))).toBeNull()
    })

    it('is idempotent on delete', async () => {
      await repo.save(aUser({ id: 'user-host' }))
      await repo.delete(asUserId('user-host'))

      await expect(repo.delete(asUserId('user-host'))).resolves.toBeUndefined()
    })

    it('frees the email of a deleted account', async () => {
      await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))
      await repo.delete(asUserId('user-host'))

      await repo.save(aUser({ id: 'user-mod', email: 'hote@example.test' }))

      expect((await repo.findByEmail(email('hote@example.test')))?.id).toBe('user-mod')
    })
  })
}
