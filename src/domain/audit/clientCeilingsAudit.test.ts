import { describe, expect, it } from 'vitest'
import { Client } from '../clients/client'
import { ClientCeilings, type ClientCeilingsInput } from '../clients/clientCeilings'
import type { DomainError } from '../shared/errors'
import { asClientId } from '../shared/ids'
import type { Result } from '../shared/result'
import { AuditEntry } from './auditEntry'
import { describeCeilingsChange, describeClientCreation } from './clientCeilingsAudit'

const AT = new Date('2026-06-20T21:00:00.000Z')
const NEXT_DAY = new Date('2026-06-21T21:00:00.000Z')
const REASON = 'Capacité du disque revue à la baisse'

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

    expect(describeCeilingsChange(client, client, REASON)).toEqual([])
  })

  it('treats two equal instants held in different Date objects as unchanged', () => {
    const before = aClientWith({ periodStartedAt: AT })
    const after = aClientWith({ periodStartedAt: new Date(AT.getTime()) })

    expect(describeCeilingsChange(before, after, REASON)).toEqual([])
  })

  it('writes client.ceilingsChanged with a full before and after when a ceiling changed', () => {
    const before = aClientWith({ maxEvents: 5, maxRetentionDays: 90 })
    const after = aClientWith({ maxEvents: 6, maxRetentionDays: 90 })

    const planned = describeCeilingsChange(before, after, REASON)

    expect(planned).toHaveLength(1)
    expect(planned[0]?.action).toBe('client.ceilingsChanged')
    expect(planned[0]?.details).toEqual({
      before: expect.objectContaining({ maxEvents: 5, maxRetentionDays: 90 }),
      after: expect.objectContaining({ maxEvents: 6, maxRetentionDays: 90 }),
      reason: REASON,
    })
  })

  it('records an unset ceiling as null on the side where it is unset', () => {
    const before = aClientWith({ maxEvents: 5 })
    const after = aClientWith({ maxEvents: null })

    expect(describeCeilingsChange(before, after, REASON)[0]?.details).toEqual({
      before: expect.objectContaining({ maxEvents: 5 }),
      after: expect.objectContaining({ maxEvents: null }),
      reason: REASON,
    })
  })

  it('records a switch that was turned off, which is a change like any other', () => {
    const before = aClientWith({ clipsAllowed: true })
    const after = aClientWith({ clipsAllowed: false })

    expect(describeCeilingsChange(before, after, REASON).map((entry) => entry.action)).toEqual([
      'client.ceilingsChanged',
    ])
  })

  it('records the photo book switch turned off, and shows both sides of it', () => {
    const before = aClientWith({ booksAllowed: true })
    const after = aClientWith({ booksAllowed: false })

    expect(describeCeilingsChange(before, after, REASON)[0]?.details).toEqual({
      before: expect.objectContaining({ booksAllowed: true }),
      after: expect.objectContaining({ booksAllowed: false }),
      reason: REASON,
    })
  })

  it('records an instant as the text toISOString writes, never as a Date', () => {
    const before = aClientWith({ periodStartedAt: null })
    const after = aClientWith({ periodStartedAt: AT })

    expect(describeCeilingsChange(before, after, REASON)[0]?.details).toEqual({
      before: expect.objectContaining({ periodStartedAt: null }),
      after: expect.objectContaining({ periodStartedAt: '2026-06-20T21:00:00.000Z' }),
      reason: REASON,
    })
  })

  it('writes client.periodReset as well when the period moved, carrying the counter on both sides', () => {
    const before = aClientWith({ periodStartedAt: AT }, 4)
    const after = aClientWith({ periodStartedAt: NEXT_DAY }, 0)

    const planned = describeCeilingsChange(before, after, REASON)

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

    expect(describeCeilingsChange(before, after, REASON).map((entry) => entry.action)).toEqual([
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
    booksAllowed: true,
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
    booksAllowed: false,
    liveAllowed: false,
    maxLiveDays: 16,
    maxEventsPerPeriod: 17,
    periodStartedAt: NEXT_DAY,
  }

  it('writes all nine ceilings, each under its own name, on both sides', () => {
    const planned = describeCeilingsChange(aClientWith(BEFORE), aClientWith(AFTER), REASON)

    expect(planned[0]?.details).toEqual({
      before: {
        maxEvents: 1,
        maxTotalBytes: 2,
        maxEventQuotaBytes: 3,
        maxRetentionDays: 4,
        clipsAllowed: true,
        booksAllowed: true,
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
        booksAllowed: false,
        liveAllowed: false,
        maxLiveDays: 16,
        maxEventsPerPeriod: 17,
        periodStartedAt: '2026-06-21T21:00:00.000Z',
      },
      reason: REASON,
    })
  })

  it.each(Object.keys(BEFORE))(
    'writes a change to %s alone as a difference in that one key and no other',
    (key) => {
      const changed = aClientWith({ ...BEFORE, [key]: (AFTER as Record<string, unknown>)[key] })

      const details = describeCeilingsChange(aClientWith(BEFORE), changed, REASON)[0]?.details as {
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

    expect(describeCeilingsChange(before, after, REASON).map((entry) => entry.action)).toEqual([
      'client.ceilingsChanged',
      'client.periodReset',
    ])
  })

  it('writes client.periodReset when a period is set for the first time, and when it is cleared', () => {
    const none = aClientWith({ periodStartedAt: null }, 0)
    const some = aClientWith({ periodStartedAt: AT }, 3)

    const started = describeCeilingsChange(none, some, REASON)[1]?.details
    const cleared = describeCeilingsChange(some, none, REASON)[1]?.details

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

describe('describeClientCreation', () => {
  it('writes client.created with the full snapshot of what the client starts with', () => {
    const client = aClientWith({ maxEvents: 1, maxEventsPerPeriod: 6, periodStartedAt: AT })

    const planned = describeClientCreation(client)

    expect(planned.action).toBe('client.created')
    expect(planned.details).toEqual({
      ceilings: {
        maxEvents: 1,
        maxTotalBytes: null,
        maxEventQuotaBytes: null,
        maxRetentionDays: null,
        clipsAllowed: true,
        booksAllowed: true,
        liveAllowed: true,
        maxLiveDays: null,
        maxEventsPerPeriod: 6,
        periodStartedAt: '2026-06-20T21:00:00.000Z',
      },
    })
  })

  it('is written for a client with no ceiling at all too: that it was never limited is a fact about its first day', () => {
    const planned = describeClientCreation(aClientWith({}))

    expect(planned.details).toEqual({
      ceilings: expect.objectContaining({ maxEvents: null, clipsAllowed: true, liveAllowed: true }),
    })
  })

  it('is an entry the log accepts, for the client it is about', () => {
    const client = aClientWith({ maxEvents: 2 })
    const planned = describeClientCreation(client)

    const entry = AuditEntry.create({
      at: AT,
      actor: { kind: 'system', label: 'provision-client-owner' },
      action: planned.action,
      subject: { type: 'client', id: client.id },
      clientId: client.id,
      details: planned.details,
    })

    expect(entry.ok).toBe(true)
  })

  it('carries nothing but the ceilings: no name, no address, no locale', () => {
    const client = aClientWith({ maxEvents: 2 })

    const text = JSON.stringify(describeClientCreation(client).details)

    expect(text).not.toContain('Atelier Photo Camille')
    expect(Object.keys(describeClientCreation(client).details)).toEqual(['ceilings'])
  })
})
