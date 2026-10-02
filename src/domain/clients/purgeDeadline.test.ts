import { describe, expect, it } from 'vitest'
import { Event } from '../events/event'
import { EventName } from '../events/eventName'
import { EventSettings } from '../events/eventSettings'
import type { EventStatus } from '../events/eventStatus'
import type { DomainError } from '../shared/errors'
import { asClientId, asEventId, asUserId } from '../shared/ids'
import { JoinCode } from '../shared/joinCode'
import type { Result } from '../shared/result'
import { Slug } from '../shared/slug'
import { Client } from './client'
import { ClientCeilings, type ClientCeilingsInput } from './clientCeilings'
import { purgeDeadline } from './purgeDeadline'

/**
 * The instant an event's media may first be deleted, once the client's ceilings are in
 * the picture (roadmap §10.5 / P3-06 "contrat purge").
 *
 * Every case is stated in days from `TODAY`, because the contract is a calendar: "closed 60
 * days ago, ceiling set today to 30" is a sentence a client was told, and the arithmetic
 * below is what that sentence has to come out as.
 */

const DAY = 86_400_000
const NOTICE_DAYS = 30
const TODAY = new Date('2026-09-01T12:00:00.000Z')
const day = (offset: number): Date => new Date(TODAY.getTime() + offset * DAY)

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected: ${result.error.code}`)
  return result.value
}

interface EventCase {
  readonly status?: EventStatus
  readonly closedAt?: Date | null
  readonly openedAt?: Date | null
  /** The host's own `retentionDays`; `null` is "keep forever". */
  readonly retentionDays?: number | null
  readonly clientId?: string | null
}

const anEvent = (input: EventCase = {}): Event =>
  Event.restore({
    id: asEventId('evt-1'),
    ownerId: asUserId('usr-1'),
    name: unwrap(EventName.create('Mariage')),
    slug: unwrap(Slug.create('mariage')),
    joinCode: unwrap(JoinCode.create('H7K2QM')),
    status: input.status ?? 'closed',
    settings: unwrap(EventSettings.create({ retentionDays: input.retentionDays ?? null })),
    quotaBytes: 1_000,
    createdAt: day(-100),
    startsAt: null,
    clientId:
      input.clientId === undefined || input.clientId === null ? null : asClientId(input.clientId),
    closedAt: input.closedAt === undefined ? day(-10) : input.closedAt,
    openedAt: input.openedAt === undefined ? null : input.openedAt,
    scheduledOpenAt: null,
    scheduledCloseAt: null,
    scheduleDiscardedAt: null,
  })

interface ClientCase extends ClientCeilingsInput {
  readonly retentionCapSince?: Date | null
  readonly purgeAfter?: Date | null
}

const aClient = (input: ClientCase = {}): Client => {
  const { retentionCapSince, purgeAfter, ...ceilings } = input
  const created = unwrap(
    Client.create(
      { name: 'Atelier', ceilings: unwrap(ClientCeilings.create(ceilings)) },
      asClientId('client-1'),
      day(-200),
    ),
  )
  return Client.restore({
    ...created.toProps(),
    retentionCapSince: retentionCapSince ?? null,
    purgeAfter: purgeAfter ?? null,
  })
}

const deadline = (event: Event, client: Client | null): Date | null =>
  purgeDeadline(event, client, NOTICE_DAYS)

describe('purgeDeadline for an event with no client', () => {
  it('is never, for an event kept for ever: nothing here changes what a self-hoster has always had', () => {
    expect(deadline(anEvent({ retentionDays: null }), null)).toBeNull()
  })

  it('is closed_at + the host’s own retention', () => {
    expect(deadline(anEvent({ closedAt: day(-10), retentionDays: 30 }), null)).toEqual(day(20))
  })

  it('is exactly what Event.retentionDeadline says, so the two cannot be two rules', () => {
    const event = anEvent({ closedAt: day(-3), retentionDays: 7 })

    expect(deadline(event, null)).toEqual(event.retentionDeadline())
  })
})

describe('purgeDeadline while no retention clock is running', () => {
  it.each<EventStatus>(['draft', 'live'])(
    'is never for a %s event, whatever its client says',
    (status) => {
      const client = aClient({ maxRetentionDays: 1, maxLiveDays: 1, purgeAfter: day(-1) })

      expect(deadline(anEvent({ status, closedAt: null, openedAt: day(-50) }), client)).toBeNull()
    },
  )

  it('is never for a closed event that has no closing instant, which only a hand-edited row has', () => {
    const client = aClient({ maxRetentionDays: 1, purgeAfter: day(-1) })

    expect(deadline(anEvent({ status: 'closed', closedAt: null }), client)).toBeNull()
  })
})

describe('purgeDeadline for an event of a client with no ceiling on retention', () => {
  it('is never for an event kept for ever', () => {
    expect(deadline(anEvent({ retentionDays: null, clientId: 'client-1' }), aClient())).toBeNull()
  })

  it('is the host’s own retention', () => {
    const event = anEvent({ closedAt: day(-10), retentionDays: 30, clientId: 'client-1' })

    expect(deadline(event, aClient())).toEqual(day(20))
  })
})

describe('purgeDeadline under max_retention_days', () => {
  const event = (overrides: EventCase = {}): Event =>
    anEvent({ closedAt: day(-10), clientId: 'client-1', ...overrides })

  it('turns "keep for ever" into closed_at + the ceiling, which is the NULL trap closed', () => {
    expect(deadline(event({ retentionDays: null }), aClient({ maxRetentionDays: 30 }))).toEqual(
      day(20),
    )
  })

  it('takes the host’s own retention when it is the shorter', () => {
    expect(deadline(event({ retentionDays: 7 }), aClient({ maxRetentionDays: 30 }))).toEqual(
      day(-3),
    )
  })

  it('takes the ceiling when the host’s retention is longer, as an event created before the ceiling is', () => {
    expect(deadline(event({ retentionDays: 90 }), aClient({ maxRetentionDays: 30 }))).toEqual(
      day(20),
    )
  })
})

describe('purgeDeadline when the ceiling was lowered, and the notice that goes with it', () => {
  /** Closed 60 days ago, kept for ever, under a ceiling an operator sets today. */
  const longClosed = (): Event =>
    anEvent({ closedAt: day(-60), retentionDays: null, clientId: 'client-1' })

  it('waits the whole notice for an event closed 60 days ago under a ceiling set today to 30', () => {
    const client = aClient({ maxRetentionDays: 30, retentionCapSince: TODAY })

    expect(deadline(longClosed(), client)).toEqual(day(30))
  })

  it('waits the same notice under a ceiling set today to 14, not 14 days', () => {
    const client = aClient({ maxRetentionDays: 14, retentionCapSince: TODAY })

    expect(deadline(longClosed(), client)).toEqual(day(30))
  })

  it('is closed_at + the ceiling once that is the later of the two', () => {
    // Closed today: 30 days of ceiling run past the notice that started 10 days ago.
    const event = anEvent({ closedAt: TODAY, retentionDays: null, clientId: 'client-1' })
    const client = aClient({ maxRetentionDays: 60, retentionCapSince: day(-10) })

    expect(deadline(event, client)).toEqual(day(60))
  })

  it('is the notice, not closed_at + the ceiling, once the notice is the later of the two', () => {
    const event = anEvent({ closedAt: day(-10), retentionDays: null, clientId: 'client-1' })
    const client = aClient({ maxRetentionDays: 30, retentionCapSince: TODAY })

    expect(deadline(event, client)).toEqual(day(30))
  })

  it('does not hold back what the host themselves asked for: their shorter retention is the promise', () => {
    // Closed 5 days ago, the host asked for 7. The ceiling arriving today does not make
    // that later; it was never what decided it.
    const event = anEvent({ closedAt: day(-5), retentionDays: 7, clientId: 'client-1' })
    const client = aClient({ maxRetentionDays: 14, retentionCapSince: TODAY })

    expect(deadline(event, client)).toEqual(day(2))
  })

  it('counts the notice in days of the number it is given, not a constant', () => {
    const client = aClient({ maxRetentionDays: 14, retentionCapSince: TODAY })

    expect(purgeDeadline(longClosed(), client, 45)).toEqual(day(45))
  })

  it('has no notice to wait for a ceiling nobody lowered, however large', () => {
    const client = aClient({ maxRetentionDays: 3_650, retentionCapSince: null })

    expect(deadline(longClosed(), client)).toEqual(day(-60 + 3_650))
  })
})

describe('purgeDeadline and the live window: a reopening does not push the purge back', () => {
  const client = (extra: ClientCase = {}): Client =>
    aClient({ maxRetentionDays: 30, maxLiveDays: 3, ...extra })

  it('is at the latest opened_at + max_live_days + max_retention_days, though closed_at ran later', () => {
    // Opened on day -40, closed for the last time on day -20 — far past its window, as an
    // event the sweep never reached would be. closed_at + 30 would say day 10.
    const event = anEvent({
      openedAt: day(-40),
      closedAt: day(-20),
      retentionDays: null,
      clientId: 'client-1',
    })

    expect(deadline(event, client())).toEqual(day(-7))
  })

  it('does not bring the purge forward for an event closed inside its window, which is the ordinary case', () => {
    const event = anEvent({
      openedAt: day(-5),
      closedAt: day(-4),
      retentionDays: null,
      clientId: 'client-1',
    })

    expect(deadline(event, client())).toEqual(day(26))
  })

  it('does not apply to an event that never opened, which has no window to count from', () => {
    const event = anEvent({
      status: 'archived',
      openedAt: null,
      closedAt: day(-20),
      retentionDays: null,
      clientId: 'client-1',
    })

    expect(deadline(event, client())).toEqual(day(10))
  })

  it('does not apply to a client with no max_live_days', () => {
    const event = anEvent({
      openedAt: day(-40),
      closedAt: day(-20),
      retentionDays: null,
      clientId: 'client-1',
    })

    expect(deadline(event, client({ maxLiveDays: null }))).toEqual(day(10))
  })

  it('does not apply to a client with no max_retention_days, which has no retention to add', () => {
    const event = anEvent({
      openedAt: day(-40),
      closedAt: day(-20),
      retentionDays: null,
      clientId: 'client-1',
    })

    expect(deadline(event, client({ maxRetentionDays: null }))).toBeNull()
  })

  it('still waits out a notice, because the notice is a promise the window does not cancel', () => {
    const event = anEvent({
      openedAt: day(-40),
      closedAt: day(-20),
      retentionDays: null,
      clientId: 'client-1',
    })

    expect(deadline(event, client({ retentionCapSince: TODAY }))).toEqual(day(30))
  })
})

describe('purgeDeadline when the client is being offboarded', () => {
  it('is purge_after, when that is earlier than the retention would be', () => {
    const event = anEvent({ closedAt: day(-1), retentionDays: null, clientId: 'client-1' })

    expect(deadline(event, aClient({ purgeAfter: day(5) }))).toEqual(day(5))
  })

  it('is the retention, when that is earlier than purge_after', () => {
    const event = anEvent({ closedAt: day(-10), retentionDays: 15, clientId: 'client-1' })

    expect(deadline(event, aClient({ purgeAfter: day(60) }))).toEqual(day(5))
  })

  it('leaves an event kept for ever alone while there is no purge_after', () => {
    const event = anEvent({ retentionDays: null, clientId: 'client-1' })

    expect(deadline(event, aClient({ purgeAfter: null }))).toBeNull()
  })
})
