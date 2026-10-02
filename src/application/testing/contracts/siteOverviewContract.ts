import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLIENT_ROLES } from '../../../domain/clients/clientRole'
import { EVENT_STATUSES } from '../../../domain/events/eventStatus'
import {
  asClientId,
  asEventId,
  asUserId,
  type ClientId,
  type EventId,
  type UserId,
} from '../../../domain/shared/ids'
import { pathsOfKind, shapeViolations } from '../../../domain/site/overviewShape'
import {
  SITE_OVERVIEW_SHAPES,
  type SiteAccountRow,
  type SiteClientRow,
  type SiteEventRow,
  type SiteOverviewRowKind,
} from '../../../domain/site/siteOverviewRows'
import { SITE_ROLES } from '../../../domain/users/siteRole'
import type { SiteOverview, SitePage, SitePageRequest } from '../../ports/siteOverview'
import { aClient, aClipJob, aGuest, aMission, aPhoto, aUser, anEvent, atPlus } from '../builders'
import type { SiteWorld } from '../fakeSiteOverview'

/**
 * The shared `SiteOverview` contract: the operator's read model of the box (roadmap §10.4;
 * paid plan P3-12, D-06).
 *
 * Run by the SQLite adapter and by `FakeSiteOverview`, so a double that kept more than the
 * adapter does, or that ordered, paged or counted differently, could not quietly make a
 * route test pass.
 *
 * ## The guard this exists for: nothing a client or a guest wrote comes out
 *
 * The world below is built the way a real box fills up — and **every place content could be
 * read from is planted with a distinctive string**: an event's name, slug and join code, a
 * photograph's caption and id and digest, a guest's name and id, a mission's prompt, a clip
 * job's id, an account's display name and password hash, a client's contact address. The
 * content tests then sweep *everything the three listings return, at every depth*, in two
 * independent ways:
 *
 * 1. **by shape** — every row has exactly the keys its declared shape names, each of the
 *    declared kind (`domain/site/siteOverviewRows.ts`), so an added column fails here even if
 *    its value is innocent;
 * 2. **by value** — every string anywhere in the output is a seeded id, a seeded client name
 *    or account address, or a member of a closed set (a status, a role). A plant surfacing
 *    under *any* key, or in place of an id, is a string nothing declared.
 *
 * The first alone would pass an adapter that put a slug into `id`; the second alone would
 * pass one that carried a new key holding a number. Together they leave a leak nowhere to
 * hide but a seeded label, which the label list (`siteOverviewRows.test.ts`) pins to two.
 */

/** What a subject is built from: the read model, and a way to put a world under it. */
export interface SiteOverviewSubject {
  readonly overview: SiteOverview
  readonly world: SiteWorld
  readonly dispose?: () => Promise<void>
}

// ---------------------------------------------------------------- the fixtures --

export const SITE_ACCOUNTS = {
  operator: asUserId('user-operator'),
  ownerA: asUserId('user-owner-a'),
  ownerB: asUserId('user-owner-b'),
  moderator: asUserId('user-moderator'),
} as const

export const SITE_CLIENTS = {
  atelier: asClientId('client-atelier'),
  bleu: asClientId('client-bleu'),
  vert: asClientId('client-vert'),
} as const

export const SITE_EVENTS = {
  wedding: asEventId('evt-wedding'),
  gala: asEventId('evt-gala'),
  brunch: asEventId('evt-brunch'),
  /** Belongs to nobody's client: the operator's own, which no client listing may show. */
  solo: asEventId('evt-solo'),
} as const

/** Bytes per row, chosen so that no two subsets of them sum to the same number. */
export const SITE_BYTES = {
  weddingPhotos: { published: 2_000, pending: 1_000, rejected: 500 },
  /** `reserved`, `queued` and `running` hold a staged source; `done` and `failed` do not. */
  weddingClips: {
    reserved: 100_000,
    queued: 200_000,
    running: 400_000,
    done: 800_000,
    failed: 1_600_000,
  },
  galaPhoto: 7_000_000,
  galaClip: 3_000_000,
  brunchPhoto: 40_000,
  soloPhoto: 9_000_000,
} as const

export const WEDDING_USED = 2_000 + 1_000 + 500 + (100_000 + 200_000 + 400_000)
export const GALA_USED = 7_000_000 + 3_000_000
export const ATELIER_USED = WEDDING_USED + GALA_USED
export const BRUNCH_USED = 40_000

