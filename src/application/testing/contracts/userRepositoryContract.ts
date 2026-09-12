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
    })

    it('round-trips an account that has never signed in as three nulls and a false', async () => {
      await repo.save(aUser({ id: 'user-host' }))

      const stored = await repo.findById(asUserId('user-host'))

      expect(stored?.displayName).toBeNull()
      expect(stored?.lastLoginAt).toBeNull()
      expect(stored?.disabledAt).toBeNull()
      expect(stored?.mustChangePassword).toBe(false)
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
