import { describe, expect, it } from 'vitest'
import { Event } from '../events/event'
import { EventName } from '../events/eventName'
import { EventSettings } from '../events/eventSettings'
import type { DomainError } from '../shared/errors'
import { asClientId, asEventId, asUserId } from '../shared/ids'
import { JoinCode } from '../shared/joinCode'
import type { Result } from '../shared/result'
import { Slug } from '../shared/slug'
import { Client } from './client'
import { exportAllowed } from './exportAllowed'

/**
 * Spec 22, rule 8: who may take the album out. A suspension without an offboarding refuses, a
 * suspension that comes with an offboarding does not, and an event the operator took down is never
 * there, whatever else is true.
 */

const DAY = 86_400_000
const AT = new Date('2026-12-01T12:00:00.000Z')

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected: ${result.error.code}`)
  return result.value
}

const anEvent = (
  overrides: { clientSuspendedAt?: Date | null; takenDownAt?: Date | null } = {},
): Event =>
  Event.restore({
    id: asEventId('evt-1'),
    ownerId: asUserId('usr-1'),
    name: unwrap(EventName.create('Mariage')),
    slug: unwrap(Slug.create('mariage')),
    joinCode: unwrap(JoinCode.create('H7K2QM')),
    status: 'closed',
    settings: unwrap(EventSettings.create({})),
    quotaBytes: 1_000,
    createdAt: AT,
    startsAt: null,
    clientId: asClientId('client-1'),
    closedAt: AT,
    openedAt: AT,
    scheduledOpenAt: null,
    scheduledCloseAt: null,
    scheduleDiscardedAt: null,
    ...overrides,
  })

const aClient = (purgeAfter: Date | null): Client =>
  Client.restore({
    ...unwrap(Client.create({ name: 'Atelier' }, asClientId('client-1'), AT)).toProps(),
    suspendedAt: AT,
    purgeAfter,
  })

const offboarding = aClient(new Date(AT.getTime() + 30 * DAY))
const abusive = aClient(null)

describe('exportAllowed', () => {
  it('lets a member of an event nobody suspended take the album out', () => {
    expect(exportAllowed(anEvent(), null).ok).toBe(true)
  })

  it('refuses a suspended client that is not being offboarded, so an abuse suspension still cuts the export', () => {
    const result = exportAllowed(anEvent({ clientSuspendedAt: AT }), abusive)

    expect(!result.ok && result.error.code).toBe('client.suspended')
  })

  it('lets a suspended client export once its offboarding has begun, which is what the grace period is for', () => {
    expect(exportAllowed(anEvent({ clientSuspendedAt: AT }), offboarding).ok).toBe(true)
  })

  it('refuses an event whose client cannot be found, rather than guessing it is being offboarded', () => {
    const result = exportAllowed(anEvent({ clientSuspendedAt: AT }), null)

    expect(!result.ok && result.error.code).toBe('client.suspended')
  })

  it('answers as for an event that is not there when the operator took it down, even during an offboarding', () => {
    const result = exportAllowed(anEvent({ clientSuspendedAt: AT, takenDownAt: AT }), offboarding)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers the same for a taken-down event that nobody suspended', () => {
    const result = exportAllowed(anEvent({ takenDownAt: AT }), null)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
