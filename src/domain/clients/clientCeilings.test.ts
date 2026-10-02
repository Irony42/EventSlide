import { describe, expect, it } from 'vitest'
import { ClientCeilings, type ClientCeilingsProps } from './clientCeilings'

const must = (result: ReturnType<typeof ClientCeilings.create>): ClientCeilings => {
  if (!result.ok) throw new Error(`fixture rejected: ${result.error.code}`)
  return result.value
}

describe('ClientCeilings.create', () => {
  it('defaults every bound to unlimited, which is what a solo install’s one client has', () => {
    const ceilings = must(ClientCeilings.create())

    expect(ceilings.toProps()).toEqual<ClientCeilingsProps>({
      maxEvents: null,
      maxTotalBytes: null,
      maxEventQuotaBytes: null,
      maxRetentionDays: null,
      clipsAllowed: true,
      liveAllowed: true,
      maxLiveDays: null,
      maxEventsPerPeriod: null,
      periodStartedAt: null,
    })
  })

  it('accepts an empty object the same way as no argument at all', () => {
    expect(ClientCeilings.create({}).ok).toBe(true)
  })

  // ----------------------------------------------------------------- maxEvents --

  it('accepts a positive maxEvents', () => {
    expect(ClientCeilings.create({ maxEvents: 5 }).ok).toBe(true)
  })

  it('refuses a zero maxEvents, matching the table CHECK (max_events > 0)', () => {
    const result = ClientCeilings.create({ maxEvents: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxEventsInvalid')
  })

  it('refuses a negative maxEvents', () => {
    expect(ClientCeilings.create({ maxEvents: -1 }).ok).toBe(false)
  })

  it('refuses a non-integer maxEvents', () => {
    expect(ClientCeilings.create({ maxEvents: 1.5 }).ok).toBe(false)
  })

  // ------------------------------------------------------------- maxTotalBytes --

  it('accepts a positive maxTotalBytes', () => {
    expect(ClientCeilings.create({ maxTotalBytes: 1_000 }).ok).toBe(true)
  })

  it('refuses a zero maxTotalBytes, matching the table CHECK (max_total_bytes > 0)', () => {
    const result = ClientCeilings.create({ maxTotalBytes: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxTotalBytesInvalid')
  })

  // --------------------------------------------------------- maxEventQuotaBytes --

  it('accepts a positive maxEventQuotaBytes', () => {
    expect(ClientCeilings.create({ maxEventQuotaBytes: 1_000 }).ok).toBe(true)
  })

  it('refuses a zero maxEventQuotaBytes, matching the table CHECK (max_event_quota_bytes > 0)', () => {
    const result = ClientCeilings.create({ maxEventQuotaBytes: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxEventQuotaBytesInvalid')
  })

  // ----------------------------------------------------------- maxRetentionDays --

  it('accepts a maxRetentionDays at the lower bound of the table CHECK (1)', () => {
    expect(ClientCeilings.create({ maxRetentionDays: 1 }).ok).toBe(true)
  })

  it('accepts a maxRetentionDays at the upper bound of the table CHECK (3650)', () => {
    expect(ClientCeilings.create({ maxRetentionDays: 3650 }).ok).toBe(true)
  })

  it('refuses a maxRetentionDays of zero, one below the table CHECK', () => {
    const result = ClientCeilings.create({ maxRetentionDays: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxRetentionDaysInvalid')
  })

  it('refuses a maxRetentionDays of 3651, one past the table CHECK', () => {
    expect(ClientCeilings.create({ maxRetentionDays: 3651 }).ok).toBe(false)
  })

  it('refuses a non-integer maxRetentionDays', () => {
    expect(ClientCeilings.create({ maxRetentionDays: 10.5 }).ok).toBe(false)
  })

  it('reports the bound it enforced', () => {
    const result = ClientCeilings.create({ maxRetentionDays: 0 })

    expect(!result.ok && result.error.details).toEqual({ min: 1, max: 3650 })
  })

  // --------------------------------------------------------------- maxLiveDays --

  it('accepts a maxLiveDays at the lower bound of the table CHECK (1)', () => {
    expect(ClientCeilings.create({ maxLiveDays: 1 }).ok).toBe(true)
  })

  it('accepts a maxLiveDays at the upper bound of the table CHECK (365)', () => {
    expect(ClientCeilings.create({ maxLiveDays: 365 }).ok).toBe(true)
  })

  it('refuses a maxLiveDays of zero, one below the table CHECK', () => {
    const result = ClientCeilings.create({ maxLiveDays: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxLiveDaysInvalid')
  })

  it('refuses a maxLiveDays of 366, one past the table CHECK', () => {
    expect(ClientCeilings.create({ maxLiveDays: 366 }).ok).toBe(false)
  })

  // --------------------------------------------------------- maxEventsPerPeriod --

  it('accepts a positive maxEventsPerPeriod', () => {
    expect(ClientCeilings.create({ maxEventsPerPeriod: 30 }).ok).toBe(true)
  })

  it('refuses a zero maxEventsPerPeriod, matching the table CHECK (max_events_per_period > 0)', () => {
    const result = ClientCeilings.create({ maxEventsPerPeriod: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxEventsPerPeriodInvalid')
  })

  // ------------------------------------------------------------ flags and instant --

  it('accepts false for either flag', () => {
    expect(ClientCeilings.create({ clipsAllowed: false, liveAllowed: false }).ok).toBe(true)
  })

  it.each([undefined, 'false', 0, null])('refuses %s as clipsAllowed', (bad) => {
    const result = ClientCeilings.create({ clipsAllowed: bad as unknown as boolean })

    expect(!result.ok && result.error.code).toBe('clientCeilings.clipsAllowedInvalid')
  })

  it.each([undefined, 'true', 1, null])('refuses %s as liveAllowed', (bad) => {
    const result = ClientCeilings.create({ liveAllowed: bad as unknown as boolean })

    expect(!result.ok && result.error.code).toBe('clientCeilings.liveAllowedInvalid')
  })

  it('accepts a real period instant', () => {
    expect(
      ClientCeilings.create({ periodStartedAt: new Date('2026-06-20T00:00:00.000Z') }).ok,
    ).toBe(true)
  })

  it.each([new Date('not a date'), undefined, '2026-06-20T00:00:00.000Z'])(
    'refuses %s as periodStartedAt, which the adapter could not write',
    (bad) => {
      const result = ClientCeilings.create({ periodStartedAt: bad as unknown as Date })

      expect(!result.ok && result.error.code).toBe('clientCeilings.periodStartedAtInvalid')
    },
  )

  // -------------------------------------------------------------- restore/flags --

  it('restores a row the database already validated, trusting it rather than re-checking', () => {
    const ceilings = ClientCeilings.restore({
      maxEvents: 1,
      maxTotalBytes: null,
      maxEventQuotaBytes: null,
      maxRetentionDays: null,
      clipsAllowed: false,
      liveAllowed: false,
      maxLiveDays: 7,
      maxEventsPerPeriod: 1,
      periodStartedAt: new Date('2026-06-20T00:00:00.000Z'),
    })

    expect(ceilings.clipsAllowed).toBe(false)
    expect(ceilings.maxLiveDays).toBe(7)
  })

  it('exposes every ceiling through its own getter, not only through toProps', () => {
    const ceilings = ClientCeilings.restore({
      maxEvents: 2,
      maxTotalBytes: 500,
      maxEventQuotaBytes: 100,
      maxRetentionDays: 60,
      clipsAllowed: true,
      liveAllowed: true,
      maxLiveDays: 14,
      maxEventsPerPeriod: 30,
      periodStartedAt: new Date('2026-06-20T00:00:00.000Z'),
    })

    expect(ceilings.maxEvents).toBe(2)
    expect(ceilings.maxTotalBytes).toBe(500)
    expect(ceilings.maxEventQuotaBytes).toBe(100)
    expect(ceilings.maxRetentionDays).toBe(60)
    expect(ceilings.maxLiveDays).toBe(14)
    expect(ceilings.maxEventsPerPeriod).toBe(30)
    expect(ceilings.periodStartedAt).toEqual(new Date('2026-06-20T00:00:00.000Z'))
  })

  it('unlimited() cannot fail and needs no Result narrowing', () => {
    const ceilings = ClientCeilings.unlimited()

    expect(ceilings.maxEvents).toBeNull()
    expect(ceilings.clipsAllowed).toBe(true)
  })
})

describe('ClientCeilings.allowsAnotherEvent', () => {
  it('allows another event with no ceiling at all', () => {
    const ceilings = ClientCeilings.unlimited()

    expect(ceilings.allowsAnotherEvent(1_000_000, 1_000_000)).toBe(true)
  })

  it('allows another event under the total ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 5 }))

    expect(ceilings.allowsAnotherEvent(4, 0)).toBe(true)
  })

  it('refuses another event once the total ceiling is reached', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 5 }))

    expect(ceilings.allowsAnotherEvent(5, 0)).toBe(false)
  })

  it('allows another event under the per-period ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEventsPerPeriod: 30 }))

    expect(ceilings.allowsAnotherEvent(0, 29)).toBe(true)
  })

  it('refuses another event once the per-period ceiling is reached, with no total ceiling set', () => {
    const ceilings = must(ClientCeilings.create({ maxEventsPerPeriod: 30 }))

    expect(ceilings.allowsAnotherEvent(0, 30)).toBe(false)
  })
})

describe('ClientCeilings.creationRefusal', () => {
  it('refuses nothing with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().creationRefusal(1_000_000, 1_000_000)).toBeNull()
  })

  it('names the total ceiling, with what is used and what the bound is', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 5 }))

    expect(ceilings.creationRefusal(5, 0)).toEqual({ ceiling: 'events', used: 5, max: 5 })
  })

  it('names the per-period ceiling when it is the one reached', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 5, maxEventsPerPeriod: 2 }))

    // Three events now is under five; two created this period is not under two.
    expect(ceilings.creationRefusal(3, 2)).toEqual({ ceiling: 'eventsPerPeriod', used: 2, max: 2 })
  })

  it('names the total ceiling first when both are reached, so the answer is one thing', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 1, maxEventsPerPeriod: 1 }))

    expect(ceilings.creationRefusal(1, 1)?.ceiling).toBe('events')
  })

  it('refuses nothing one event under each ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 5, maxEventsPerPeriod: 30 }))

    expect(ceilings.creationRefusal(4, 29)).toBeNull()
  })

  it('agrees with allowsAnotherEvent, which is the same rule asked as a yes or no', () => {
    const ceilings = must(ClientCeilings.create({ maxEvents: 2, maxEventsPerPeriod: 3 }))

    for (const [total, created] of [
      [0, 0],
      [1, 2],
      [2, 0],
      [1, 3],
    ] as const) {
      expect(ceilings.allowsAnotherEvent(total, created)).toBe(
        ceilings.creationRefusal(total, created) === null,
      )
    }
  })
})

