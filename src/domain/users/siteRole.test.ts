import { describe, expect, it } from 'vitest'
import { EVENT_ROLES } from '../events/eventRole'
import * as siteRole from './siteRole'
import {
  DEFAULT_SITE_ROLE,
  SITE_ROLES,
  canOperateSite,
  isSiteRole,
  type SiteRole,
} from './siteRole'

const ALL_ROLES: SiteRole[] = [...SITE_ROLES]

describe('isSiteRole', () => {
  it.each(ALL_ROLES)('recognises %s', (role) => {
    expect(isSiteRole(role)).toBe(true)
  })

  it.each([['admin'], ['root'], ['OPERATOR'], [''], [1], [null], [undefined], [{ role: 'none' }]])(
    'refuses %p, which an account row or a form could still contain',
    (value: unknown) => {
      expect(isSiteRole(value)).toBe(false)
    },
  )
})

describe('a site role is not an event role', () => {
  // The rule this whole item rests on, asserted rather than assumed. The two vocabularies
  // are checked in different places against different tables, and the day one value
  // appears in both lists is the day `requireRole('owner')` can be satisfied by something
  // that was never granted on the event.
  it.each(EVENT_ROLES)(
    'refuses the event role %s, which names authority inside an event',
    (role) => {
      expect(isSiteRole(role)).toBe(false)
    },
  )

  it.each(ALL_ROLES)('offers %s to no event-role check', (role) => {
    expect((EVENT_ROLES as readonly string[]).includes(role)).toBe(false)
  })
})

describe('capabilities by role', () => {
  it.each<[SiteRole, boolean]>([
    ['operator', true],
    ['none', false],
  ])('only an operator runs the box (%s: %s)', (role, expected) => {
    expect(canOperateSite(role)).toBe(expected)
  })

  it('grants nothing by default, so an install that wanted none of this has none of it', () => {
    expect(canOperateSite(DEFAULT_SITE_ROLE)).toBe(false)
  })

  it('offers exactly one capability, because two roles is the decision, not a matrix', () => {
    // A guard on the shape of the next change rather than on a value. The moment a
    // `canReadAnyEvent` or a `canModerateAnyEvent` is added to this module, an operator
    // stops being someone who never touches a client's photographs — and this fails,
    // which is the conversation that has to happen before that ships.
    expect(Object.keys(siteRole).filter((name) => name.startsWith('can'))).toEqual([
      'canOperateSite',
    ])
  })
})
