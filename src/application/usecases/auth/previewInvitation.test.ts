import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aUser, anAccountToken, anEvent, atPlus } from '../../testing/builders'
import {
  CLIENT_ID,
  EVENT_ID,
  EXISTING_EMAIL,
  HOST_ID,
  NEWCOMER,
  makeInvitationWorld,
  type InvitationWorld,
} from '../../testing/invitationWorld'
import { makePreviewInvitation, type PreviewInvitation } from './previewInvitation'

describe('previewInvitation', () => {
  let world: InvitationWorld
  let preview: PreviewInvitation

  beforeEach(() => {
    world = makeInvitationWorld()
    preview = makePreviewInvitation({
      tokens: world.tokens,
      secrets: world.secrets,
      events: world.events,
      clients: world.clients,
      memberships: world.memberships,
      clock: world.clock,
    })
  })

  // ---------------------------------------------------------- what it shows --

  describe('what it shows the holder of a link', () => {
    it('says it is to moderate an event, names it, and says when it ends', async () => {
      const { token, id } = await world.invite()

      const result = await preview({ token })

      expect(result).toEqual({
        ok: true,
        value: {
          kind: 'event',
          role: 'moderator',
          targetName: 'Mariage de Camille',
          expiresAt: world.tokens.all.find((record) => record.id === id)?.expiresAt,
        },
      })
    })

    it.each([
      ['owner', 'client-owner'],
      ['member', 'client-member'],
    ] as const)('says it is to join a client as its %s, and names it', async (role, to) => {
      const { token } = await world.invite({ to })

      const result = await preview({ token })

      expect(result.ok && result.value).toMatchObject({
        kind: 'client',
        role,
        targetName: 'Camille et Sacha',
      })
    })

    it('shows nothing about who invited, which address it was written to, or what the box knows of it', async () => {
      const { token } = await world.invite()

      const result = await preview({ token })

      expect(Object.keys(result.ok ? result.value : {}).sort()).toEqual([
        'expiresAt',
        'kind',
        'role',
        'targetName',
      ])
      expect(JSON.stringify(result)).not.toContain(NEWCOMER)
      expect(JSON.stringify(result)).not.toContain(HOST_ID)
    })

    it('shows the same thing for an address that has an account and one that has not', async () => {
      const unknown = await world.invite({ email: NEWCOMER })
      const known = await world.invite({ email: EXISTING_EMAIL })

      expect(await preview({ token: known.token })).toEqual(await preview({ token: unknown.token }))
    })

    it('spends nothing, so a mail client that fetches links to preview them cannot use one up', async () => {
      const { token } = await world.invite()

      await preview({ token })
      await preview({ token })

      expect(world.tokens.all[0]?.consumedAt).toBeNull()
      expect((await preview({ token })).ok).toBe(true)
    })
  })

  // ---------------------------------------------------------- dead links --

  describe('a link that cannot be used', () => {
    const NOT_FOUND = {
      ok: false,
      error: expect.objectContaining({ kind: 'notFound', code: 'invitation.notFound' }),
    }

    it('is not found when it was never issued, however it is spelled', async () => {
      for (const token of ['', 'x', 'secret-99', ' secret-1 ']) {
        expect(await preview({ token })).toMatchObject(NOT_FOUND)
      }
    })

    it.each([
      ['spent', { consumedAt: atPlus(-1) }],
      ['revoked', { revokedAt: atPlus(-1) }],
      ['waiting for an approval it has not had', { requiresApproval: true }],
    ])('is not found when it is %s', async (_label, state) => {
      const { token } = await world.invite(state)

      expect(await preview({ token })).toMatchObject(NOT_FOUND)
    })

    it('is not found at the instant it expires, which is exclusive', async () => {
      const { token } = await world.invite({ expiresAt: atPlus(1_000) })
      world.clock.set(atPlus(999))
      expect((await preview({ token })).ok).toBe(true)

      world.clock.set(atPlus(1_000))

      expect(await preview({ token })).toMatchObject(NOT_FOUND)
    })

    it('is not found when it is a different kind of link', async () => {
      const minted = world.secrets.mint()
      await world.tokens.save(
        anAccountToken({
          id: 'tok-reset',
          purpose: 'passwordReset',
          tokenDigest: minted.digest,
          userId: HOST_ID,
        }),
      )

      expect(await preview({ token: minted.token })).toMatchObject(NOT_FOUND)
    })

    it('answers every one of them with the same error', async () => {
      const dead = [
        await world.invite({ consumedAt: atPlus(-1) }),
        await world.invite({ revokedAt: atPlus(-1) }),
        await world.invite({ expiresAt: atPlus(1_000) }),
      ]
      world.clock.set(atPlus(1_000))

      const answers = await Promise.all([
        ...dead.map(({ token }) => preview({ token })),
        preview({ token: 'secret-99' }),
      ])

      expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1)
    })

    it('is not found when a repository answers with a link whose digest is not the one asked for', async () => {
      const { token } = await world.invite()
      const stored = world.tokens.all[0]!
      const loose = makePreviewInvitation({
        tokens: {
          ...world.tokens,
          findUsable: async () => ({ ...stored, tokenDigest: world.secrets.digestOf('other') }),
        } as never,
        secrets: world.secrets,
        events: world.events,
        clients: world.clients,
        memberships: world.memberships,
        clock: world.clock,
      })

      expect(await loose({ token })).toMatchObject(NOT_FOUND)
    })

    it('is not found when a row names no complete target, which is not a grant', async () => {
      const { token } = await world.invite()
      const stored = world.tokens.all[0]!
      const hollow = makePreviewInvitation({
        tokens: {
          ...world.tokens,
          findUsable: async () => ({ ...stored, eventId: null, eventRole: null }),
        } as never,
        secrets: world.secrets,
        events: world.events,
        clients: world.clients,
        memberships: world.memberships,
        clock: world.clock,
      })

      expect(await hollow({ token })).toMatchObject(NOT_FOUND)
    })

    it('is not found when the client it was to is gone', async () => {
      const { token } = await world.invite({ to: 'client-owner' })
      const gone = makePreviewInvitation({
        tokens: world.tokens,
        secrets: world.secrets,
        events: world.events,
        clients: {
          findById: async () => null,
          memberRole: async () => null,
          countEvents: async () => 0,
        },
        memberships: world.memberships,
        clock: world.clock,
      })

      expect(await gone({ token })).toMatchObject(NOT_FOUND)
    })

    it('is not found when the event it was to is gone', async () => {
      const { token } = await world.invite()
      await world.events.delete(asEventId(EVENT_ID))

      expect(await preview({ token })).toMatchObject(NOT_FOUND)
    })
  })

  describe('an event that can no longer take a moderator', () => {
    it('says so, rather than showing a link that cannot be accepted', async () => {
      const { token } = await world.invite()
      await world.events.save(anEvent({ id: EVENT_ID, ownerId: HOST_ID, status: 'archived' }))

      const result = await preview({ token })

      expect(!result.ok && result.error.kind).toBe('conflict')
      expect(!result.ok && result.error.code).toBe('event.immutable')
    })
  })

  // ----------------------------------------------- the inviter's authority --

  describe('the authority of whoever wrote an invitation to an event', () => {
    it('is read now, not when the link was written: an owner who was removed no longer invites', async () => {
      const { token } = await world.invite()
      await world.memberships.revoke(asEventId(EVENT_ID), asUserId(HOST_ID))

      expect(await preview({ token })).toMatchObject({ ok: false })
    })

    it('ends when the inviter is switched off', async () => {
      const { token } = await world.invite()
      const host = await world.users.findById(asUserId(HOST_ID))
      await world.users.save(host!.disable(atPlus(1)))

      expect(await preview({ token })).toMatchObject({ ok: false })
    })

    it('ends when the inviter was demoted to moderator, who invites nobody', async () => {
      const { token } = await world.invite()
      await world.memberships.grant({
        eventId: asEventId(EVENT_ID),
        userId: asUserId(HOST_ID),
        role: 'moderator',
        grantedAt: atPlus(1),
      })

      expect(await preview({ token })).toMatchObject({ ok: false })
    })

    it('ends when the inviter account is gone, which leaves the link with no author', async () => {
      const { token } = await world.invite({ createdBy: null })

      expect(await preview({ token })).toMatchObject({ ok: false })
    })

    it('holds for a co-owner just as for the first one', async () => {
      await world.users.save(aUser({ id: 'user-co', email: 'co@example.test' }))
      await world.memberships.grant({
        eventId: asEventId(EVENT_ID),
        userId: asUserId('user-co'),
        role: 'owner',
        grantedAt: atPlus(1),
      })
      world.tokens.withAccounts(asUserId('user-co'))
      const { token } = await world.invite({ createdBy: 'user-co' })

      expect((await preview({ token })).ok).toBe(true)
    })

    it('is not asked of an invitation to a client, which has no event to be an owner of', async () => {
      const { token } = await world.invite({ to: 'client-owner', createdBy: null })

      expect((await preview({ token })).ok).toBe(true)
    })
  })

  describe('R1 of the operator guard, held again when the link is read: an invitation into a client that nobody had to approve is good only while the client has no event', () => {
    const wedding = asEventId('event-wedding')
    const NOT_FOUND = {
      ok: false,
      error: expect.objectContaining({ kind: 'notFound', code: 'invitation.notFound' }),
    }

    /** The client grows its first event after the invitation was written. */
    const clientGrowsAnEvent = (): void => {
      world.clients.linkEvent(wedding, asClientId(CLIENT_ID))
    }

    it('still opens while the client has no event', async () => {
      const { token } = await world.invite({ to: 'client-owner' })

      expect((await preview({ token })).ok).toBe(true)
    })

    it('stops opening, as any dead link does, once the client has an event and nobody approved it', async () => {
      const { token } = await world.invite({ to: 'client-owner' })
      clientGrowsAnEvent()

      expect(await preview({ token })).toMatchObject(NOT_FOUND)
    })

    it('keeps opening once an owner approved it, whatever the client holds', async () => {
      const { token, id } = await world.invite({ to: 'client-owner', requiresApproval: true })
      await world.tokens.approve(id as never, asUserId(HOST_ID), AT)
      clientGrowsAnEvent()

      expect((await preview({ token })).ok).toBe(true)
    })

    it('keeps opening when an owner of the client wrote it, who is not who R1 is about', async () => {
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId(HOST_ID),
        role: 'owner',
        grantedAt: AT,
      })
      const { token } = await world.invite({ to: 'client-member', createdBy: HOST_ID })
      clientGrowsAnEvent()

      expect((await preview({ token })).ok).toBe(true)
    })

    it('stops opening when it was written by a mere member of the client', async () => {
      await world.clients.grantMember({
        clientId: asClientId(CLIENT_ID),
        userId: asUserId(HOST_ID),
        role: 'member',
        grantedAt: AT,
      })
      const { token } = await world.invite({ to: 'client-owner', createdBy: HOST_ID })
      clientGrowsAnEvent()

      expect(await preview({ token })).toMatchObject(NOT_FOUND)
    })

    it('keeps opening when the system wrote it, with no account behind it', async () => {
      const { token } = await world.invite({ to: 'client-owner', createdBy: null })
      clientGrowsAnEvent()

      expect((await preview({ token })).ok).toBe(true)
    })
  })
})