describe('ClientCeilings.admitsQuota', () => {
  it('admits any quota with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().admitsQuota(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('admits a quota at or under the ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEventQuotaBytes: 1_000 }))

    expect(ceilings.admitsQuota(1_000)).toBe(true)
  })

  it('refuses a quota over the ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEventQuotaBytes: 1_000 }))

    expect(ceilings.admitsQuota(1_001)).toBe(false)
  })
})

describe('ClientCeilings.clampRetention', () => {
  it('passes a finite request through unchanged with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().clampRetention(30)).toBe(30)
  })

  it('passes "keep forever" through unchanged with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().clampRetention(null)).toBeNull()
  })

  it('turns "keep forever" into the ceiling itself, once one exists', () => {
    const ceilings = must(ClientCeilings.create({ maxRetentionDays: 100 }))

    expect(ceilings.clampRetention(null)).toBe(100)
  })

  it('shortens a request above the ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxRetentionDays: 100 }))

    expect(ceilings.clampRetention(200)).toBe(100)
  })

  it('keeps a request already under the ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxRetentionDays: 100 }))

    expect(ceilings.clampRetention(30)).toBe(30)
  })
})

describe('ClientCeilings.allowsOpening', () => {
  it('allows opening by default', () => {
    expect(ClientCeilings.unlimited().allowsOpening()).toBe(true)
  })

  it('refuses opening when liveAllowed is false, as in quarantine or an expired Pass', () => {
    const ceilings = ClientCeilings.restore({
      maxEvents: null,
      maxTotalBytes: null,
      maxEventQuotaBytes: null,
      maxRetentionDays: null,
      clipsAllowed: true,
      liveAllowed: false,
      maxLiveDays: null,
      maxEventsPerPeriod: null,
      periodStartedAt: null,
    })

    expect(ceilings.allowsOpening()).toBe(false)
  })
})

