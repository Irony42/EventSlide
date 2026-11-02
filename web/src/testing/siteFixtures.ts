import type {
  CeilingsDto,
  SiteAccountDto,
  SiteAuditEntryDto,
  ClientDefaultsDto,
  SiteClientDto,
  SiteEventDto,
  OperatorInvitationByLinkDto,
  OperatorInvitationByMailDto,
} from '../lib/api/dto'

/**
 * What the operator's `/api/site/*` reads answer, as builders for a component test.
 *
 * Every row is a shape and a size: there is no event name, slug, join code, caption or guest to
 * build here, because the server has none to send. A test that wants to prove the console prints
 * nothing of the kind plants a distinctive string somewhere else and looks for it in the DOM.
 *
 * Ids are `z.guid()`-shaped, as the server mints them, and instants are fixed, so no test depends
 * on the day it runs.
 */

export const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const OTHER_CLIENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const OPERATOR_ID = '11111111-1111-4111-8111-111111111111'
export const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
export const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

/** No ceiling at all, the way a box with no `NEW_CLIENT_*` provisions a client. */
export const noCeilings = (): CeilingsDto => ({
  maxEvents: null,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: null,
  clipsAllowed: true,
  booksAllowed: true,
  liveAllowed: true,
  maxLiveDays: null,
  maxEventsPerPeriod: null,
  periodStartedAt: null,
})

export const aSiteClient = (overrides: Partial<SiteClientDto> = {}): SiteClientDto => ({
  id: CLIENT_ID,
  name: 'Atelier Alpha',
  createdAt: '2026-06-20T21:00:00.000Z',
  suspendedAt: null,
  purgeAfter: null,
  ceilings: { ...noCeilings(), maxEvents: 3, maxTotalBytes: 5_000_000_000 },
  eventsCreatedInPeriod: 1,
  usage: { eventCount: 1, liveEventCount: 1, memberCount: 2, usedBytes: 1_000_000 },
  ...overrides,
})

export const aSiteEvent = (overrides: Partial<SiteEventDto> = {}): SiteEventDto => ({
  id: EVENT_ID,
  status: 'live',
  createdAt: '2026-06-20T21:00:00.000Z',
  startsAt: '2026-07-04T18:00:00.000Z',
  openedAt: '2026-07-04T17:30:00.000Z',
  closedAt: null,
  quotaBytes: 2_000_000_000,
  usedBytes: 500_000_000,
  photoCount: 42,
  ...overrides,
})

export const aSiteAccount = (overrides: Partial<SiteAccountDto> = {}): SiteAccountDto => ({
  id: ACCOUNT_ID,
  email: 'camille@example.com',
  siteRole: 'none',
  createdAt: '2026-06-20T21:00:00.000Z',
  lastLoginAt: '2026-06-21T08:00:00.000Z',
  disabledAt: null,
  mustChangePassword: false,
  ownedEventCount: 1,
  clients: [{ clientId: CLIENT_ID, role: 'owner' }],
  termsVersion: '2026-11',
  termsAcceptedAt: '2026-06-20T21:00:00.000Z',
  ...overrides,
})

export const aSiteAuditEntry = (overrides: Partial<SiteAuditEntryDto> = {}): SiteAuditEntryDto => ({
  seq: 17,
  at: '2026-06-20T21:00:00.000Z',
  action: 'client.suspended',
  actor: { kind: 'operator', userId: OPERATOR_ID, label: null },
  subject: { type: 'client', id: CLIENT_ID },
  clientId: CLIENT_ID,
  details: {},
  ...overrides,
})

export const aSiteInvitation = (
  overrides: Partial<OperatorInvitationByMailDto> = {},
): OperatorInvitationByMailDto => ({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  delivery: 'mail',
  expiresAt: '2026-06-27T21:00:00.000Z',
  pendingApproval: false,
  ...overrides,
})

/** An invitation no mail carried: the one case in which the server answers a link. */
export const aLinkInvitation = (
  link: string,
  overrides: Partial<OperatorInvitationByLinkDto> = {},
): OperatorInvitationByLinkDto => ({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  delivery: 'link',
  expiresAt: '2026-06-27T21:00:00.000Z',
  pendingApproval: false,
  link,
  ...overrides,
})

/** A box that set no `NEW_CLIENT_*`: six null ceilings and clips allowed. */
export const aSiteClientDefaults = (
  overrides: Partial<ClientDefaultsDto['ceilings']> = {},
): ClientDefaultsDto => ({
  ceilings: {
    maxEvents: null,
    maxEventsPerPeriod: null,
    maxTotalBytes: null,
    maxEventQuotaBytes: null,
    maxRetentionDays: null,
    maxLiveDays: null,
    clipsAllowed: true,
    booksAllowed: true,
    ...overrides,
  },
})