/**
 * The strings the world plants in content, and that must never come back. Every one is
 * distinctive enough that a substring hit cannot be a coincidence.
 */
export const SITE_PLANTS = {
  eventNames: ['Mariage de CANARY-EVENT-NAME', 'Gala de CANARY-EVENT-NAME-2'],
  slugs: ['mariage-canary-slug', 'gala-canary-slug'],
  joinCodes: ['H7K2QM', 'K3M9PX'],
  captions: ['Légende CANARY-CAPTION', 'Légende CANARY-CAPTION-2'],
  guestNames: ['Léa CANARY-GUEST', 'Hugo CANARY-GUEST-2'],
  prompts: ['Un selfie CANARY-PROMPT'],
  displayNames: ['Camille CANARY-ACCOUNT-NAME', 'Opérateur CANARY-ACCOUNT-NAME-2'],
  passwordHashes: ['hash:CANARY-PASSWORD-HASH-A', 'hash:CANARY-PASSWORD-HASH-B'],
  contactEmails: ['contact-canary@example.test'],
  photoIds: ['photo-canary-1', 'photo-canary-2', 'photo-canary-3', 'photo-canary-4'],
  guestIds: ['guest-canary-w', 'guest-canary-g'],
  clipJobIds: ['clipjob-canary-reserved', 'clipjob-canary-queued', 'clipjob-canary-gala'],
  missionIds: ['mission-canary-1'],
} as const

const ALL_PLANTS: readonly string[] = Object.values(SITE_PLANTS).flat()

/** The labels the world seeds: the only free text a response may legitimately carry. */
export const SITE_LABELS = {
  clientNames: ['Atelier Camille', 'Studio Bleu', 'Maison Verte'],
  accountEmails: [
    'operator@example.test',
    'owner-a@example.test',
    'owner-b@example.test',
    'moderator@example.test',
  ],
} as const

const THIRTY_MEGA = 30_000_000
const TWENTY_MEGA = 20_000_000

