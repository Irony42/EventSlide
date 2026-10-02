import { describe, expect, it } from 'vitest'
import { Client } from '../clients/client'
import { ClientCeilings, type ClientCeilingsInput } from '../clients/clientCeilings'
import type { DomainError } from '../shared/errors'
import { asClientId } from '../shared/ids'
import type { Result } from '../shared/result'
import { describeCeilingsChange } from './clientCeilingsAudit'

const AT = new Date('2026-06-20T21:00:00.000Z')
const NEXT_DAY = new Date('2026-06-21T21:00:00.000Z')

const must = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected: ${result.error.code}`)
  return result.value
}

const aClientWith = (ceilings: ClientCeilingsInput, eventsCreatedInPeriod = 0): Client => {
  const created = must(
    Client.create(
      { name: 'Atelier Photo Camille', ceilings: must(ClientCeilings.create(ceilings)) },
      asClientId('client-1'),
      AT,
    ),
  )
  return Client.restore({ ...created.toProps(), eventsCreatedInPeriod })
}

describe('describeCeilingsChange', () => {
  it('writes nothing when nothing changed, so a patch that restates the ceilings is not an act on the client', () => {
    const client = aClientWith({ maxEvents: 5, periodStartedAt: AT })

    expect(describeCeilingsChange(client, client)).toEqual([])
  })

  it('treats two equal instants held in different Date objects as unchanged', () => {
    const before = aClientWith({ periodStartedAt: AT })
    const after = aClientWith({ periodStartedAt: new Date(AT.getTime()) })

    expect(describeCeilingsChange(before, after)).toEqual([])
  })

  it('writes client.ceilingsChanged with a full before and after when a ceiling changed', () => {
    const before = aClientWith({ maxEvents: 5, maxRetentionDays: 90 })
    const after = aClientWith({ maxEvents: 6, maxRetentionDays: 90 })

    const planned = describeCeilingsChange(before, after)

    expect(planned).toHaveLength(1)
    expect(planned[0]?.action).toBe('client.ceilingsChanged')
    expect(planned[0]?.details).toEqual({
      before: expect.objectContaining({ maxEvents: 5, maxRetentionDays: 90 }),
      after: expect.objectContaining({ maxEvents: 6, maxRetentionDays: 90 }),
    })
  })

  it('records an unset ceiling as null on the side where it is unset', () => {
    const before = aClientWith({ maxEvents: 5 })
    const after = aClientWith({ maxEvents: null })

    expect(describeCeilingsChange(before, after)[0]?.details).toEqual({
      before: expect.objectContaining({ maxEvents: 5 }),
      after: expect.objectContaining({ maxEvents: null }),
    })
  })

  it('records a switch that was turned off, which is a change like any other', () => {
    const before = aClientWith({ clipsAllowed: true })
    const after = aClientWith({ clipsAllowed: false })

    expect(describeCeilingsChange(before, after).map((entry) => entry.action)).toEqual([
      'client.ceilingsChanged',
    ])
  })

  it('records an instant as the text toISOString writes, never as a Date', () => {
    const before = aClientWith({ periodStartedAt: null })
    const after = aClientWith({ periodStartedAt: AT })

    expect(describeCeilingsChange(before, after)[0]?.details).toEqual({
      before: expect.objectContaining({ periodStartedAt: null }),
      after: expect.objectContaining({ periodStartedAt: '2026-06-20T21:00:00.000Z' }),
    })
  })

  it('writes client.periodReset as well when the period moved, carrying the counter on both sides', () => {
    const before = aClientWith({ periodStartedAt: AT }, 4)
    const after = aClientWith({ periodStartedAt: NEXT_DAY }, 0)

    const planned = describeCeilingsChange(before, after)

    expect(planned.map((entry) => entry.action)).toEqual([
      'client.ceilingsChanged',
      'client.periodReset',
    ])
    expect(planned[1]?.details).toEqual({
      before: { periodStartedAt: '2026-06-20T21:00:00.000Z', eventsCreatedInPeriod: 4 },
      after: { periodStartedAt: '2026-06-21T21:00:00.000Z', eventsCreatedInPeriod: 0 },
    })
  })

  it('does not write client.periodReset for an ordinary edit that leaves the period alone', () => {
    const before = aClientWith({ maxEvents: 5, periodStartedAt: AT }, 4)
    const after = aClientWith({ maxEvents: 6, periodStartedAt: AT }, 4)

    expect(describeCeilingsChange(before, after).map((entry) => entry.action)).toEqual([
      'client.ceilingsChanged',
    ])
  })
})
