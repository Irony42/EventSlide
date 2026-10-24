import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../domain/shared/ids'
import { AT } from './builders'
import { FAKE_GUEST_TOKEN_MAX_AGE_MS, FakeGuestTokenService } from './fakeGuestTokenService'

const EVENT = asEventId('event-1')
const GUEST = asGuestId('guest-1')

describe('FakeGuestTokenService', () => {
  const tokens = new FakeGuestTokenService()
  const claims = { eventId: EVENT, guestId: GUEST, issuedAt: AT }

  it('reads back the claims it issued', () => {
    const verified = tokens.verify(tokens.issue(claims), AT)

    expect(verified.ok && verified.value).toEqual(claims)
  })

  it('refuses a token that is not one, as the real service does', () => {
    const verified = tokens.verify('nimportequoi', AT)

    expect(!verified.ok && [verified.error.kind, verified.error.code]).toEqual([
      'unauthenticated',
      'guestToken.malformed',
    ])
  })

  it('refuses a token whose issue time is not a number', () => {
    const verified = tokens.verify(`token|${EVENT}|${GUEST}|hier`, AT)

    expect(!verified.ok && verified.error.code).toBe('guestToken.malformed')
  })

  it('accepts a token exactly as old as the limit', () => {
    const now = new Date(AT.getTime() + FAKE_GUEST_TOKEN_MAX_AGE_MS)

    expect(tokens.verify(tokens.issue(claims), now).ok).toBe(true)
  })

  it('refuses a token one millisecond older than the limit', () => {
    const now = new Date(AT.getTime() + FAKE_GUEST_TOKEN_MAX_AGE_MS + 1)

    const verified = tokens.verify(tokens.issue(claims), now)

    expect(!verified.ok && [verified.error.kind, verified.error.code]).toEqual([
      'unauthenticated',
      'guestToken.expired',
    ])
  })

  it('is twelve hours, which is what the real token lives for', () => {
    expect(FAKE_GUEST_TOKEN_MAX_AGE_MS).toBe(43_200_000)
  })
})