/** Puts the whole fixture world under a subject, in the order the foreign keys want. */
export const plantSiteWorld = async (world: SiteWorld): Promise<void> => {
  // ---- accounts: the operator, two owners, and a moderator nobody has switched on --
  await world.addAccount(
    aUser({
      id: SITE_ACCOUNTS.operator,
      email: SITE_LABELS.accountEmails[0],
      displayName: SITE_PLANTS.displayNames[1],
      passwordHash: SITE_PLANTS.passwordHashes[1],
      siteRole: 'operator',
      createdAt: atPlus(100),
    }),
  )
  await world.addAccount(
    aUser({
      id: SITE_ACCOUNTS.ownerA,
      email: SITE_LABELS.accountEmails[1],
      displayName: SITE_PLANTS.displayNames[0],
      passwordHash: SITE_PLANTS.passwordHashes[0],
      createdAt: atPlus(200),
      lastLoginAt: atPlus(9_000),
    }),
  )
  await world.addAccount(
    aUser({
      id: SITE_ACCOUNTS.ownerB,
      email: SITE_LABELS.accountEmails[2],
      createdAt: atPlus(300),
    }),
  )
  await world.addAccount(
    aUser({
      id: SITE_ACCOUNTS.moderator,
      email: SITE_LABELS.accountEmails[3],
      createdAt: atPlus(400),
      mustChangePassword: true,
      disabledAt: atPlus(5_000),
    }),
  )

  // ---- clients: one with ceilings, one suspended and being offboarded, one empty ----
  await world.addClient(
    aClient({
      id: SITE_CLIENTS.atelier,
      name: SITE_LABELS.clientNames[0],
      contactEmail: SITE_PLANTS.contactEmails[0],
      createdAt: atPlus(1_000),
      eventsCreatedInPeriod: 2,
      ceilings: {
        maxEvents: 5,
        maxTotalBytes: 50_000_000,
        maxEventQuotaBytes: TWENTY_MEGA,
        maxRetentionDays: 90,
        clipsAllowed: false,
        liveAllowed: true,
        maxLiveDays: 7,
        maxEventsPerPeriod: 3,
        periodStartedAt: atPlus(500),
      },
    }),
  )
  await world.addClient(
    aClient({
      id: SITE_CLIENTS.bleu,
      name: SITE_LABELS.clientNames[1],
      createdAt: atPlus(2_000),
      suspendedAt: atPlus(8_000),
      purgeAfter: atPlus(9_000_000),
    }),
  )
  await world.addClient(
    aClient({ id: SITE_CLIENTS.vert, name: SITE_LABELS.clientNames[2], createdAt: atPlus(3_000) }),
  )

  await world.addClientMember({
    clientId: SITE_CLIENTS.atelier,
    userId: SITE_ACCOUNTS.ownerA,
    role: 'owner',
    grantedAt: atPlus(1_100),
  })
  await world.addClientMember({
    clientId: SITE_CLIENTS.bleu,
    userId: SITE_ACCOUNTS.ownerB,
    role: 'owner',
    grantedAt: atPlus(2_100),
  })
  // Owner A belongs to two clients, the later grant being Bleu's: the account row lists it first.
  await world.addClientMember({
    clientId: SITE_CLIENTS.bleu,
    userId: SITE_ACCOUNTS.ownerA,
    role: 'member',
    grantedAt: atPlus(2_200),
  })

  // ---- events: two of one client, one of another, and the operator's own ----------
  await world.addEvent(
    anEvent({
      id: SITE_EVENTS.wedding,
      ownerId: SITE_ACCOUNTS.ownerA,
      clientId: SITE_CLIENTS.atelier,
      name: SITE_PLANTS.eventNames[0],
      slug: SITE_PLANTS.slugs[0],
      joinCode: SITE_PLANTS.joinCodes[0],
      status: 'live',
      quotaBytes: THIRTY_MEGA,
      createdAt: atPlus(10_000),
      startsAt: atPlus(11_000),
      openedAt: atPlus(12_000),
    }),
  )
  await world.addEvent(
    anEvent({
      id: SITE_EVENTS.gala,
      ownerId: SITE_ACCOUNTS.ownerA,
      clientId: SITE_CLIENTS.atelier,
      name: SITE_PLANTS.eventNames[1],
      slug: SITE_PLANTS.slugs[1],
      joinCode: SITE_PLANTS.joinCodes[1],
      status: 'closed',
      quotaBytes: TWENTY_MEGA,
      createdAt: atPlus(20_000),
      openedAt: atPlus(21_000),
      closedAt: atPlus(30_000),
    }),
  )
  await world.addEvent(
    anEvent({
      id: SITE_EVENTS.brunch,
      ownerId: SITE_ACCOUNTS.ownerB,
      clientId: SITE_CLIENTS.bleu,
      name: 'Brunch de CANARY-EVENT-NAME-3',
      slug: 'brunch-canary-slug',
      joinCode: 'R5T8WZ',
      status: 'draft',
      quotaBytes: 5_000_000,
      createdAt: atPlus(15_000),
    }),
  )
  await world.addEvent(
    anEvent({
      id: SITE_EVENTS.solo,
      ownerId: SITE_ACCOUNTS.operator,
      clientId: null,
      name: 'Anniversaire de CANARY-EVENT-NAME-4',
      slug: 'solo-canary-slug',
      joinCode: 'C4D6FG',
      status: 'live',
      createdAt: atPlus(25_000),
    }),
  )

  // ---- the content: guests, a mission, captioned photographs, staged clips ---------
  await world.addGuest(
    aGuest({
      id: SITE_PLANTS.guestIds[0],
      eventId: SITE_EVENTS.wedding,
      displayName: SITE_PLANTS.guestNames[0],
    }),
  )
  await world.addGuest(
    aGuest({
      id: SITE_PLANTS.guestIds[1],
      eventId: SITE_EVENTS.gala,
      displayName: SITE_PLANTS.guestNames[1],
    }),
  )
  await world.addGuest(aGuest({ id: 'guest-solo', eventId: SITE_EVENTS.solo, displayName: null }))
  await world.addGuest(aGuest({ id: 'guest-brunch', eventId: SITE_EVENTS.brunch }))
  await world.addMission(
    aMission({
      id: SITE_PLANTS.missionIds[0],
      eventId: SITE_EVENTS.wedding,
      prompt: SITE_PLANTS.prompts[0],
    }),
  )

  const wedding = (id: string, status: 'published' | 'pending' | 'rejected', byteSize: number) =>
    aPhoto({
      id,
      eventId: SITE_EVENTS.wedding,
      author: { kind: 'guest', id: SITE_PLANTS.guestIds[0] },
      status,
      byteSize,
      caption: SITE_PLANTS.captions[0],
      createdAt: atPlus(13_000),
    })
  await world.addPhoto(
    wedding(SITE_PLANTS.photoIds[0], 'published', SITE_BYTES.weddingPhotos.published),
  )
  await world.addPhoto(
    wedding(SITE_PLANTS.photoIds[1], 'pending', SITE_BYTES.weddingPhotos.pending),
  )
  await world.addPhoto(
    wedding(SITE_PLANTS.photoIds[2], 'rejected', SITE_BYTES.weddingPhotos.rejected),
  )
  await world.addPhoto(
    aPhoto({
      id: SITE_PLANTS.photoIds[3],
      eventId: SITE_EVENTS.gala,
      author: { kind: 'guest', id: SITE_PLANTS.guestIds[1] },
      status: 'published',
      byteSize: SITE_BYTES.galaPhoto,
      caption: SITE_PLANTS.captions[1],
      createdAt: atPlus(22_000),
    }),
  )
  await world.addPhoto(
    aPhoto({
      id: 'photo-brunch',
      eventId: SITE_EVENTS.brunch,
      author: { kind: 'guest', id: 'guest-brunch' },
      status: 'published',
      byteSize: SITE_BYTES.brunchPhoto,
    }),
  )
  await world.addPhoto(
    aPhoto({
      id: 'photo-solo',
      eventId: SITE_EVENTS.solo,
      author: { kind: 'guest', id: 'guest-solo' },
      status: 'published',
      byteSize: SITE_BYTES.soloPhoto,
    }),
  )

  const clip = (
    id: string,
    eventId: string,
    guestId: string,
    status: 'reserved' | 'queued' | 'running' | 'done' | 'failed',
    sourceByteSize: number,
  ) =>
    aClipJob({
      id,
      eventId,
      author: { kind: 'guest', id: guestId },
      status,
      sourceByteSize,
      caption: SITE_PLANTS.captions[0],
    })
  const guestW = SITE_PLANTS.guestIds[0]
  const clips = SITE_BYTES.weddingClips
  await world.addClipJob(
    clip(SITE_PLANTS.clipJobIds[0], SITE_EVENTS.wedding, guestW, 'reserved', clips.reserved),
  )
  await world.addClipJob(
    clip(SITE_PLANTS.clipJobIds[1], SITE_EVENTS.wedding, guestW, 'queued', clips.queued),
  )
  await world.addClipJob(
    clip('clipjob-running', SITE_EVENTS.wedding, guestW, 'running', clips.running),
  )
  await world.addClipJob(clip('clipjob-done', SITE_EVENTS.wedding, guestW, 'done', clips.done))
  await world.addClipJob(
    clip('clipjob-failed', SITE_EVENTS.wedding, guestW, 'failed', clips.failed),
  )
  await world.addClipJob(
    clip(
      SITE_PLANTS.clipJobIds[2],
      SITE_EVENTS.gala,
      SITE_PLANTS.guestIds[1],
      'queued',
      SITE_BYTES.galaClip,
    ),
  )
}