describe('ClientCeilings.liveDeadline', () => {
  it('has no deadline with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().liveDeadline(new Date('2026-06-20T18:00:00.000Z'))).toBeNull()
  })

  it('closes maxLiveDays after the event opened', () => {
    const ceilings = must(ClientCeilings.create({ maxLiveDays: 7 }))

    expect(ceilings.liveDeadline(new Date('2026-06-20T18:00:00.000Z'))).toEqual(
      new Date('2026-06-27T18:00:00.000Z'),
    )
  })
})

describe('ClientCeilings.clipsAllowed', () => {
  it('reflects the flag it was built with', () => {
    expect(ClientCeilings.unlimited().clipsAllowed).toBe(true)
  })
})

describe('ClientCeilings.quotaBound', () => {
  it('is no bound at all when neither the box nor the client has one', () => {
    expect(ClientCeilings.unlimited().quotaBound(null)).toBeNull()
  })

  it('is the box ceiling when the client has none', () => {
    expect(ClientCeilings.unlimited().quotaBound(5_000)).toBe(5_000)
  })

  it('is the client ceiling when the box has none', () => {
    const ceilings = must(ClientCeilings.create({ maxEventQuotaBytes: 2_000 }))

    expect(ceilings.quotaBound(null)).toBe(2_000)
  })

  it('is the smaller of the two, whichever side it comes from', () => {
    const ceilings = must(ClientCeilings.create({ maxEventQuotaBytes: 2_000 }))

    expect(ceilings.quotaBound(5_000)).toBe(2_000)
    expect(ceilings.quotaBound(1_000)).toBe(1_000)
  })
})

