import { describe, expect, it } from 'vitest'
import {
  SIGNUP_DISK_PER_CLIENT_BYTES,
  SIGNUP_FRESH_CLIENT_DAYS,
  signupDiskThreshold,
  signupFreshClientsSince,
} from './signupDiskGuard'

describe('signupDiskThreshold', () => {
  it('is the minimum free plus 5 GB for the newcomer on an empty box', () => {
    expect(signupDiskThreshold({ minFreeDiskBytes: 1_000, clientsReservingRoom: 0 })).toBe(
      1_000 + 5_000_000_000,
    )
  })

  it('adds 5 GB for each client that has an event not yet purged', () => {
    expect(signupDiskThreshold({ minFreeDiskBytes: 1_000, clientsReservingRoom: 3 })).toBe(
      1_000 + 4 * SIGNUP_DISK_PER_CLIENT_BYTES,
    )
  })

  it('is exactly 5 GB per client, as docs/costs.md says', () => {
    expect(SIGNUP_DISK_PER_CLIENT_BYTES).toBe(5_000_000_000)
  })
})

describe('signupFreshClientsSince', () => {
  it('is 30 days before now', () => {
    expect(signupFreshClientsSince(new Date('2026-12-31T12:00:00.000Z')).toISOString()).toBe(
      '2026-12-01T12:00:00.000Z',
    )
    expect(SIGNUP_FRESH_CLIENT_DAYS).toBe(30)
  })
})