// ------------------------------------------------------------ the sweep helpers --

/** A page request with or without a cursor, which `exactOptionalPropertyTypes` makes two shapes. */
const request = <Cursor>(limit: number, after: Cursor | undefined): SitePageRequest<Cursor> =>
  after === undefined ? { limit } : { limit, after }

/** Every page of a listing, followed to its end. */
const drain = async <Row, Cursor>(
  fetch: (after: Cursor | undefined) => Promise<SitePage<Row, Cursor> | null>,
): Promise<readonly Row[]> => {
  const rows: Row[] = []
  let after: Cursor | undefined
  for (;;) {
    const page = await fetch(after)
    if (page === null) return rows
    rows.push(...page.items)
    if (page.next === null) return rows
    after = page.next
  }
}

/** Everything the three listings return for the whole world, per kind of row. */
const everything = async (
  overview: SiteOverview,
): Promise<Readonly<Record<SiteOverviewRowKind, readonly unknown[]>>> => {
  const clients = await drain<SiteClientRow, ClientId>((after) =>
    overview.listClients(request(2, after)),
  )
  const events = (
    await Promise.all(
      Object.values(SITE_CLIENTS).map((clientId) =>
        drain<SiteEventRow, EventId>((after) => overview.clientEvents(clientId, request(1, after))),
      ),
    )
  ).flat()
  const accounts = await drain<SiteAccountRow, UserId>((after) =>
    overview.listAccounts(request(3, after)),
  )
  return { client: clients, event: events, account: accounts }
}

/** Every string anywhere in a value, keys excluded: a leak's value is what we are after. */
const stringsIn = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value instanceof Date || typeof value !== 'object' || value === null) return []
  return Object.values(value).flatMap(stringsIn)
}

