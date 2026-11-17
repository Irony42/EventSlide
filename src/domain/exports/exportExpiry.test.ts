import { describe, expect, it } from 'vitest'
import { EXPORT_SERVED_GRACE_MS, exportExpiresAt, isExportExpired } from './exportExpiry'

const SEALED = new Date('2026-12-01T10:00:00Z')
const day = (n: number): Date => new Date(SEALED.getTime() + n * 86_400_000)
const hour = (n: number): Date => new Date(SEALED.getTime() + n * 3_600_000)

describe('exportExpiresAt: the first of three dates (spec 22, rule 2)', () => {
  it('is the ttl after the seal when nothing else comes first', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: null, deadline: null, ttlDays: 7 }),
    ).toEqual(day(7))
  })

  it('is the album deadline when it comes before the ttl', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: null, deadline: day(3), ttlDays: 7 }),
    ).toEqual(day(3))
  })

  it('keeps the ttl when the deadline is later', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: null, deadline: day(30), ttlDays: 7 }),
    ).toEqual(day(7))
  })

  it('is 48 hours after the send in full when that comes first', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: hour(5), deadline: null, ttlDays: 7 }),
    ).toEqual(new Date(hour(5).getTime() + EXPORT_SERVED_GRACE_MS))
  })

  it('is the ttl when the send is so late that its 48 hours run past it', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: day(6), deadline: null, ttlDays: 7 }),
    ).toEqual(day(7))
  })

  it('is the deadline when it comes before the 48 hours that follow the send', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: hour(5), deadline: hour(20), ttlDays: 7 }),
    ).toEqual(hour(20))
  })

  it('lives its whole ttl when the deadline is already past, as under a purge hold', () => {
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: null, deadline: day(-2), ttlDays: 7 }),
    ).toEqual(day(7))
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: null, deadline: SEALED, ttlDays: 7 }),
    ).toEqual(day(7))
  })

  it('measures a deadline against the send, not the seal, once there is one', () => {
    // The deadline is after the seal but before the send: it is over by then, so it does not count.
    expect(
      exportExpiresAt({ sealedAt: SEALED, servedAt: day(2), deadline: day(1), ttlDays: 7 }),
    ).toEqual(new Date(day(2).getTime() + EXPORT_SERVED_GRACE_MS))
  })
})

describe('isExportExpired', () => {
  it('expires at the instant, not after it', () => {
    expect(isExportExpired(day(1), day(1))).toBe(true)
    expect(isExportExpired(day(1), day(0))).toBe(false)
  })
})
