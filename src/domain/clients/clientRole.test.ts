import { describe, expect, it } from 'vitest'
import { EVENT_ROLES, isEventRole } from '../events/eventRole'
import { CLIENT_ROLES, isClientRole } from './clientRole'

describe('isClientRole', () => {
  it.each(CLIENT_ROLES)('accepts %s, one of the two the client_members CHECK admits', (role) => {
    expect(isClientRole(role)).toBe(true)
  })

  it('refuses a role the roster does not have', () => {
    expect(isClientRole('admin')).toBe(false)
  })

  it('refuses a non-string, which is what a stored row or a JSON body can hand over', () => {
    expect(isClientRole(1)).toBe(false)
  })

  it('never accepts the event role that has no client counterpart', () => {
    expect(isClientRole('moderator')).toBe(false)
  })

  it('is not accepted as an event role where the two vocabularies differ', () => {
    const clientOnly = CLIENT_ROLES.filter(
      (role) => !(EVENT_ROLES as readonly string[]).includes(role),
    )

    expect(clientOnly).toEqual(['member'])
    expect(isEventRole('member')).toBe(false)
  })
})
