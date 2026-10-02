import type { Client } from '../../domain/clients/client'
import { holdsStagedBytes } from '../../domain/clips/clipJobStatus'
import type { ClipJob } from '../../domain/clips/clipJob'
import type { Event } from '../../domain/events/event'
import type { Guest } from '../../domain/guests/guest'
import type { Mission } from '../../domain/missions/mission'
import type { Photo } from '../../domain/photos/photo'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'
import type {
  SiteAccountRow,
  SiteClientRow,
  SiteEventRow,
} from '../../domain/site/siteOverviewRows'
import type { User } from '../../domain/users/user'
import type { ClientMembership } from '../ports/clientRepository'
import type {
  SiteAccountPage,
  SiteClientPage,
  SiteEventPage,
  SiteOverview,
  SitePage,
  SitePageRequest,
} from '../ports/siteOverview'

/**
 * Everything a world is built from, written the way the real tables are written.
 *
 * The operator's overview reads across six tables (clients, events, photographs, clip jobs,
 * accounts, memberships) and is *tested* by planting content in two more (guests and
 * missions) to prove it does not come out. So a subject of `siteOverviewContract` has to
 * accept all of them, in whatever storage it has: the SQLite subject writes through the real
 * repositories, and {@link FakeSiteOverview} keeps them in memory. Order matters only to the
 * real one — accounts, then clients, then everything that names them.
 */
export interface SiteWorld {
  addAccount(user: User): Promise<void>
  addClient(client: Client): Promise<void>
  addClientMember(membership: ClientMembership): Promise<void>
  addEvent(event: Event): Promise<void>
  addGuest(guest: Guest): Promise<void>
  addMission(mission: Mission): Promise<void>
  addPhoto(photo: Photo): Promise<void>
  addClipJob(job: ClipJob): Promise<void>
}

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

/** `ORDER BY created_at DESC, id DESC`, which is the adapter's order for all three listings. */
const newestFirst = (
  left: { readonly createdAt: Date; readonly id: string },
  right: { readonly createdAt: Date; readonly id: string },
): number => right.createdAt.getTime() - left.createdAt.getTime() || compareIds(right.id, left.id)

const assertLimit = (limit: number): void => {
  // The same refusal as the adapter's: `LIMIT -1` reads everything in SQLite and `LIMIT 0`
  // reads nothing, and a fake that guessed would hide a caller that relied on either.
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`SiteOverview requires a positive integer limit, got ${limit}`)
  }
}

/**
 * One keyset page of rows already in order. An unknown cursor is an empty page, never a
 * restart from the top — the same rule the adapter keeps.
 */
const pageOf = <Row extends { readonly id: Id }, Id extends string>(
  ordered: readonly Row[],
  request: SitePageRequest<Id>,
): SitePage<Row, Id> => {
  assertLimit(request.limit)

  let start = 0
  if (request.after !== undefined) {
    const at = ordered.findIndex((row) => row.id === request.after)
    if (at === -1) return { items: [], next: null }
    start = at + 1
  }

  const items = ordered.slice(start, start + request.limit)
  const last = items[items.length - 1]
  const hasMore = start + request.limit < ordered.length
  return { items, next: hasMore && last !== undefined ? last.id : null }
}

/**
 * In-memory {@link SiteOverview}.
 *
 * It stores **everything a world contains, content included** — guests, missions, captions,
 * event names — and derives its rows from the part the overview is allowed to read. That is
 * the honest way to fake a read model whose whole value is what it leaves out: a fake that
 * were given only ids and sizes could never leak, and the contract's content sweep would
 * pass against it for the wrong reason.
 */
export class FakeSiteOverview implements SiteOverview, SiteWorld {
  private readonly accounts = new Map<UserId, User>()
  private readonly clients = new Map<ClientId, Client>()
  private readonly members: ClientMembership[] = []
  private readonly events = new Map<EventId, Event>()
  private readonly guests: Guest[] = []
  private readonly missions: Mission[] = []
  private readonly photos: Photo[] = []
  private readonly clipJobs: ClipJob[] = []

  // ---------------------------------------------------------------- the world --

  async addAccount(user: User): Promise<void> {
    this.accounts.set(user.id, user)
  }

  async addClient(client: Client): Promise<void> {
    this.clients.set(client.id, client)
  }

