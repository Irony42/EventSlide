import { describe, expect, it } from 'vitest'
import {
  afterInvitationPath,
  chosenPath,
  forcedByGate,
  fromOf,
  hereAsFrom,
  landingPath,
  moderationQueuePath,
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

describe('the sign-in page as a destination', () => {
  it.each(['/login', '/login?x=1', '/login/', '/login#haut'])(
    'is no destination, since the person is already there: %s',
    (path) => {
      expect(fromOf({ from: path })).toBeNull()
    },
  )

  it('is not confused with an address that only starts like it', () => {
    expect(fromOf({ from: '/loginfo' })).toBe('/loginfo')
  })
})

describe('the change of password the gate forced', () => {
  it('is read from the state the gate writes, and from nothing else', () => {
    expect(forcedByGate({ from: '/admin/x', forced: true })).toBe(true)
    expect(forcedByGate({ from: '/admin/x' })).toBe(false)
    expect(forcedByGate({ forced: 'yes' })).toBe(false)
    expect(forcedByGate(null)).toBe(false)
  })
})

describe('where an account lands when it chose no page', () => {
  it('opens the moderation queue of the only event a moderator works', () => {
    expect(landingPath(facts({ eventSlugs: ['mariage'], soleEventRole: 'moderator' }))).toBe(
      '/admin/events/mariage/moderation',
    )
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
    expect(afterInvitationPath({ kind: 'event', role: 'moderator', eventSlug: 'mariage' })).toBe(
      '/admin/events/mariage/moderation',
    )
  })

  it.each(['owner', 'member'] as const)('opens the list of events for a client’s %s', (role) => {
    expect(afterInvitationPath({ kind: 'client', role, eventSlug: null })).toBe('/admin')
  })

  it('opens the list of events for a client invitation even when the answer carries an event', () => {
    // The server sends none for a client; the rule is about the kind, not about what else is there.
    expect(afterInvitationPath({ kind: 'client', role: 'owner', eventSlug: 'mariage' })).toBe(
      '/admin',
    )
  })

  it('opens the event’s page for any other role on an event', () => {
    expect(afterInvitationPath({ kind: 'event', role: 'owner', eventSlug: 'mariage' })).toBe(
      '/admin/events/mariage',
    )
  })

  it('opens the list of events when an event invitation names no event', () => {
    expect(afterInvitationPath({ kind: 'event', role: 'moderator', eventSlug: null })).toBe(
      '/admin',
    )
  })

  it('encodes a slug as a path segment', () => {
    expect(moderationQueuePath('a b/c')).toBe('/admin/events/a%20b%2Fc/moderation')
  })
})
