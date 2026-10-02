import { describe, expect, it } from 'vitest'
import { keyNames, pathsOfKind, shapeViolations } from './overviewShape'
import {
  SITE_ACCOUNT_ROW_SHAPE,
  SITE_CLIENT_ROW_SHAPE,
  SITE_EVENT_ROW_SHAPE,
  SITE_OVERVIEW_SHAPES,
  type SiteAccountRow,
  type SiteClientRow,
  type SiteEventRow,
} from './siteOverviewRows'
import { asClientId, asEventId, asUserId } from '../shared/ids'

/**
 * Ring 1. **The operator's rows carry no content, and this is where that is stated.**
 *
 * Three guards, because a TypeScript type is erased before any test can read it and a
 * single guard would leave one of the two halves unwatched:
 *
 * 1. the *types*, at compile time — a row type that gains a content-shaped key stops
 *    `npm run typecheck`, whether or not anybody updates the shape to match;
 * 2. the *shapes*, at run time — the free-text fields are an explicit list, and no key in
 *    any shape is named like content;
 * 3. the *values*, in `contracts/siteOverviewContract.ts` — what a real adapter returns for
 *    a world planted with content fits these shapes and contains none of the plants.
 */

// ------------------------------------------------------------ guard 1: the types --

/** Every key at every depth of a row type, through arrays, and not into dates. */
type DeepKeys<T> = T extends Date
  ? never
  : T extends readonly (infer Item)[]
    ? DeepKeys<Item>
    : T extends object
      ? { [K in keyof T & string]: K | DeepKeys<T[K]> }[keyof T & string]
      : never

/**
 * Names that carry what a client, a guest or a photograph holds. `name` is not in the list
 * because the client's own name is the one allowed label, and it is refused for the other
 * two rows by {@link NoName} below.
 */
type ContentKey =
  | 'slug'
  | 'joinCode'
  | 'caption'
  | 'displayName'
  | 'eventName'
  | 'guestName'
  | 'prompt'
  | 'photoId'
  | 'photoIds'
  | 'url'
  | 'thumbUrl'
  | 'mediaUrl'
  | 'contentHash'
  | 'posterHash'
  | 'passwordHash'
  | 'tokenDigest'
  | 'token'
  | 'settings'
  | 'contactEmail'

type Assert<T extends true> = T
type HasNoContentKey<T> = [Extract<DeepKeys<T>, ContentKey>] extends [never] ? true : false
type NoName<T> = [Extract<DeepKeys<T>, 'name'>] extends [never] ? true : false

/**
 * Evaluated by `tsc`, not by vitest: each member is an `Assert<…>` that stops compiling the
 * moment a row type gains a key in {@link ContentKey}. Exported so that `noUnusedLocals` has
 * nothing to say about a type that exists only to be checked.
 */
export type RowsCarryNoContent = [
  Assert<HasNoContentKey<SiteClientRow>>,
  Assert<HasNoContentKey<SiteEventRow>>,
  Assert<HasNoContentKey<SiteAccountRow>>,
  Assert<NoName<SiteEventRow>>,
  Assert<NoName<SiteAccountRow>>,
]

// ------------------------------------------------------------- guard 2: the shapes --

/** A key named like something a person wrote or a photograph is: refused in every shape. */
const CONTENT_SOUNDING_KEY =
  /caption|slug|joincode|displayname|eventname|guestname|prompt|url|hash|digest|token|passwordhash|settings|contact|filename/i

const aClientRow = (): SiteClientRow => ({
  id: asClientId('client-1'),
  name: 'Atelier Photo Camille',
  createdAt: new Date('2026-06-20T21:00:00.000Z'),
  suspendedAt: null,
  purgeAfter: null,
  ceilings: {
    maxEvents: 5,
    maxTotalBytes: null,
    maxEventQuotaBytes: null,
    maxRetentionDays: 90,
    clipsAllowed: true,
    liveAllowed: true,
    maxLiveDays: null,
    maxEventsPerPeriod: null,
    periodStartedAt: null,
  },
  eventsCreatedInPeriod: 2,
  usage: { eventCount: 2, liveEventCount: 1, memberCount: 1, usedBytes: 4_800_000 },
})