/** Every key anywhere in a value, so a key that is itself content (a slug as a key) is seen. */
const keysIn = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap(keysIn)
  if (value instanceof Date || typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, nested]) => [key, ...keysIn(nested)])
}

/** The values at a dotted shape path (`[]` for a list item) of one row. */
const valuesAt = (value: unknown, path: string): readonly unknown[] =>
  path === ''
    ? [value]
    : path
        .split('.')
        .reduce<readonly unknown[]>(
          (current, step) =>
            step.endsWith('[]')
              ? current.flatMap((item) => readList(item, step.slice(0, -2)))
              : current.flatMap((item) => readKey(item, step)),
          [value],
        )

const readKey = (item: unknown, key: string): readonly unknown[] =>
  typeof item === 'object' && item !== null && key in item
    ? [(item as Record<string, unknown>)[key]]
    : []

const readList = (item: unknown, key: string): readonly unknown[] => {
  const list = readKey(item, key)[0]
  return Array.isArray(list) ? list : []
}

export const siteOverviewContract = (
  name: string,
  makeSubject: () => Promise<SiteOverviewSubject>,
): void => {
  describe(`SiteOverview contract: ${name}`, () => {
    let overview: SiteOverview
    let world: SiteWorld
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      overview = subject.overview
      world = subject.world
      dispose = subject.dispose
      await plantSiteWorld(world)
    })

    afterEach(async () => {
      await dispose?.()
    })

    // --------------------------------------------------------------- clients --

    describe('listClients', () => {
      it('lists every client, newest first', async () => {
        const page = await overview.listClients({ limit: 10 })

        expect(page.items.map((row) => row.id)).toEqual([
          SITE_CLIENTS.vert,
          SITE_CLIENTS.bleu,
          SITE_CLIENTS.atelier,
        ])
        expect(page.next).toBeNull()
      })

      it('pages by keyset: the cursor is the last id of the page before', async () => {
        const first = await overview.listClients({ limit: 2 })
        const second = await overview.listClients({
          limit: 2,
          after: first.next ?? SITE_CLIENTS.vert,
        })

        expect(first.items.map((row) => row.id)).toEqual([SITE_CLIENTS.vert, SITE_CLIENTS.bleu])
        expect(first.next).toBe(SITE_CLIENTS.bleu)
        expect(second.items.map((row) => row.id)).toEqual([SITE_CLIENTS.atelier])
        expect(second.next).toBeNull()
      })

      it('does not shift a page when a client is created after the first one was drawn', async () => {
        const first = await overview.listClients({ limit: 2 })
        await world.addClient(
          aClient({ id: 'client-late', name: 'Latecomer', createdAt: atPlus(4_000) }),
        )

        const second = await overview.listClients({
          limit: 2,
          after: first.next ?? SITE_CLIENTS.vert,
        })

        expect(second.items.map((row) => row.id)).toEqual([SITE_CLIENTS.atelier])
      })

      it('answers an unknown cursor with an empty page, not with the first page again', async () => {
        const page = await overview.listClients({ limit: 10, after: asClientId('client-nobody') })

        expect(page).toEqual({ items: [], next: null })
      })

      it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'refuses a limit of %s rather than guessing what it meant',
        async (limit) => {
          await expect(overview.listClients({ limit })).rejects.toThrow(RangeError)
        },
      )

      it("carries a client's name, dates, ceilings and counters", async () => {
        const page = await overview.listClients({ limit: 10 })
        const atelier = page.items.find((row) => row.id === SITE_CLIENTS.atelier)

        expect(atelier).toEqual({
          id: SITE_CLIENTS.atelier,
          name: 'Atelier Camille',
          createdAt: atPlus(1_000),
          suspendedAt: null,
          purgeAfter: null,
          ceilings: {
            maxEvents: 5,
            maxTotalBytes: 50_000_000,
            maxEventQuotaBytes: TWENTY_MEGA,
            maxRetentionDays: 90,
            clipsAllowed: false,
            liveAllowed: true,
            maxLiveDays: 7,
            maxEventsPerPeriod: 3,
            periodStartedAt: atPlus(500),
          },
          eventsCreatedInPeriod: 2,
          usage: { eventCount: 2, liveEventCount: 1, memberCount: 1, usedBytes: ATELIER_USED },
        })
      })

      it('reports a suspended client being offboarded by its two instants', async () => {
        const page = await overview.listClients({ limit: 10 })
        const bleu = page.items.find((row) => row.id === SITE_CLIENTS.bleu)

        expect(bleu?.suspendedAt).toEqual(atPlus(8_000))
        expect(bleu?.purgeAfter).toEqual(atPlus(9_000_000))
      })

      it("counts a client's events of every status, its live ones apart, and its roster", async () => {
        const page = await overview.listClients({ limit: 10 })
        const bleu = page.items.find((row) => row.id === SITE_CLIENTS.bleu)

        // One draft event, two members: the draft is counted (it is what `max_events`
        // counts) and is not live.
        expect(bleu?.usage).toEqual({
          eventCount: 1,
          liveEventCount: 0,
          memberCount: 2,
          usedBytes: BRUNCH_USED,
        })
      })

      it('sums what a client has spent over all its events, queued clip sources included', async () => {
        const page = await overview.listClients({ limit: 10 })
        const atelier = page.items.find((row) => row.id === SITE_CLIENTS.atelier)

        // The wedding's three photographs plus the three clips still holding a source, the
        // gala's photograph plus its queued clip. The `done` and `failed` clips hold none;
        // and the operator's own event, which has no client, is nobody's.
        expect(atelier?.usage.usedBytes).toBe(WEDDING_USED + GALA_USED)
        expect(atelier?.usage.usedBytes).toBe(10_703_500)
      })

      it('reports a client with nothing in it as zeros', async () => {
        const page = await overview.listClients({ limit: 10 })
        const vert = page.items.find((row) => row.id === SITE_CLIENTS.vert)

        expect(vert?.usage).toEqual({
          eventCount: 0,
          liveEventCount: 0,
          memberCount: 0,
          usedBytes: 0,
        })
      })
    })

    // ---------------------------------------------------------------- events --

    describe('clientEvents', () => {
      it('is null for a client that does not exist, and an empty page for one with no event', async () => {
        expect(await overview.clientEvents(asClientId('client-nobody'), { limit: 10 })).toBeNull()
        expect(await overview.clientEvents(SITE_CLIENTS.vert, { limit: 10 })).toEqual({
          items: [],
          next: null,
        })
      })

      it("lists only this client's events, newest first, and never one that has no client", async () => {
        const atelier = await overview.clientEvents(SITE_CLIENTS.atelier, { limit: 10 })
        const bleu = await overview.clientEvents(SITE_CLIENTS.bleu, { limit: 10 })

        expect(atelier?.items.map((row) => row.id)).toEqual([SITE_EVENTS.gala, SITE_EVENTS.wedding])
        expect(bleu?.items.map((row) => row.id)).toEqual([SITE_EVENTS.brunch])
      })

      it("carries an event's status, dates and sizes", async () => {
        const page = await overview.clientEvents(SITE_CLIENTS.atelier, { limit: 10 })
        const wedding = page?.items.find((row) => row.id === SITE_EVENTS.wedding)

        expect(wedding).toEqual({
          id: SITE_EVENTS.wedding,
          status: 'live',
          createdAt: atPlus(10_000),
          startsAt: atPlus(11_000),
          openedAt: atPlus(12_000),
          closedAt: null,
          quotaBytes: THIRTY_MEGA,
          usedBytes: WEDDING_USED,
          photoCount: 3,
        })
      })

      it('reports a closed event by its closing instant and a draft by having none', async () => {
        const atelier = await overview.clientEvents(SITE_CLIENTS.atelier, { limit: 10 })
        const bleu = await overview.clientEvents(SITE_CLIENTS.bleu, { limit: 10 })

        const gala = atelier?.items.find((row) => row.id === SITE_EVENTS.gala)
        const brunch = bleu?.items.find((row) => row.id === SITE_EVENTS.brunch)
        expect(gala).toMatchObject({
          status: 'closed',
          closedAt: atPlus(30_000),
          usedBytes: GALA_USED,
        })
        expect(brunch).toMatchObject({
          status: 'draft',
          openedAt: null,
          closedAt: null,
          startsAt: null,
        })
      })

      it('counts the bytes an event has spent the way the upload path does', async () => {
        const page = await overview.clientEvents(SITE_CLIENTS.atelier, { limit: 10 })
        const wedding = page?.items.find((row) => row.id === SITE_EVENTS.wedding)

        // Photographs of every status (3 500) plus the `reserved`, `queued` and `running`
        // sources (700 000). The `done` (800 000) and `failed` (1 600 000) ones hold none.
        expect(wedding?.usedBytes).toBe(703_500)
      })

      it('pages by keyset within the client', async () => {
        const first = await overview.clientEvents(SITE_CLIENTS.atelier, { limit: 1 })
        const second = await overview.clientEvents(SITE_CLIENTS.atelier, {
          limit: 1,
          after: first?.next ?? SITE_EVENTS.gala,
        })

        expect(first?.items.map((row) => row.id)).toEqual([SITE_EVENTS.gala])
        expect(first?.next).toBe(SITE_EVENTS.gala)
        expect(second?.items.map((row) => row.id)).toEqual([SITE_EVENTS.wedding])
        expect(second?.next).toBeNull()
      })

      it("answers a cursor that names another client's event with an empty page", async () => {
        // Otherwise the cursor would be a probe: the page it returned, or its position,
        // would say something about an event the caller did not ask about.
        const page = await overview.clientEvents(SITE_CLIENTS.atelier, {
          limit: 10,
          after: SITE_EVENTS.brunch,
        })

        expect(page).toEqual({ items: [], next: null })
      })

      it('answers an unknown cursor with an empty page', async () => {
        const page = await overview.clientEvents(SITE_CLIENTS.atelier, {
          limit: 10,
          after: asEventId('evt-nobody'),
        })

        expect(page).toEqual({ items: [], next: null })
      })

      it.each([0, -1, 1.5, Number.NaN])(
        'refuses a limit of %s, whether or not the client exists',
        async (limit) => {
          await expect(overview.clientEvents(SITE_CLIENTS.atelier, { limit })).rejects.toThrow(
            RangeError,
          )
          await expect(
            overview.clientEvents(asClientId('client-nobody'), { limit }),
          ).rejects.toThrow(RangeError)
        },
      )
    })

    // -------------------------------------------------------------- accounts --

    describe('listAccounts', () => {
      it('lists every account, newest first', async () => {
        const page = await overview.listAccounts({ limit: 10 })

        expect(page.items.map((row) => row.id)).toEqual([
          SITE_ACCOUNTS.moderator,
          SITE_ACCOUNTS.ownerB,
          SITE_ACCOUNTS.ownerA,
          SITE_ACCOUNTS.operator,
        ])
        expect(page.next).toBeNull()
      })

      it('pages by keyset', async () => {
        const first = await overview.listAccounts({ limit: 3 })
        const second = await overview.listAccounts({
          limit: 3,
          after: first.next ?? SITE_ACCOUNTS.operator,
        })

        expect(first.items).toHaveLength(3)
        expect(first.next).toBe(SITE_ACCOUNTS.ownerA)
        expect(second.items.map((row) => row.id)).toEqual([SITE_ACCOUNTS.operator])
        expect(second.next).toBeNull()
      })

      it('answers an unknown cursor with an empty page', async () => {
        expect(await overview.listAccounts({ limit: 10, after: asUserId('user-nobody') })).toEqual({
          items: [],
          next: null,
        })
      })

      it.each([0, -1, 1.5, Number.NaN])('refuses a limit of %s', async (limit) => {
        await expect(overview.listAccounts({ limit })).rejects.toThrow(RangeError)
      })

      it("carries an account's address, site role and standing", async () => {
        const page = await overview.listAccounts({ limit: 10 })
        const byId = (id: string) => page.items.find((row) => row.id === id)

        expect(byId(SITE_ACCOUNTS.operator)).toEqual({
          id: SITE_ACCOUNTS.operator,
          email: 'operator@example.test',
          siteRole: 'operator',
          createdAt: atPlus(100),
          lastLoginAt: null,
          disabledAt: null,
          mustChangePassword: false,
          // The operator's own event, which belongs to no client: still an event it owns,
          // and what would stop the account being deleted.
          ownedEventCount: 1,
          clients: [],
        })
        expect(byId(SITE_ACCOUNTS.moderator)).toMatchObject({
          siteRole: 'none',
          disabledAt: atPlus(5_000),
          mustChangePassword: true,
          ownedEventCount: 0,
        })
        expect(byId(SITE_ACCOUNTS.ownerA)).toMatchObject({
          lastLoginAt: atPlus(9_000),
          ownedEventCount: 2,
        })
      })

      it('lists the clients an account belongs to, most recently granted first', async () => {
        const page = await overview.listAccounts({ limit: 10 })
        const ownerA = page.items.find((row) => row.id === SITE_ACCOUNTS.ownerA)
        const ownerB = page.items.find((row) => row.id === SITE_ACCOUNTS.ownerB)

        expect(ownerA?.clients).toEqual([
          { clientId: SITE_CLIENTS.bleu, role: 'member' },
          { clientId: SITE_CLIENTS.atelier, role: 'owner' },
        ])
        expect(ownerB?.clients).toEqual([{ clientId: SITE_CLIENTS.bleu, role: 'owner' }])
      })

      it('lists the clients of every account on a page, not only the first', async () => {
        const page = await overview.listAccounts({ limit: 10 })

        expect(page.items.map((row) => row.clients.length)).toEqual([0, 1, 2, 0])
      })
    })

    // --------------------------------------------------------------- content --

    describe('content: nothing a client or a guest wrote comes out', () => {
      it('plants every kind of content it claims to look for', () => {
        // Guards the sweep against going vacuous: a plant list that lost a kind would make
        // "none of them came back" true of an adapter that leaks that kind.
        expect(Object.keys(SITE_PLANTS).sort()).toEqual(
          [
            'captions',
            'clipJobIds',
            'contactEmails',
            'displayNames',
            'eventNames',
            'guestIds',
            'guestNames',
            'joinCodes',
            'missionIds',
            'passwordHashes',
            'photoIds',
            'prompts',
            'slugs',
          ].sort(),
        )
        expect(ALL_PLANTS.every((plant) => plant.length >= 6)).toBe(true)
      })

      it('hands out rows that are exactly the declared shape, at every depth', async () => {
        const rows = await everything(overview)

        const violations = (Object.keys(SITE_OVERVIEW_SHAPES) as SiteOverviewRowKind[]).flatMap(
          (kind) =>
            rows[kind].flatMap((row) =>
              shapeViolations(SITE_OVERVIEW_SHAPES[kind], row).map(
                (violation) => `${kind}: ${violation.path} ${violation.problem}`,
              ),
            ),
        )

        expect(violations).toEqual([])
        // And it saw something: three clients, three events of clients, four accounts.
        expect(rows.client).toHaveLength(3)
        expect(rows.event).toHaveLength(3)
        expect(rows.account).toHaveLength(4)
      })

      it('contains none of the planted content anywhere in what it returns', async () => {
        const output = JSON.stringify(await everything(overview))

        const found = ALL_PLANTS.filter((plant) => output.includes(plant))

        expect(found).toEqual([])
      })

      it('carries no string at all that is not a seeded id, a seeded label or a closed-set word', async () => {
        const rows = await everything(overview)
        const allowed = new Set<string>([
          ...Object.values(SITE_CLIENTS),
          ...Object.values(SITE_EVENTS),
          ...Object.values(SITE_ACCOUNTS),
          ...SITE_LABELS.clientNames,
          ...SITE_LABELS.accountEmails,
          ...EVENT_STATUSES,
          ...SITE_ROLES,
          ...CLIENT_ROLES,
        ])

        const strangers = Object.values(rows)
          .flat()
          .flatMap(stringsIn)
          .filter((text) => !allowed.has(text))

        expect(strangers).toEqual([])
      })

      it('uses no key that is itself content, such as a slug used as a property name', async () => {
        const rows = await everything(overview)
        const keys = new Set(Object.values(rows).flat().flatMap(keysIn))

        expect([...keys].filter((key) => ALL_PLANTS.some((plant) => key.includes(plant)))).toEqual(
          [],
        )
      })

      it('shows free text only where a label is declared, and only what was seeded there', async () => {
        const rows = await everything(overview)

        const shown = (Object.keys(SITE_OVERVIEW_SHAPES) as SiteOverviewRowKind[]).flatMap((kind) =>
          pathsOfKind(SITE_OVERVIEW_SHAPES[kind], 'label').flatMap((path) =>
            rows[kind].flatMap((row) => valuesAt(row, path)),
          ),
        )

        expect(new Set(shown)).toEqual(
          new Set([...SITE_LABELS.clientNames, ...SITE_LABELS.accountEmails]),
        )
      })

      it('names the operator by neither the display name nor the hash the world gave it', async () => {
        const page = await overview.listAccounts({ limit: 10 })
        const operator = page.items.find((row) => row.id === SITE_ACCOUNTS.operator)

        expect(Object.keys(operator ?? {}).sort()).toEqual(
          [
            'clients',
            'createdAt',
            'disabledAt',
            'email',
            'id',
            'lastLoginAt',
            'mustChangePassword',
            'ownedEventCount',
            'siteRole',
          ].sort(),
        )
      })
    })
  })
}