describe('ClientCeilings.clampQuota', () => {
  it('leaves a quota alone with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().clampQuota(9_000)).toBe(9_000)
  })

  it('lowers a quota above the ceiling to the ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEventQuotaBytes: 2_000 }))

    expect(ceilings.clampQuota(9_000)).toBe(2_000)
  })

  it('keeps a quota already at or under the ceiling', () => {
    const ceilings = must(ClientCeilings.create({ maxEventQuotaBytes: 2_000 }))

    expect(ceilings.clampQuota(2_000)).toBe(2_000)
    expect(ceilings.clampQuota(500)).toBe(500)
  })
})

describe('ClientCeilings.admitsRetention', () => {
  it('admits anything, "keep forever" included, with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().admitsRetention(null)).toBe(true)
    expect(ClientCeilings.unlimited().admitsRetention(3_650)).toBe(true)
  })

  it('refuses "keep forever" once a ceiling exists, because forever is what the ceiling is for', () => {
    const ceilings = must(ClientCeilings.create({ maxRetentionDays: 30 }))

    expect(ceilings.admitsRetention(null)).toBe(false)
  })

  it('admits a retention at the ceiling and refuses one day past it', () => {
    const ceilings = must(ClientCeilings.create({ maxRetentionDays: 30 }))

    expect(ceilings.admitsRetention(30)).toBe(true)
    expect(ceilings.admitsRetention(31)).toBe(false)
  })

  it('agrees with clampRetention: a request is admitted exactly when clamping leaves it alone', () => {
    const ceilings = must(ClientCeilings.create({ maxRetentionDays: 30 }))

    for (const days of [null, 1, 29, 30, 31, 3_650]) {
      expect(ceilings.admitsRetention(days)).toBe(ceilings.clampRetention(days) === days)
    }
  })
})

describe('ClientCeilings.liveWindowOver', () => {
  const OPENED = new Date('2026-06-20T18:00:00.000Z')

  it('is never over with no maxLiveDays, however long ago the event opened', () => {
    const far = new Date('2036-06-20T18:00:00.000Z')

    expect(ClientCeilings.unlimited().liveWindowOver(OPENED, far)).toBe(false)
  })

  it('is not over for an event that has never been opened, which has no window yet', () => {
    const ceilings = must(ClientCeilings.create({ maxLiveDays: 3 }))

    expect(ceilings.liveWindowOver(null, new Date('2036-06-20T18:00:00.000Z'))).toBe(false)
  })

  it('is not over one millisecond before opened_at + maxLiveDays', () => {
    const ceilings = must(ClientCeilings.create({ maxLiveDays: 3 }))

    expect(ceilings.liveWindowOver(OPENED, new Date('2026-06-23T17:59:59.999Z'))).toBe(false)
  })

  it('is over at exactly opened_at + maxLiveDays, because the rule is "<= now"', () => {
    const ceilings = must(ClientCeilings.create({ maxLiveDays: 3 }))

    expect(ceilings.liveWindowOver(OPENED, new Date('2026-06-23T18:00:00.000Z'))).toBe(true)
  })

  it('stays over afterwards', () => {
    const ceilings = must(ClientCeilings.create({ maxLiveDays: 3 }))

    expect(ceilings.liveWindowOver(OPENED, new Date('2026-07-23T18:00:00.000Z'))).toBe(true)
  })
})

describe('ClientCeilings.openingRefusal', () => {
  const OPENED = new Date('2026-06-20T18:00:00.000Z')
  const NOW = new Date('2026-06-21T18:00:00.000Z')

  const withFlags = (liveAllowed: boolean, maxLiveDays: number | null): ClientCeilings =>
    must(ClientCeilings.create({ liveAllowed, maxLiveDays }))

  it('refuses nothing with no ceiling at all', () => {
    expect(ClientCeilings.unlimited().openingRefusal(OPENED, NOW)).toBeNull()
  })

  it('refuses with liveNotAllowed when the client may not go live', () => {
    expect(withFlags(false, null).openingRefusal(null, NOW)).toBe('liveNotAllowed')
  })

  it('refuses with liveWindowOver once the window has passed', () => {
    expect(withFlags(true, 1).openingRefusal(OPENED, NOW)).toBe('liveWindowOver')
  })

  it('names liveNotAllowed first when both apply, because that is the one nothing cures', () => {
    expect(withFlags(false, 1).openingRefusal(OPENED, NOW)).toBe('liveNotAllowed')
  })

  it('refuses nothing for a first opening inside the window', () => {
    expect(withFlags(true, 3).openingRefusal(null, NOW)).toBeNull()
    expect(withFlags(true, 3).openingRefusal(OPENED, NOW)).toBeNull()
  })
})
