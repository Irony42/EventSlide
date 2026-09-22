import { describe, expect, it } from 'vitest'
import { DEFAULT_MISSION_SCOPE, isMissionScope, MISSION_SCOPES } from './missionScope'

describe('isMissionScope', () => {
  it.each(MISSION_SCOPES)('accepts %s', (scope) => {
    expect(isMissionScope(scope)).toBe(true)
  })

  it('refuses a word outside the set, which is what a stored row can carry', () => {
    expect(isMissionScope('room')).toBe(false)
  })

  it('refuses a non-string', () => {
    expect(isMissionScope(1)).toBe(false)
  })
})

describe('DEFAULT_MISSION_SCOPE', () => {
  it('is the per-guest one, so a host who chooses nothing leaves the room something to do', () => {
    expect(DEFAULT_MISSION_SCOPE).toBe('guest')
  })
})
