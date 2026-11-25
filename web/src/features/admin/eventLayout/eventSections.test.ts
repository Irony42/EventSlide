import { describe, expect, it } from 'vitest'
import {
  eventMenu,
  momentOf,
  offersSection,
  sectionHref,
  SECTION_MOMENT,
  SECTION_PATH,
  type EventSectionFacts,
} from './eventSections'

const facts = (overrides: Partial<EventSectionFacts> = {}): EventSectionFacts => ({
  status: 'live',
  role: 'owner',
  allowGuestbook: true,
  allowTelegram: false,
  revealEnabled: false,
  ...overrides,
})

const sectionsOf = (menu: ReturnType<typeof eventMenu>) => menu.flatMap((group) => group.sections)

describe('eventMenu', () => {
  it('cuts the menu in the three moments, always in the same order', () => {
    for (const status of ['draft', 'live', 'closed'] as const) {
      expect(eventMenu(facts({ status })).map((group) => group.moment)).toEqual([
        'before',
        'during',
        'after',
      ])
    }
  })

  it('marks the moment the event is in, and only that one', () => {
    const current = (status: EventSectionFacts['status']) =>
      eventMenu(facts({ status }))
        .filter((group) => group.current)
        .map((group) => group.moment)

    expect(current('draft')).toEqual(['before'])
    expect(current('live')).toEqual(['during'])
    expect(current('closed')).toEqual(['after'])
    expect(current('archived')).toEqual(['after'])
  })

  it('gives the owner every subject of a live event, the evening starting with its two doors', () => {
    const menu = eventMenu(facts({ allowTelegram: true, revealEnabled: true }))

    expect(menu.find((group) => group.moment === 'during')?.sections.slice(0, 2)).toEqual([
      'moderation',
      'wall',
    ])
    expect(sectionsOf(menu)).toEqual([
      'appearance',
      'access',
      'print',
      'invitations',
      'rsvps',
      'missions',
      'moderators',
      'moderation',
      'wall',
      'announcements',
      'challenge',
      'guestbook',
      'reveal',
      'telegram',
      'guests',
      'album',
      'bestOf',
      'book',
      'share',
      'stats',
    ])
  })

  it('puts « Apparence » first among the things to prepare, right under the home page, for the owner', () => {
    const before = eventMenu(facts({ status: 'draft' })).find((group) => group.moment === 'before')

    expect(before?.sections[0]).toBe('appearance')
    expect(before?.sections[1]).toBe('access')
  })

  it('keeps « Apparence » for an archived event, to read', () => {
    expect(sectionsOf(eventMenu(facts({ status: 'archived' })))).toContain('appearance')
  })

  it('keeps what is the owner’s out of a moderator’s menu', () => {
    const sections = sectionsOf(eventMenu(facts({ role: 'moderator' })))

    for (const ownerOnly of [
      'appearance',
      'invitations',
      'rsvps',
      'missions',
      'moderators',
      'share',
    ] as const) {
      expect(sections).not.toContain(ownerOnly)
    }
    expect(sections).toContain('moderation')
    expect(sections).toContain('print')
  })

  it('offers the guestbook, the Telegram group and the reveal only when the event has them', () => {
    const without = sectionsOf(
      eventMenu(facts({ allowGuestbook: false, allowTelegram: false, revealEnabled: false })),
    )
    expect(without).not.toContain('guestbook')
    expect(without).not.toContain('telegram')
    expect(without).not.toContain('reveal')

    const withAll = sectionsOf(
      eventMenu(facts({ allowGuestbook: true, allowTelegram: true, revealEnabled: true })),
    )
    expect(withAll).toEqual(expect.arrayContaining(['guestbook', 'telegram', 'reveal']))
  })

  it('takes the queue, the screen and what is printed or sent away from an archived event', () => {
    const sections = sectionsOf(eventMenu(facts({ status: 'archived' })))

    for (const gone of ['moderation', 'wall', 'print', 'invitations'] as const) {
      expect(sections).not.toContain(gone)
    }
    expect(sections).toEqual(expect.arrayContaining(['access', 'rsvps', 'album', 'book', 'stats']))
  })

  it('puts every section under the moment it belongs to', () => {
    for (const group of eventMenu(facts({ allowTelegram: true, revealEnabled: true }))) {
      for (const section of group.sections) {
        if (section !== 'settings') expect(SECTION_MOMENT[section]).toBe(group.moment)
      }
    }
  })
})

describe('offersSection', () => {
  it('serves the settings to the owner alone', () => {
    expect(offersSection(facts(), 'settings')).toBe(true)
    expect(offersSection(facts({ role: 'moderator' }), 'settings')).toBe(false)
  })

  it('does not serve a page the menu does not offer', () => {
    expect(offersSection(facts({ role: 'moderator' }), 'share')).toBe(false)
    expect(offersSection(facts({ allowGuestbook: false }), 'guestbook')).toBe(false)
    expect(offersSection(facts(), 'guestbook')).toBe(true)
  })
})

describe('addresses', () => {
  it('puts every page under the event, and the wall where the room opens it', () => {
    expect(sectionHref('camille', 'bestOf')).toBe('/admin/events/camille/best-of')
    expect(sectionHref('camille', 'moderation')).toBe('/admin/events/camille/moderation')
    expect(sectionHref('camille', 'wall')).toBe('/e/camille/display')
    expect(sectionHref('camille', 'appearance')).toBe('/admin/events/camille/appearance')
  })

  it('gives every section its own address', () => {
    const paths = Object.values(SECTION_PATH)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('momentOf', () => {
  it('reads the moment from the status', () => {
    expect(momentOf('draft')).toBe('before')
    expect(momentOf('live')).toBe('during')
    expect(momentOf('closed')).toBe('after')
    expect(momentOf('archived')).toBe('after')
  })
})
