import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  afterInvitationPath,
  chosenPath,
  fromOf,
  hereAsFrom,
  landingPath,
  moderationQueuePath,
  onPhone,
  type LandingFacts,
} from './landing'

/**
 * Where people land (navigation pass, decisions 2 and 3, H12), as rules over facts: no server and
 * no component, which is the point of having them in a module.
 */

const facts = (overrides: Partial<LandingFacts> = {}): LandingFacts => ({
  eventSlugs: [],
  soleEventRole: null,
  clientCount: 0,
  operatesConsole: false,
  phone: false,
  ...overrides,
})

describe('the page somebody was heading for', () => {
  it('is the path with its query, as the gate and the expired-session banner leave it', () => {
    expect(fromOf({ from: '/admin/site/audit?clientId=c-1' })).toBe(
      '/admin/site/audit?clientId=c-1',
    )
  })

  it.each([
    ['an absolute address', { from: 'https://ailleurs.example/admin' }],
    ['a protocol-relative one', { from: '//ailleurs.example' }],
    ['a backslash read as a slash by the browser', { from: '/\\ailleurs.example' }],
    ['something that is not a string', { from: 42 }],
    ['no from at all', {}],
    ['no state', null],
    ['a state that is not an object', 'x'],
  ])(
    'is nothing for %s, so a forged history entry cannot send anybody off the site',
    (_n, state) => {
      expect(fromOf(state)).toBeNull()
    },
  )

  it('is not a destination when it is the dashboard itself, which says "somewhere in the console"', () => {
    expect(chosenPath({ from: '/admin' })).toBeNull()
    expect(chosenPath({ from: '/admin/events/mariage/moderation' })).toBe(
      '/admin/events/mariage/moderation',
    )
  })

  it('is written as the path and the query, and nothing else', () => {
    expect(hereAsFrom({ pathname: '/admin/site/audit', search: '?clientId=c-1' })).toBe(
      '/admin/site/audit?clientId=c-1',
    )
  })
})

describe('where an account lands when it chose no page', () => {
  it('opens the moderation queue of the only event a moderator works', () => {
    expect(landingPath(facts({ eventSlugs: ['mariage'], soleEventRole: 'moderator' }))).toBe(
      '/admin/events/mariage/moderation',
    )
  })

  it('opens the phone’s queue on a phone', () => {
    expect(
      landingPath(facts({ eventSlugs: ['mariage'], soleEventRole: 'moderator', phone: true })),
    ).toBe('/admin/events/mariage/moderation/mobile')
  })

  it('opens the list of events for a moderator of several events, who has to choose', () => {
    expect(landingPath(facts({ eventSlugs: ['mariage', 'gala'], soleEventRole: null }))).toBe(
      '/admin',
    )
  })

  it('opens the list of events for the owner of a single event, whose work is not the queue', () => {
    expect(landingPath(facts({ eventSlugs: ['mariage'], soleEventRole: 'owner' }))).toBe('/admin')
  })

  it('opens the console for an operator with no event and no client', () => {
    expect(landingPath(facts({ operatesConsole: true }))).toBe('/admin/site')
  })

  it('opens the list of events, not the console, for an operator who has an event', () => {
    expect(
      landingPath(
        facts({ operatesConsole: true, eventSlugs: ['mariage'], soleEventRole: 'owner' }),
      ),
    ).toBe('/admin')
  })

  it('opens the list of events for an operator who belongs to a client, which links to its space', () => {
    expect(landingPath(facts({ operatesConsole: true, clientCount: 1 }))).toBe('/admin')
  })

  it('opens the list of events for an account that does not operate a console it could open', () => {
    expect(landingPath(facts({ operatesConsole: false }))).toBe('/admin')
  })

  it('opens the list of events for a client’s owner or member', () => {
    expect(landingPath(facts({ clientCount: 1 }))).toBe('/admin')
  })
})

describe('where somebody lands after accepting an invitation', () => {
  it('opens the queue of the event a moderator was invited to', () => {
    expect(
      afterInvitationPath({ kind: 'event', role: 'moderator', eventSlug: 'mariage' }, false),
    ).toBe('/admin/events/mariage/moderation')
  })

  it('opens the phone’s queue on a phone', () => {
    expect(
      afterInvitationPath({ kind: 'event', role: 'moderator', eventSlug: 'mariage' }, true),
    ).toBe('/admin/events/mariage/moderation/mobile')
  })

  it.each(['owner', 'member'] as const)('opens the list of events for a client’s %s', (role) => {
    expect(afterInvitationPath({ kind: 'client', role, eventSlug: null }, false)).toBe('/admin')
    expect(afterInvitationPath({ kind: 'client', role, eventSlug: null }, true)).toBe('/admin')
  })

  it('opens the list of events for a client invitation even when the answer carries an event', () => {
    // The server sends none for a client; the rule is about the kind, not about what else is there.
    expect(
      afterInvitationPath({ kind: 'client', role: 'owner', eventSlug: 'mariage' }, false),
    ).toBe('/admin')
  })

  it('opens the event’s page for any other role on an event', () => {
    expect(afterInvitationPath({ kind: 'event', role: 'owner', eventSlug: 'mariage' }, false)).toBe(
      '/admin/events/mariage',
    )
  })

  it('opens the list of events when an event invitation names no event', () => {
    expect(afterInvitationPath({ kind: 'event', role: 'moderator', eventSlug: null }, false)).toBe(
      '/admin',
    )
  })

  it('encodes a slug as a path segment', () => {
    expect(moderationQueuePath('a b/c', false)).toBe('/admin/events/a%20b%2Fc/moderation')
  })
})

describe('whether the screen is a phone’s', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it('asks for a narrow viewport or a coarse pointer, either of which makes it a phone', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    window.matchMedia = matchMedia

    expect(onPhone()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px), (pointer: coarse)')
  })

  it('is a laptop when neither matches', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList)

    expect(onPhone()).toBe(false)
  })

  it('is a laptop in a browser that cannot say', () => {
    window.matchMedia = vi.fn(() => {
      throw new Error('no matchMedia')
    })

    expect(onPhone()).toBe(false)
  })
})
