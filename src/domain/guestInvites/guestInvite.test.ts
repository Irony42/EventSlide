import { describe, expect, it } from 'vitest'
import { asEventId } from '../shared/ids'
import { GuestInvite } from './guestInvite'
import { GuestInviteToken } from './guestInviteToken'

const NOW = new Date('2026-11-21T10:00:00Z')
const LATER = new Date('2026-11-21T11:00:00Z')

const token = (byte: number): GuestInviteToken => {
  const made = GuestInviteToken.fromBytes(new Uint8Array(16).fill(byte))
  if (!made.ok) throw new Error('token')
  return made.value
}

const blank = (): GuestInvite => GuestInvite.blank(asEventId('evt-1'), token(1), 'fr', NOW)

const dated = (): GuestInvite => {
  const saved = blank().withContent(
    { startsAt: '2026-12-13T18:00:00Z', timeZone: 'Europe/Paris' },
    NOW,
  )
  if (!saved.ok) throw new Error('save')
  return saved.value
}

describe('GuestInvite', () => {
  it('starts blank and switched off, in the language it is given', () => {
    const invite = blank()

    expect(invite.enabled).toBe(false)
    expect(invite.content).toMatchObject({ title: null, startsAt: null, language: 'fr' })
    expect(invite.updatedAt).toBe(NOW)
    expect(invite.token.value).toBe(token(1).value)
    expect(invite.eventId).toBe('evt-1')
  })

  it('applies a save and stamps it with the instant it is given', () => {
    const saved = blank().withContent({ title: 'Léa' }, LATER)

    expect(saved.ok && saved.value.content.title).toBe('Léa')
    expect(saved.ok && saved.value.updatedAt).toBe(LATER)
  })

  it('returns this very invitation for a save that changes nothing: it is not an edit', () => {
    const invite = dated()

    const same = invite.withContent(
      { startsAt: '2026-12-13T18:00:00Z', timeZone: 'europe/paris', title: null },
      LATER,
    )

    expect(same.ok && same.value).toBe(invite)
    expect(same.ok && same.value.updatedAt).toBe(NOW)
  })

  it('sees a change of any one field as an edit', () => {
    const base = dated()
    const changes = [
      { title: 'Autre' },
      { startsAt: '2026-12-13T19:00:00Z' },
      { endsAt: '2026-12-14T01:00:00Z' },
      { timeZone: 'UTC' },
      { venueName: 'Salle' },
      { address: 'Rue 1' },
      { message: 'Mot' },
      { language: 'de' },
    ]
    for (const change of changes) {
      const saved = base.withContent(change, LATER)
      expect(saved.ok && saved.value !== base, JSON.stringify(change)).toBe(true)
    }
  })

  it('refuses to take the date away from an invitation that is switched on', () => {
    const on = dated().enable(NOW)
    if (!on.ok) throw new Error('enable')

    const saved = on.value.withContent({ startsAt: null, timeZone: null }, LATER)

    expect(!saved.ok && saved.error.code).toBe('guestInvite.needsDate')
  })

  it('lets a switched-off invitation lose its date, and lets a switched-on one change it', () => {
    const off = dated().withContent({ startsAt: null, timeZone: null }, LATER)
    const on = dated().enable(NOW)
    if (!on.ok) throw new Error('enable')
    const moved = on.value.withContent({ startsAt: '2026-12-14T18:00:00Z' }, LATER)

    expect(off.ok && off.value.content.startsAt).toBeNull()
    expect(moved.ok && moved.value.content.startsAt?.toISOString()).toBe('2026-12-14T18:00:00.000Z')
  })

  it('passes a refused save back and leaves the invitation as it was', () => {
    const invite = blank()
    const saved = invite.withContent({ title: 'x'.repeat(81) }, LATER)

    expect(!saved.ok && saved.error.code).toBe('guestInvite.titleTooLong')
    expect(invite.content.title).toBeNull()
  })

  it('cannot be switched on without a date', () => {
    const enabled = blank().enable(LATER)

    expect(!enabled.ok && enabled.error.code).toBe('guestInvite.needsDate')
  })

  it('switches on once it has a date', () => {
    const enabled = dated().enable(LATER)

    expect(enabled.ok && enabled.value.enabled).toBe(true)
  })

  it('switches off and keeps its token and its text, so the same link comes back', () => {
    const enabled = dated().enable(NOW)
    if (!enabled.ok) throw new Error('enable')
    const off = enabled.value.disable(LATER)

    expect(off.enabled).toBe(false)
    expect(off.token.value).toBe(token(1).value)
    expect(off.content.startsAt).not.toBeNull()
    expect(off.updatedAt).toBe(LATER)
  })

  it('rotates to a new token and keeps everything else', () => {
    const rotated = dated().rotate(token(2), LATER)

    expect(rotated.token.value).toBe(token(2).value)
    expect(rotated.content.startsAt).not.toBeNull()
    expect(rotated.updatedAt).toBe(LATER)
  })

  it('round-trips through its props', () => {
    const invite = dated()

    expect(GuestInvite.restore(invite.toProps()).content).toEqual(invite.content)
  })
})