const anEventRow = (): SiteEventRow => ({
  id: asEventId('event-1'),
  status: 'live',
  createdAt: new Date('2026-06-20T21:00:00.000Z'),
  startsAt: null,
  openedAt: new Date('2026-06-20T21:00:00.000Z'),
  closedAt: null,
  quotaBytes: 1_000_000_000,
  usedBytes: 2_400_000,
  photoCount: 1,
})

const anAccountRow = (): SiteAccountRow => ({
  id: asUserId('user-1'),
  email: 'camille@example.test',
  siteRole: 'none',
  createdAt: new Date('2026-06-20T21:00:00.000Z'),
  lastLoginAt: null,
  disabledAt: null,
  mustChangePassword: false,
  ownedEventCount: 1,
  clients: [{ clientId: asClientId('client-1'), role: 'owner' }],
})

describe('the shapes of the operator overview', () => {
  it('declares exactly two free-text fields in all: the client name and the account address', () => {
    // The whole privacy argument is that this list is short and a diff must touch it. A
    // third entry is not wrong by itself, but it is a decision, and this is where it is
    // made — not a column that rode along on a query.
    const labels = Object.entries(SITE_OVERVIEW_SHAPES).flatMap(([row, shape]) =>
      pathsOfKind(shape, 'label').map((path) => `${row}.${path}`),
    )

    expect(labels).toEqual(['client.name', 'account.email'])
  })

  it('names every identifier a row carries, and none of them is a photograph or a guest', () => {
    const ids = Object.entries(SITE_OVERVIEW_SHAPES).flatMap(([row, shape]) =>
      pathsOfKind(shape, 'id').map((path) => `${row}.${path}`),
    )

    expect(ids).toEqual(['client.id', 'event.id', 'account.id', 'account.clients[].clientId'])
  })

  it.each(Object.entries(SITE_OVERVIEW_SHAPES))(
    'gives the %s row no key that sounds like content',
    (_row, shape) => {
      const offending = keyNames(shape).filter((key) => CONTENT_SOUNDING_KEY.test(key))

      expect(offending).toEqual([])
    },
  )

  it('lets only the client row carry a `name`', () => {
    expect(keyNames(SITE_CLIENT_ROW_SHAPE)).toContain('name')
    expect(keyNames(SITE_EVENT_ROW_SHAPE)).not.toContain('name')
    expect(keyNames(SITE_ACCOUNT_ROW_SHAPE)).not.toContain('name')
  })

  it('has a free-text field in no row but the two that were named', () => {
    expect(pathsOfKind(SITE_EVENT_ROW_SHAPE, 'label')).toEqual([])
  })

  it('accepts a row built from the types, which is what keeps the shapes from being vacuous', () => {
    expect(shapeViolations(SITE_CLIENT_ROW_SHAPE, aClientRow())).toEqual([])
    expect(shapeViolations(SITE_EVENT_ROW_SHAPE, anEventRow())).toEqual([])
    expect(shapeViolations(SITE_ACCOUNT_ROW_SHAPE, anAccountRow())).toEqual([])
  })

  it.each([
    ['client', SITE_CLIENT_ROW_SHAPE, aClientRow()],
    ['event', SITE_EVENT_ROW_SHAPE, anEventRow()],
    ['account', SITE_ACCOUNT_ROW_SHAPE, anAccountRow()],
  ])('refuses a %s row that grew a field the shape does not name', (_row, shape, row) => {
    const grown = { ...row, slug: 'camille-et-sacha' }

    expect(shapeViolations(shape, grown)).toEqual([{ path: 'slug', problem: 'unexpectedKey' }])
  })

  it('refuses an event row that carries its name, which is D-06 in one line', () => {
    const named = { ...anEventRow(), name: 'Camille & Sacha' }

    expect(shapeViolations(SITE_EVENT_ROW_SHAPE, named)).toEqual([
      { path: 'name', problem: 'unexpectedKey' },
    ])
  })

  it('refuses an account row that carries its display name or its hash', () => {
    const leaky = { ...anAccountRow(), displayName: 'Camille', passwordHash: 'hash:x' }

    expect(
      shapeViolations(SITE_ACCOUNT_ROW_SHAPE, leaky).map((violation) => violation.path),
    ).toEqual(['displayName', 'passwordHash'])
  })
})
