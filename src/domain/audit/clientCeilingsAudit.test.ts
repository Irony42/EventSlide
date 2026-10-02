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

  // ------------------------------- every ceiling lands under its own name in the entry --

  /**
   * Nine ceilings, every one distinct and none at its default, so a snapshot that dropped a
   * key, hard-coded one, or put one ceiling's value under another's name cannot be equal to
   * what a client's owner is told.
   */
  const BEFORE: ClientCeilingsInput = {
    maxEvents: 1,
    maxTotalBytes: 2,
    maxEventQuotaBytes: 3,
    maxRetentionDays: 4,
    clipsAllowed: true,
    liveAllowed: true,
    maxLiveDays: 6,
    maxEventsPerPeriod: 7,
    periodStartedAt: AT,
  }

  const AFTER: ClientCeilingsInput = {
    maxEvents: 11,
    maxTotalBytes: 12,
    maxEventQuotaBytes: 13,
    maxRetentionDays: 14,
    clipsAllowed: false,
    liveAllowed: false,
    maxLiveDays: 16,
    maxEventsPerPeriod: 17,
    periodStartedAt: NEXT_DAY,
  }

  it('writes all nine ceilings, each under its own name, on both sides', () => {
    const planned = describeCeilingsChange(aClientWith(BEFORE), aClientWith(AFTER))

    expect(planned[0]?.details).toEqual({
      before: {
        maxEvents: 1,
        maxTotalBytes: 2,
        maxEventQuotaBytes: 3,
        maxRetentionDays: 4,
        clipsAllowed: true,
        liveAllowed: true,
        maxLiveDays: 6,
        maxEventsPerPeriod: 7,
        periodStartedAt: '2026-06-20T21:00:00.000Z',
      },
      after: {
        maxEvents: 11,
        maxTotalBytes: 12,
        maxEventQuotaBytes: 13,
        maxRetentionDays: 14,
        clipsAllowed: false,
        liveAllowed: false,
        maxLiveDays: 16,
        maxEventsPerPeriod: 17,
        periodStartedAt: '2026-06-21T21:00:00.000Z',
      },
    })
  })

  it.each(Object.keys(BEFORE))(
    'writes a change to %s alone as a difference in that one key and no other',
    (key) => {
      const changed = aClientWith({ ...BEFORE, [key]: (AFTER as Record<string, unknown>)[key] })

      const details = describeCeilingsChange(aClientWith(BEFORE), changed)[0]?.details as {
        before: Record<string, unknown>
        after: Record<string, unknown>
      }

      const differing = Object.keys(details.before).filter(
        (name) => details.before[name] !== details.after[name],
      )
      expect(differing).toEqual([key])
    },
  )

  it('writes client.periodReset when the period moves while the counter was already zero', () => {
    const before = aClientWith({ periodStartedAt: AT }, 0)
    const after = aClientWith({ periodStartedAt: NEXT_DAY }, 0)

    expect(describeCeilingsChange(before, after).map((entry) => entry.action)).toEqual([
      'client.ceilingsChanged',
      'client.periodReset',
    ])
  })

  it('writes client.periodReset when a period is set for the first time, and when it is cleared', () => {
    const none = aClientWith({ periodStartedAt: null }, 0)
    const some = aClientWith({ periodStartedAt: AT }, 3)

    const started = describeCeilingsChange(none, some)[1]?.details
    const cleared = describeCeilingsChange(some, none)[1]?.details

    expect(started).toEqual({
      before: { periodStartedAt: null, eventsCreatedInPeriod: 0 },
      after: { periodStartedAt: '2026-06-20T21:00:00.000Z', eventsCreatedInPeriod: 3 },
    })
    expect(cleared).toEqual({
      before: { periodStartedAt: '2026-06-20T21:00:00.000Z', eventsCreatedInPeriod: 3 },
      after: { periodStartedAt: null, eventsCreatedInPeriod: 0 },
    })
  })
})
