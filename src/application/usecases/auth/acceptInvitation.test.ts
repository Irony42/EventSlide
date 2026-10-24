import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { aUser, anEvent, atPlus } from '../../testing/builders'
import {
  EVENT_ID,
  EXISTING_EMAIL,
  EXISTING_ID,
  CLIENT_ID,
  HOST_ID,
  NEWCOMER,
  makeInvitationWorld,
  type InvitationWorld,
} from '../../testing/invitationWorld'
import type { EventRepository } from '../../ports/eventRepository'
import type { InvitationAcceptance } from '../../ports/invitationAcceptance'
import type { PasswordHasher } from '../../ports/passwordHasher'
import { makeAcceptInvitation, type AcceptInvitation } from './acceptInvitation'
import { FakePasswordHasher } from '../../testing/fakePasswordHasher'

const emailOf = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error('invalid fixture')
  return parsed.value
}

const PASSWORD = 'un mot de passe solide 2026'
const credentials = { password: PASSWORD, displayName: 'Camille Dupont' }

describe('acceptInvitation', () => {
  let world: InvitationWorld
  let accept: AcceptInvitation

  const build = (acceptance: InvitationAcceptance = world.acceptance) =>
    makeAcceptInvitation({
      tokens: world.tokens,
      secrets: world.secrets,
      events: world.events,
      clients: world.clients,
      memberships: world.memberships,
      users: world.users,
      hasher: world.hasher,
      acceptance,
      ids: world.ids,
      clock: world.clock,
    })

  const accountAt = (email: string) => world.users.findByEmail(emailOf(email))

  beforeEach(() => {
    world = makeInvitationWorld()
    accept = build()
  })

  // ------------------------------------------------- a person with no account --

  describe('choosing a password for an address that has no account', () => {
    it('creates the account at the address the link was written to, with the name and password chosen', async () => {
      const { token } = await world.invite()

      const result = await accept({ token, credentials })

      const account = await accountAt(NEWCOMER)
      expect(result.ok && result.value.userId).toBe(account?.id)
      expect(account?.email.value).toBe(NEWCOMER)
      expect(account?.displayName).toBe('Camille Dupont')
      expect(account?.passwordHash).toBe(`hash:${PASSWORD}`)
      expect(account?.createdAt).toEqual(world.clock.now())
    })

    it("answers with the address the account was made for, which is the link's and not the request's", async () => {
      const { token } = await world.invite()

      const result = await accept({ token, credentials })

      expect(result.ok && result.value.email).toBe(NEWCOMER)
    })

    it('makes the password the person chose the one they keep: nothing forces them to change it', async () => {
      const { token } = await world.invite()
      await accept({ token, credentials })

      expect((await accountAt(NEWCOMER))?.mustChangePassword).toBe(false)
    })

    it('gives the account no authority over the box, even when the person who invited has it', async () => {
      await world.users.save(
        aUser({ id: HOST_ID, email: 'hote@example.test', siteRole: 'operator' }),
      )
      const { token } = await world.invite()

      await accept({ token, credentials })

      expect((await accountAt(NEWCOMER))?.siteRole).toBe('none')
    })

    it('grants moderation of the event the link was to, and says where that is', async () => {
      const { token } = await world.invite()

      const result = await accept({ token, credentials })

      const account = await accountAt(NEWCOMER)
      expect((await world.memberships.membershipFor(asEventId(EVENT_ID), account!.id))?.role).toBe(
        'moderator',
      )
      expect(result.ok && result.value).toMatchObject({
        target: { kind: 'event', role: 'moderator' },
        place: { kind: 'event', slug: 'mariage-de-camille', name: 'Mariage de Camille' },
      })
    })

    it.each([
      ['owner', 'client-owner'],
      ['member', 'client-member'],
    ] as const)('makes the account the %s of the client the link was to', async (role, to) => {
      const { token } = await world.invite({ to })

      const result = await accept({ token, credentials })

      const account = await accountAt(NEWCOMER)
      expect(await world.clients.memberRole(asClientId('client-1'), account!.id)).toBe(role)
      expect(result.ok && result.value.place).toEqual({ kind: 'client', name: 'Camille et Sacha' })
      // A client's owner is not a moderator of anything by being one.
      expect(await world.memberships.membershipFor(asEventId(EVENT_ID), account!.id)).toBeNull()
    })

    it('spends the link: it cannot be used a second time, by anybody', async () => {
      const { token } = await world.invite()
      await accept({ token, credentials })

      const again = await accept({
        token,
        credentials: { ...credentials, password: 'un autre mot de passe 2026' },
      })

      expect(!again.ok && again.error.code).toBe('invitation.notFound')
      expect((await accountAt(NEWCOMER))?.passwordHash).toBe(`hash:${PASSWORD}`)
    })

    it('of two simultaneous acceptances lets exactly one win', async () => {
      const { token } = await world.invite()

      const results = await Promise.all([
        accept({ token, credentials }),
        accept({ token, credentials: { ...credentials, displayName: 'Intrus' } }),
        accept({ token, credentials: { ...credentials, displayName: 'Autre intrus' } }),
      ])

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      const losers = results.filter((result) => !result.ok)
      expect(losers.map((result) => !result.ok && result.error.code)).toEqual([
        'invitation.notFound',
        'invitation.notFound',
      ])
    })
  })

  // ------------------------------------------- what it never does to a stranger --

  describe('what a refusal says about who is on the box', () => {
    it.each([
      ['a password the policy refuses', () => ({ password: 'court', displayName: 'Camille' })],
      [
        'a password built from the address it is for',
        (address: string) => ({ password: address, displayName: 'Camille' }),
      ],
      ['an empty name', () => ({ password: PASSWORD, displayName: '   ' })],
    ])(
      'is the same for %s whether or not the address has an account, so a link holder learns nothing',
      async (_label, bad) => {
        const free = await world.invite({ email: NEWCOMER })
        const taken = await world.invite({ email: EXISTING_EMAIL })

        const forFree = await accept({ token: free.token, credentials: bad(NEWCOMER) })
        const forTaken = await accept({ token: taken.token, credentials: bad(EXISTING_EMAIL) })

        expect(forFree.ok).toBe(false)
        expect(!forTaken.ok && forTaken.error.code).toBe(!forFree.ok && forFree.error.code)
        expect(!forTaken.ok && forTaken.error.kind).toBe(!forFree.ok && forFree.error.kind)
      },
    )

    it('says the address is taken only to somebody who presents a name and a password the policy accepts', async () => {
      const taken = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token: taken.token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.signInRequired')
    })
  })

  describe('the moment an account first exists', () => {
    it('is the moment of acceptance and not before: no account at the address until then', async () => {
      const { token } = await world.invite()

      expect(await accountAt(NEWCOMER)).toBeNull()

      await accept({ token, credentials })

      expect(await accountAt(NEWCOMER)).not.toBeNull()
    })

    it('creates nothing when the password is refused, and the same link still works', async () => {
      const { token } = await world.invite()

      const refused = await accept({ token, credentials: { ...credentials, password: 'court' } })

      expect(!refused.ok && refused.error.kind).toBe('invalid')
      expect(await accountAt(NEWCOMER)).toBeNull()
      expect((await accept({ token, credentials })).ok).toBe(true)
    })

    it('refuses a password built from the address it is for', async () => {
      const { token } = await world.invite()

      const refused = await accept({ token, credentials: { ...credentials, password: NEWCOMER } })

      expect(refused.ok).toBe(false)
      expect(await accountAt(NEWCOMER)).toBeNull()
    })

    it.each(['', '   ', 'a'.repeat(81)])(
      'creates nothing when the name is %j',
      async (displayName) => {
        const { token } = await world.invite()

        const refused = await accept({ token, credentials: { ...credentials, displayName } })

        expect(!refused.ok && refused.error.kind).toBe('invalid')
        expect(await accountAt(NEWCOMER)).toBeNull()
        expect((await accept({ token, credentials })).ok).toBe(true)
      },
    )

    it('prints the name as AccountName normalises it', async () => {
      const { token } = await world.invite()

      await accept({ token, credentials: { ...credentials, displayName: '  Camille \n Dupont ' } })

      expect((await accountAt(NEWCOMER))?.displayName).toBe('Camille Dupont')
    })
  })

  // --------------------------------------------------- proving the mailbox --

  describe('whether accepting proves the mailbox', () => {
    it('does when the link came by mail', async () => {
      const { token } = await world.invite({ delivery: 'mail' })
      await accept({ token, credentials })

      expect((await accountAt(NEWCOMER))?.emailVerifiedAt).toEqual(world.clock.now())
    })

    it('does not when the inviter was handed the link, because the inviter could have accepted it', async () => {
      const { token } = await world.invite({ delivery: 'link' })
      await accept({ token, credentials })

      expect((await accountAt(NEWCOMER))?.emailVerifiedAt).toBeNull()
    })

    it('stamps an existing account the same way', async () => {
      const mailed = await world.invite({ delivery: 'mail', email: EXISTING_EMAIL })
      await accept({ token: mailed.token, signedInUserId: asUserId(EXISTING_ID) })

      expect((await world.users.findById(asUserId(EXISTING_ID)))?.emailVerifiedAt).toEqual(
        world.clock.now(),
      )
    })

    it('leaves an existing account unverified when the link was copied', async () => {
      const copied = await world.invite({ delivery: 'link', email: EXISTING_EMAIL })
      await accept({ token: copied.token, signedInUserId: asUserId(EXISTING_ID) })

      expect((await world.users.findById(asUserId(EXISTING_ID)))?.emailVerifiedAt).toBeNull()
    })
  })

  // ------------------------------------------------------ an address in use --

  describe('an address that already has an account', () => {
    it('is never given a second account: the person is told to sign in, and nothing is spent', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, credentials })

      expect(!result.ok && result.error.kind).toBe('conflict')
      expect(!result.ok && result.error.code).toBe('invitation.signInRequired')
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
    })

    it('keeps its password, whatever the stranger who holds the link typed', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })
      const before = await world.users.findById(asUserId(EXISTING_ID))

      await accept({ token, credentials })

      expect((await world.users.findById(asUserId(EXISTING_ID)))?.toProps()).toEqual(
        before?.toProps(),
      )
    })

    it('is not attached to the event by someone who only holds the link', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      await accept({ token, credentials })

      expect(
        await world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)),
      ).toBeNull()
    })

    it('is answered like a dead link when the account is switched off, since it has nothing to sign in to', async () => {
      const existing = await world.users.findById(asUserId(EXISTING_ID))
      await world.users.save(existing!.disable(atPlus(1)))
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })

    it('is refused a hash that comes back empty, which is a hasher bug and creates no account', async () => {
      const { token } = await world.invite()
      const broken = new FakePasswordHasher({ produces: () => '' })
      const refusing = makeAcceptInvitation({
        tokens: world.tokens,
        secrets: world.secrets,
        events: world.events,
        clients: world.clients,
        memberships: world.memberships,
        users: world.users,
        hasher: broken,
        acceptance: world.acceptance,
        ids: world.ids,
        clock: world.clock,
      })

      const result = await refusing({ token, credentials })

      expect(!result.ok && result.error.code).toBe('user.passwordHashEmpty')
      expect(await accountAt(NEWCOMER)).toBeNull()
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
    })

    it('is told to sign in when it became taken after the link was judged, with the link still alive', async () => {
      const { token } = await world.invite()
      const raced: InvitationAcceptance = { accept: async () => 'emailTaken' }

      const result = await build(raced)({ token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.signInRequired')
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
    })
  })

  // ------------------------------------------------- signed in as an account --

  describe('accepting as the account that uses the address', () => {
    it('attaches that account to the event, and changes nothing else about it', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })
      const before = await world.users.findById(asUserId(EXISTING_ID))

      const result = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(result.ok && result.value.userId).toBe(EXISTING_ID)
      expect(
        (await world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)))?.role,
      ).toBe('moderator')
      expect((await world.users.findById(asUserId(EXISTING_ID)))?.passwordHash).toBe(
        before?.passwordHash,
      )
      expect((await world.users.findById(asUserId(EXISTING_ID)))?.siteRole).toBe(before?.siteRole)
    })

    it('answers with the address of the account that accepted', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(result.ok && result.value.email).toBe(EXISTING_EMAIL)
    })

    it('spends the link', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })
      await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      const again = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(!again.ok && again.error.code).toBe('invitation.notFound')
    })

    it('is answered like a dead link when the link was spent between judging it and spending it', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })
      const raced: InvitationAcceptance = { accept: async () => 'spent' }

      const result = await build(raced)({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })

    it('is refused for another account: a link is for one mailbox, and nothing is spent', async () => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, signedInUserId: asUserId(HOST_ID) })

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect(!result.ok && result.error.code).toBe('invitation.wrongAccount')
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
      expect(
        await world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(HOST_ID)),
      ).toMatchObject({
        role: 'owner',
      })
    })

    it('is refused for a link to an address that has no account at all', async () => {
      const { token } = await world.invite({ email: NEWCOMER })

      const result = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(!result.ok && result.error.code).toBe('invitation.wrongAccount')
    })

    it.each([
      ['an account that does not exist', async () => asUserId('user-nobody')],
      [
        'an account that was switched off',
        async () => {
          const existing = await world.users.findById(asUserId(EXISTING_ID))
          await world.users.save(existing!.disable(atPlus(1)))
          return asUserId(EXISTING_ID)
        },
      ],
    ])('is answered like a dead link for %s', async (_label, arrange) => {
      const { token } = await world.invite({ email: EXISTING_EMAIL })
      const signedInUserId = await arrange()

      const result = await accept({ token, signedInUserId })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })

    it('never lowers a role the account already holds in that event', async () => {
      await world.memberships.grant({
        eventId: asEventId(EVENT_ID),
        userId: asUserId(EXISTING_ID),
        role: 'owner',
        grantedAt: atPlus(-5),
      })
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(result.ok).toBe(true)
      expect(
        (await world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)))?.role,
      ).toBe('owner')
    })
  })

  // ------------------------------------------------------------ dead links --

  describe('a link that cannot be used', () => {
    it.each([
      ['spent', { consumedAt: atPlus(-1) }],
      ['revoked', { revokedAt: atPlus(-1) }],
      ['waiting for an approval it has not had', { requiresApproval: true }],
    ])('is not found when it is %s, and creates no account', async (_label, state) => {
      const { token } = await world.invite(state)

      const result = await accept({ token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
      expect(await accountAt(NEWCOMER)).toBeNull()
    })

    it('is not found once it has expired', async () => {
      const { token } = await world.invite({ expiresAt: atPlus(1_000) })
      world.clock.set(atPlus(1_000))

      const result = await accept({ token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
      expect(await accountAt(NEWCOMER)).toBeNull()
    })

    it('is not found when nobody ever issued it', async () => {
      const result = await accept({ token: 'secret-99', credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })

    it('is not found when the person who wrote it no longer owns the event', async () => {
      const { token } = await world.invite()
      await world.memberships.revoke(asEventId(EVENT_ID), asUserId(HOST_ID))

      const result = await accept({ token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
      expect(await accountAt(NEWCOMER)).toBeNull()
    })

    it('is refused with the reason when the event has been archived', async () => {
      const { token } = await world.invite()
      await world.events.save(anEvent({ id: EVENT_ID, ownerId: HOST_ID, status: 'archived' }))

      const result = await accept({ token, credentials })

      expect(!result.ok && result.error.code).toBe('event.immutable')
      expect(await accountAt(NEWCOMER)).toBeNull()
    })

    it('is read again after the hash, so an owner removed while it ran does not create an account', async () => {
      const { token } = await world.invite()
      const removing: PasswordHasher = {
        hash: async (password) => {
          // The ~250 ms of a real hash: long enough for the owner who wrote the invitation
          // to be removed from the event by somebody else.
          await world.memberships.revoke(asEventId(EVENT_ID), asUserId(HOST_ID))
          return world.hasher.hash(password)
        },
        verify: (attempt, hash) => world.hasher.verify(attempt, hash),
        needsRehash: () => false,
        dummyHash: world.hasher.dummyHash,
      }
      const racing = makeAcceptInvitation({
        tokens: world.tokens,
        secrets: world.secrets,
        events: world.events,
        clients: world.clients,
        memberships: world.memberships,
        users: world.users,
        hasher: removing,
        acceptance: world.acceptance,
        ids: world.ids,
        clock: world.clock,
      })

      const result = await racing({ token, credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
      expect(await accountAt(NEWCOMER)).toBeNull()
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
    })

    it('is read again after the hash, so an event archived while it ran takes no moderator', async () => {
      const { token } = await world.invite()
      const archiving: PasswordHasher = {
        hash: async (password) => {
          await world.events.save(anEvent({ id: EVENT_ID, ownerId: HOST_ID, status: 'archived' }))
          return world.hasher.hash(password)
        },
        verify: (attempt, hash) => world.hasher.verify(attempt, hash),
        needsRehash: () => false,
        dummyHash: world.hasher.dummyHash,
      }
      const racing = makeAcceptInvitation({
        tokens: world.tokens,
        secrets: world.secrets,
        events: world.events,
        clients: world.clients,
        memberships: world.memberships,
        users: world.users,
        hasher: archiving,
        acceptance: world.acceptance,
        ids: world.ids,
        clock: world.clock,
      })

      const result = await racing({ token, credentials })

      expect(!result.ok && result.error.code).toBe('event.immutable')
      expect(await accountAt(NEWCOMER)).toBeNull()
    })

    it('hashes nothing for a link that cannot be used, so a stranger cannot make the box spend 200 ms', async () => {
      let hashes = 0
      const counting: PasswordHasher = {
        hash: async (password) => {
          hashes += 1
          return world.hasher.hash(password)
        },
        verify: (attempt, hash) => world.hasher.verify(attempt, hash),
        needsRehash: () => false,
        dummyHash: world.hasher.dummyHash,
      }
      const refusing = makeAcceptInvitation({
        tokens: world.tokens,
        secrets: world.secrets,
        events: world.events,
        clients: world.clients,
        memberships: world.memberships,
        users: world.users,
        hasher: counting,
        acceptance: world.acceptance,
        ids: world.ids,
        clock: world.clock,
      })

      await refusing({ token: 'secret-99', credentials })

      expect(hashes).toBe(0)
    })

    it('judges the link by the clock at the moment it is accepted', async () => {
      const { token } = await world.invite()
      world.clock.advance(7 * 24 * 60 * 60 * 1000 - 1)
      expect((await accept({ token, credentials })).ok).toBe(true)
    })
  })

  it('keeps an unrelated event out of it: accepting grants the one the link names and no other', async () => {
    await world.events.save(
      anEvent({
        id: 'event-2',
        ownerId: HOST_ID,
        slug: 'autre',
        name: 'Autre',
        joinCode: 'ZZZZZZ',
      }),
    )
    const { token } = await world.invite()

    await accept({ token, credentials })

    const account = await accountAt(NEWCOMER)
    expect(await world.memberships.membershipFor(asEventId('event-2'), account!.id)).toBeNull()
  })
})

// -------------------------------------------------------- the terms of use --

/**
 * G2-20: on a box that sets `LEGAL_TERMS_URL` and `LEGAL_TERMS_VERSION`, accepting an invitation
 * is also agreeing to the terms. Every refusal here is a form error and none of them is a dead
 * link: the tick must not be an oracle for which links are alive, nor for who is on the box.
 */
describe('acceptInvitation: the terms of use', () => {
  const TERMS = { url: 'https://hosted.example.org/legal/cgu', version: '2027-01' }

  let world: InvitationWorld

  const buildWith = (
    terms: typeof TERMS | null | undefined,
    events: Pick<EventRepository, 'findById'> = world.events,
  ): AcceptInvitation =>
    makeAcceptInvitation({
      tokens: world.tokens,
      secrets: world.secrets,
      events,
      clients: world.clients,
      memberships: world.memberships,
      users: world.users,
      hasher: world.hasher,
      acceptance: world.acceptance,
      ids: world.ids,
      clock: world.clock,
      ...(terms === undefined ? {} : { terms }),
    })

  const logged = async () => (await world.audit.list({ limit: 50 })).items
  const accountAt = (email: string) => world.users.findByEmail(emailOf(email))

  beforeEach(() => {
    world = makeInvitationWorld()
  })

  describe('on a box that asks for them', () => {
    it.each([
      ['no tick at all', {}],
      ['an unticked box', { termsAccepted: false }],
    ])(
      'refuses a new account with %s, creates nothing and leaves the link usable',
      async (_what, tick) => {
        const accept = buildWith(TERMS)
        const { token } = await world.invite()

        const refused = await accept({ token, credentials, ...tick })

        expect(!refused.ok && refused.error.code).toBe('terms.notAccepted')
        expect(!refused.ok && refused.error.kind).toBe('invalid')
        expect(await accountAt(NEWCOMER)).toBeNull()
        expect(world.tokens.all[0]?.consumedAt).toBeNull()
        expect(await logged()).toEqual([])
        // The same link, with the box ticked, still opens: nothing was spent by the refusal.
        const again = await accept({ token, credentials, termsAccepted: true })
        expect(again.ok).toBe(true)
      },
    )

    it('refuses a signed-in account without the tick, and does not spend the link', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const refused = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(!refused.ok && refused.error.code).toBe('terms.notAccepted')
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
      expect(
        await world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)),
      ).toBeNull()
      expect(await logged()).toEqual([])
    })

    it('says the same about an address that has an account as about one that has none, so the tick tells nobody who is on the box', async () => {
      const accept = buildWith(TERMS)
      const stranger = await world.invite()
      const known = await world.invite({ email: EXISTING_EMAIL })

      const forStranger = await accept({ token: stranger.token, credentials })
      const forKnown = await accept({ token: known.token, credentials })

      expect(!forStranger.ok && forStranger.error.code).toBe('terms.notAccepted')
      expect(!forKnown.ok && forKnown.error.code).toBe('terms.notAccepted')
    })

    it('says the same to a signed-in account that is not the link owner as to the one that is', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const wrongOne = await accept({ token, signedInUserId: asUserId(HOST_ID) })

      expect(!wrongOne.ok && wrongOne.error.code).toBe('terms.notAccepted')
    })

    it.each([
      ['spent', { consumedAt: atPlus(-1) }],
      ['revoked', { revokedAt: atPlus(-1) }],
      ['waiting for an approval it has not had', { requiresApproval: true }],
    ])(
      'still answers a link that is %s with the one dead-link refusal, whatever the box holds',
      async (_what, state) => {
        const accept = buildWith(TERMS)
        const { token } = await world.invite(state)

        const withoutTick = await accept({ token, credentials })
        const withTick = await accept({ token, credentials, termsAccepted: true })

        expect(!withoutTick.ok && withoutTick.error.code).toBe('invitation.notFound')
        expect(!withTick.ok && withTick.error.code).toBe('invitation.notFound')
      },
    )

    it('answers a link nobody issued with the dead-link refusal and not the form one', async () => {
      const accept = buildWith(TERMS)

      const result = await accept({ token: 'secret-99', credentials })

      expect(!result.ok && result.error.code).toBe('invitation.notFound')
    })

    it('judges a password the policy refuses as it always did, with the tick given', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite()

      const result = await accept({
        token,
        credentials: { password: 'court', displayName: 'Camille' },
        termsAccepted: true,
      })

      expect(!result.ok && result.error.code).toBe('password.tooShort')
      expect(await logged()).toEqual([])
    })

    it('records the version of the terms as the person who accepted, in the log the client reads', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite({ to: 'client-owner' })

      const result = await accept({ token, credentials, termsAccepted: true })

      expect(result.ok).toBe(true)
      const account = await accountAt(NEWCOMER)
      const rows = await logged()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        action: 'account.termsAccepted',
        actor: { kind: 'member', userId: account?.id, label: null },
        subject: { type: 'account', id: account?.id },
        clientId: CLIENT_ID,
        details: { version: '2027-01' },
        at: world.clock.now(),
      })
    })

    it('records the version this box is on, whichever it is, and nothing the request said', async () => {
      const accept = buildWith({ ...TERMS, version: '2028-03' })
      const { token } = await world.invite()

      await accept({ token, credentials, termsAccepted: true })

      expect((await logged())[0]?.details).toEqual({ version: '2028-03' })
    })

    it('files the entry under the client that owns the event, when the invitation is to an event', async () => {
      // The fake event store keeps an event's client for good once it is saved, so the one
      // that has a client is read through a reader of its own, which is all the use case asks.
      const ofAClient = anEvent({
        id: EVENT_ID,
        ownerId: HOST_ID,
        slug: 'mariage-de-camille',
        name: 'Mariage de Camille',
        clientId: CLIENT_ID,
      })
      const accept = buildWith(TERMS, { findById: async () => ofAClient })
      const { token } = await world.invite()

      await accept({ token, credentials, termsAccepted: true })

      expect((await logged())[0]?.clientId).toBe(CLIENT_ID)
    })

    it('files the entry under no client when the event belongs to none', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite()

      await accept({ token, credentials, termsAccepted: true })

      expect((await logged())[0]?.clientId).toBeNull()
    })

    it('records it too for an account that already exists and is signed in: it is this invitation that is agreed to', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({
        token,
        signedInUserId: asUserId(EXISTING_ID),
        termsAccepted: true,
      })

      expect(result.ok).toBe(true)
      expect((await logged()).map((row) => [row.action, row.actor.userId])).toEqual([
        ['account.termsAccepted', EXISTING_ID],
      ])
    })

    it('records nothing for an address that turned out to have an account, since nothing was accepted', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, credentials, termsAccepted: true })

      expect(!result.ok && result.error.code).toBe('invitation.signInRequired')
      expect(await logged()).toEqual([])
    })

    it('records one entry per acceptance, and a link spent twice is agreed to once', async () => {
      const accept = buildWith(TERMS)
      const { token } = await world.invite()
      await accept({ token, credentials, termsAccepted: true })

      const again = await accept({ token, credentials, termsAccepted: true })

      expect(!again.ok && again.error.code).toBe('invitation.notFound')
      expect(await logged()).toHaveLength(1)
    })
  })

  describe('on a box whose version the log would refuse', () => {
    // The boot refuses such a version (`isTermsVersion`), so no real box gets here. What the use
    // case does if a composition ever hands it one anyway is decided here: it fails closed, and
    // does not accept a person and write nothing down about what they agreed to.
    const BROKEN = { url: TERMS.url, version: 'not a version!' }

    it('refuses a new account with the log refusal, creates nothing and leaves the link usable', async () => {
      const accept = buildWith(BROKEN)
      const { token } = await world.invite()

      const result = await accept({ token, credentials, termsAccepted: true })

      expect(!result.ok && result.error.code).toBe('audit.detailsInvalid')
      expect(await accountAt(NEWCOMER)).toBeNull()
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
      expect(await logged()).toEqual([])
    })

    it('refuses a signed-in account the same way, and does not spend the link', async () => {
      const accept = buildWith(BROKEN)
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({
        token,
        signedInUserId: asUserId(EXISTING_ID),
        termsAccepted: true,
      })

      expect(!result.ok && result.error.code).toBe('audit.detailsInvalid')
      expect(world.tokens.all[0]?.consumedAt).toBeNull()
      expect(
        await world.memberships.membershipFor(asEventId(EVENT_ID), asUserId(EXISTING_ID)),
      ).toBeNull()
    })
  })

  describe('on a box that asks for none, which is every self-hosted box', () => {
    it.each([
      ['no terms given at all', undefined],
      ['terms given as null', null],
    ])(
      'accepts without any tick, records nothing and changes nothing (%s)',
      async (_what, terms) => {
        const accept = buildWith(terms)
        const { token } = await world.invite()

        const result = await accept({ token, credentials })

        expect(result.ok).toBe(true)
        expect((await accountAt(NEWCOMER))?.email.value).toBe(NEWCOMER)
        expect(await logged()).toEqual([])
      },
    )

    it('records nothing for a tick it was sent anyway, since there is no version to say it agreed to', async () => {
      const accept = buildWith(null)
      const { token } = await world.invite()

      const result = await accept({ token, credentials, termsAccepted: true })

      expect(result.ok).toBe(true)
      expect(await logged()).toEqual([])
    })

    it('accepts a signed-in account without any tick either', async () => {
      const accept = buildWith(null)
      const { token } = await world.invite({ email: EXISTING_EMAIL })

      const result = await accept({ token, signedInUserId: asUserId(EXISTING_ID) })

      expect(result.ok).toBe(true)
      expect(await logged()).toEqual([])
    })
  })
})
