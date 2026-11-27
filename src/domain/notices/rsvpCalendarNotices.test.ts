import { describe, expect, it } from 'vitest'
import type { InviteSchedule } from '../guestInvites/inviteStateOf'
import { DEFAULT_RSVP_SETTINGS, type RsvpSettings } from '../guestRsvps/rsvpSettings'
import { rsvpDeadlineNotice, rsvpFullKey, rsvpStoppedByDeadline } from './rsvpCalendarNotices'

const at = (iso: string): Date => new Date(iso)

/** A party on 13 December at 19:00 in Paris, replies asked until 5 December. */
const SCHEDULE: InviteSchedule = {
  startsAt: at('2026-12-13T18:00:00.000Z'),
  endsAt: null,
  timeZone: 'Europe/Paris',
}

const settings = (patch: Partial<RsvpSettings> = {}): RsvpSettings => ({
  ...DEFAULT_RSVP_SETTINGS,
  enabled: true,
  deadline: '2026-12-05',
  ...patch,
})

describe('rsvpDeadlineNotice', () => {
  const notice = (
    now: string,
    over: {
      settings?: RsvpSettings
      state?: 'open' | 'closed' | 'full' | 'off'
      unanswered?: boolean
    } = {},
  ): string | null =>
    rsvpDeadlineNotice(
      over.settings ?? settings(),
      SCHEDULE,
      over.state ?? 'open',
      over.unanswered ?? true,
      at(now),
    )

  it('is the deadline day once the third day before it begins, where the party is', () => {
    // The third day before 5 December is 2 December; it begins at 23:00 UTC on the 1st in Paris.
    expect(notice('2026-12-01T22:59:00.000Z')).toBeNull()
    expect(notice('2026-12-01T23:00:00.000Z')).toBe('2026-12-05')
  })

  it('stays due until the replies stop, so a late pass still writes once', () => {
    expect(notice('2026-12-05T12:00:00.000Z')).toBe('2026-12-05')
  })

  it('crosses a month: the third day before 2 January is 30 December', () => {
    expect(
      rsvpDeadlineNotice(
        settings({ deadline: '2027-01-02' }),
        { ...SCHEDULE, startsAt: at('2027-01-20T18:00:00.000Z') },
        'open',
        true,
        at('2026-12-30T12:00:00.000Z'),
      ),
    ).toBe('2027-01-02')
  })

  it('changes day at midnight where the party is, not in UTC (Paris, winter)', () => {
    // The third day before 5 December is 2 December: it begins at 23:00 UTC on the 1st in Paris.
    expect(notice('2026-12-01T22:59:59.000Z')).toBeNull()
    expect(notice('2026-12-01T23:00:00.000Z')).toBe('2026-12-05')
    // 23:59 local on the 1st is still the 1st, though UTC says 22:59 and a UTC reading would also say the 1st.
    expect(notice('2026-12-02T00:00:00.000Z')).toBe('2026-12-05')
  })

  it('reads the zone of the invitation, not UTC (Auckland, ahead of UTC)', () => {
    const auckland: InviteSchedule = { ...SCHEDULE, timeZone: 'Pacific/Auckland' }
    const at_ = (iso: string) => rsvpDeadlineNotice(settings(), auckland, 'open', true, at(iso))
    // Auckland is UTC+13 on 1 December: local 00:00 on the 2nd is 11:00 UTC on the 1st.
    expect(at_('2026-12-01T10:59:59.000Z')).toBeNull()
    expect(at_('2026-12-01T11:00:00.000Z')).toBe('2026-12-05')
  })

  it('owes nothing without a deadline', () => {
    expect(
      notice('2026-12-04T12:00:00.000Z', { settings: settings({ deadline: null }) }),
    ).toBeNull()
  })

  it('owes nothing unless the replies are open: closed, full or off', () => {
    for (const state of ['closed', 'full', 'off'] as const) {
      expect(notice('2026-12-04T12:00:00.000Z', { state })).toBeNull()
    }
  })

  it('owes nothing when every household has answered', () => {
    expect(notice('2026-12-04T12:00:00.000Z', { unanswered: false })).toBeNull()
  })
})

describe('rsvpStoppedByDeadline', () => {
  it('is the deadline and the instant the replies stopped, once the day after the deadline began', () => {
    expect(
      rsvpStoppedByDeadline(settings(), SCHEDULE, 'closed', at('2026-12-05T22:59:59.000Z')),
    ).toBeNull()
    expect(
      rsvpStoppedByDeadline(settings(), SCHEDULE, 'closed', at('2026-12-05T23:00:00.000Z')),
    ).toEqual({
      key: '2026-12-05',
      stoppedAt: at('2026-12-05T23:00:00.000Z'),
    })
  })

  it('is not a stop by the deadline when there is none', () => {
    expect(
      rsvpStoppedByDeadline(
        settings({ deadline: null }),
        SCHEDULE,
        'closed',
        at('2026-12-20T12:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it('is not a stop by the deadline when the host closed the replies by hand', () => {
    expect(
      rsvpStoppedByDeadline(
        settings({ closedAt: at('2026-12-04T10:00:00.000Z') }),
        SCHEDULE,
        'closed',
        at('2026-12-06T12:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it('is not a stop by the deadline when the start of the party came first', () => {
    // The deadline day is the party day: the day after begins after the party started.
    expect(
      rsvpStoppedByDeadline(
        settings({ deadline: '2026-12-13' }),
        SCHEDULE,
        'closed',
        at('2026-12-14T12:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it.each(['off', 'open', 'full'] as const)(
    'is not a stop when the replies are %s (replies switched off, an invitation not published, a party over)',
    (state) => {
      expect(
        rsvpStoppedByDeadline(settings(), SCHEDULE, state, at('2026-12-06T12:00:00.000Z')),
      ).toBeNull()
    },
  )

  it('is not a stop by the deadline when both bounds are the same instant', () => {
    const midnight: InviteSchedule = { ...SCHEDULE, startsAt: at('2026-12-05T23:00:00.000Z') }
    expect(
      rsvpStoppedByDeadline(settings(), midnight, 'closed', at('2026-12-06T12:00:00.000Z')),
    ).toBeNull()
  })
})

describe('rsvpFullKey', () => {
  const yes = (people: number) => ({ yes: { people } })

  it('is full@capacity once the people who come reach the capacity', () => {
    expect(rsvpFullKey(yes(120), { capacity: 120 })).toBe('full@120')
    expect(rsvpFullKey(yes(130), { capacity: 120 })).toBe('full@120')
  })

  it('is nothing below the capacity, and nothing without one', () => {
    expect(rsvpFullKey(yes(119), { capacity: 120 })).toBeNull()
    expect(rsvpFullKey(yes(500), { capacity: null })).toBeNull()
  })

  it('is a new key when the host raises the capacity and the house fills again', () => {
    expect(rsvpFullKey(yes(150), { capacity: 150 })).toBe('full@150')
    expect(rsvpFullKey(yes(150), { capacity: 150 })).not.toBe(
      rsvpFullKey(yes(120), { capacity: 120 }),
    )
  })
})
