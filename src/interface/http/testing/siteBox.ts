import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, aUser, anEvent } from '../../../application/testing/builders'
import {
  OPERATOR_ADDRESS,
  OPERATOR_ID,
  buildSiteHarness,
  type SiteHarness,
  type SiteHarnessOptions,
} from './siteHarness'

/**
 * A box run for other people, the cast the operator's routes are about (`/api/site`, G2-14).
 *
 * **Who exists**, every one able to sign in, with the address the stub sign-in knows them by:
 *
 * - the operator, a member of **no** client;
 * - `owner` and `coOwner`, the two owners of {@link CLIENT_K}, and `member`, who is not an owner
 *   of it: a client with an event and three members, which is a client somebody is using;
 * - `otherOwner`, the owner of {@link CLIENT_L}, another client in use, so that "client A never
 *   reads client B" has a client B;
 * - `stranger`, an account that belongs to no client and owns nothing;
 * - nobody at {@link NEWCOMER}, where invitations are written.
 *
 * **What exists**: {@link CLIENT_K} and {@link CLIENT_L} each with one live event of its own
 * (the owner's), and {@link CLIENT_EMPTY}, a client with no member and no event, which is the
 * case the operator guard leaves to the operator.
 */

export const ID = {
  operator: OPERATOR_ID,
  owner: '22222222-2222-4222-8222-222222222222',
  coOwner: '33333333-3333-4333-8333-333333333333',
  member: '44444444-4444-4444-8444-444444444444',
  stranger: '55555555-5555-4555-8555-555555555555',
  otherOwner: '66666666-6666-4666-8666-666666666666',
  clientK: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  clientL: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  clientEmpty: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  eventK: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  eventL: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const

export const ADDRESS = {
  operator: OPERATOR_ADDRESS,
  owner: 'proprio@example.test',
  coOwner: 'coproprio@example.test',
  member: 'membre@example.test',
  stranger: 'inconnu@example.test',
  otherOwner: 'autre-proprio@example.test',
} as const

export const NEWCOMER = 'nouveau@example.test'

/** What a client and its host typed, which no operator answer may ever carry. */
export const CONTENT = {
  eventName: 'Mariage de Camille et Sacha',
  slug: 'mariage-de-camille',
  joinCode: 'KJ7Q2M',
  otherEventName: 'Gala de la Fondation Bleue',
  otherSlug: 'gala-fondation-bleue',
  otherJoinCode: 'ZT4W9P',
} as const

export interface Box {
  readonly site: SiteHarness
}

export const aBox = async (options: SiteHarnessOptions = {}): Promise<Box> => {
  const site = buildSiteHarness(options)

  await site.addAccount(aUser({ id: ID.operator, email: ADDRESS.operator, siteRole: 'operator' }))
  for (const [id, email] of [
    [ID.owner, ADDRESS.owner],
    [ID.coOwner, ADDRESS.coOwner],
    [ID.member, ADDRESS.member],
    [ID.stranger, ADDRESS.stranger],
    [ID.otherOwner, ADDRESS.otherOwner],
  ] as const) {
    await site.addAccount(aUser({ id, email }))
  }

  await site.world.addClient(aClient({ id: ID.clientK, name: 'Camille et Sacha' }))
  await site.world.addClient(aClient({ id: ID.clientL, name: 'Fondation Bleue' }))
  await site.world.addClient(aClient({ id: ID.clientEmpty, name: 'Client neuf' }))

  for (const [clientId, userId, role] of [
    [ID.clientK, ID.owner, 'owner'],
    [ID.clientK, ID.coOwner, 'owner'],
    [ID.clientK, ID.member, 'member'],
    [ID.clientL, ID.otherOwner, 'owner'],
  ] as const) {
    await site.world.addClientMember({
      clientId: asClientId(clientId),
      userId: asUserId(userId),
      role,
      grantedAt: AT,
    })
  }

  await site.world.addEvent(
    anEvent({
      id: ID.eventK,
      ownerId: ID.owner,
      clientId: ID.clientK,
      name: CONTENT.eventName,
      slug: CONTENT.slug,
      joinCode: CONTENT.joinCode,
    }),
  )
  await site.world.addEvent(
    anEvent({
      id: ID.eventL,
      ownerId: ID.otherOwner,
      clientId: ID.clientL,
      name: CONTENT.otherEventName,
      slug: CONTENT.otherSlug,
      joinCode: CONTENT.otherJoinCode,
    }),
  )
  await site.repos.memberships.grant({
    eventId: asEventId(ID.eventK),
    userId: asUserId(ID.owner),
    role: 'owner',
    grantedAt: AT,
  })
  await site.repos.memberships.grant({
    eventId: asEventId(ID.eventL),
    userId: asUserId(ID.otherOwner),
    role: 'owner',
    grantedAt: AT,
  })

  return { site }
}