  async addClientMember(membership: ClientMembership): Promise<void> {
    this.members.push(membership)
  }

  async addEvent(event: Event): Promise<void> {
    this.events.set(event.id, event)
  }

  async addGuest(guest: Guest): Promise<void> {
    this.guests.push(guest)
  }

  async addMission(mission: Mission): Promise<void> {
    this.missions.push(mission)
  }

  async addPhoto(photo: Photo): Promise<void> {
    this.photos.push(photo)
  }

  async addClipJob(job: ClipJob): Promise<void> {
    this.clipJobs.push(job)
  }

  // ------------------------------------------------------------------ sizing --

  private eventsOf(clientId: ClientId): readonly Event[] {
    return [...this.events.values()].filter((event) => event.clientId === clientId)
  }

  /**
   * `eventHoldingBytesSum` in plain code: photographs of every status plus the staged
   * source of every clip job that still holds one. The two are written once each and the
   * contract holds them to the same worked figures.
   */
  private usedBytes(eventId: EventId): number {
    const photos = this.photos
      .filter((photo) => photo.eventId === eventId)
      .reduce((sum, photo) => sum + photo.byteSize, 0)
    const staged = this.clipJobs
      .filter((job) => job.eventId === eventId && holdsStagedBytes(job.status))
      .reduce((sum, job) => sum + job.sourceByteSize, 0)
    return photos + staged
  }

  // -------------------------------------------------------------------- rows --

  private clientRow(client: Client): SiteClientRow {
    const events = this.eventsOf(client.id)
    return {
      id: client.id,
      name: client.name.value,
      createdAt: client.createdAt,
      suspendedAt: client.suspendedAt,
      purgeAfter: client.purgeAfter,
      ceilings: client.ceilings.toProps(),
      eventsCreatedInPeriod: client.eventsCreatedInPeriod,
      usage: {
        eventCount: events.length,
        liveEventCount: events.filter((event) => event.status === 'live').length,
        memberCount: this.members.filter((member) => member.clientId === client.id).length,
        usedBytes: events.reduce((sum, event) => sum + this.usedBytes(event.id), 0),
      },
    }
  }

  private eventRow(event: Event): SiteEventRow {
    return {
      id: event.id,
      status: event.status,
      createdAt: event.createdAt,
      startsAt: event.startsAt,
      openedAt: event.openedAt,
      closedAt: event.closedAt,
      quotaBytes: event.quotaBytes,
      usedBytes: this.usedBytes(event.id),
      photoCount: this.photos.filter((photo) => photo.eventId === event.id).length,
    }
  }

  private accountRow(user: User): SiteAccountRow {
    const memberships = this.members
      .filter((member) => member.userId === user.id)
      .sort(
        (left, right) =>
          right.grantedAt.getTime() - left.grantedAt.getTime() ||
          compareIds(left.clientId, right.clientId),
      )
    return {
      id: user.id,
      email: user.email.value,
      siteRole: user.siteRole,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      disabledAt: user.disabledAt,
      mustChangePassword: user.mustChangePassword,
      ownedEventCount: [...this.events.values()].filter((event) => event.ownerId === user.id)
        .length,
      clients: memberships.map((member) => ({ clientId: member.clientId, role: member.role })),
    }
  }

  // -------------------------------------------------------------- the port --

  async listClients(page: SitePageRequest<ClientId>): Promise<SiteClientPage> {
    const ordered = [...this.clients.values()].sort(newestFirst).map((c) => this.clientRow(c))
    return pageOf(ordered, page)
  }

  async clientEvents(
    clientId: ClientId,
    page: SitePageRequest<EventId>,
  ): Promise<SiteEventPage | null> {
    // Validated before the lookup, as the adapter does, so a bad limit never depends on
    // whether the client exists.
    assertLimit(page.limit)
    if (!this.clients.has(clientId)) return null

    const ordered = [...this.eventsOf(clientId)].sort(newestFirst).map((e) => this.eventRow(e))
    return pageOf(ordered, page)
  }

  async listAccounts(page: SitePageRequest<UserId>): Promise<SiteAccountPage> {
    const ordered = [...this.accounts.values()].sort(newestFirst).map((u) => this.accountRow(u))
    return pageOf(ordered, page)
  }
}
