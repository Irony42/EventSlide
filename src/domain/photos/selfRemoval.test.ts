import { describe, expect, it } from 'vitest'
import { authorMayTakeBack, removalVerdict } from './selfRemoval'

const createdAt = new Date('2026-06-20T21:00:00Z')
const base = {
  isAuthor: true,
  createdAt,
  now: new Date(createdAt.getTime() + 1_000),
  graceMs: 5_000,
  status: 'pending',
} as const

describe('authorMayTakeBack', () => {
  it('lets the author take back a pending contribution inside the window', () => {
    expect(authorMayTakeBack(base)).toBe(true)
  })

  it('lets the author take back a rejected one', () => {
    expect(authorMayTakeBack({ ...base, status: 'rejected' })).toBe(true)
  })

  it('refuses somebody who is not the author', () => {
    expect(authorMayTakeBack({ ...base, isAuthor: false })).toBe(false)
  })

  it('refuses once the window is over, and not before the last millisecond of it', () => {
    expect(authorMayTakeBack({ ...base, now: new Date(createdAt.getTime() + 5_000) })).toBe(true)
    expect(authorMayTakeBack({ ...base, now: new Date(createdAt.getTime() + 5_001) })).toBe(false)
  })

  it.each(['published', 'hidden'] as const)('refuses a %s contribution', (status) => {
    expect(authorMayTakeBack({ ...base, status })).toBe(false)
  })
})

describe('removalVerdict', () => {
  it('reports the host veto before anything else, to a guest only', () => {
    expect(removalVerdict(true, true, false)).toBe('selfDeleteDisabled')
    expect(removalVerdict(false, true, false)).toBe('allowed')
  })

  it('allows what the rule allows and forbids the rest', () => {
    expect(removalVerdict(true, true, true)).toBe('allowed')
    expect(removalVerdict(true, false, true)).toBe('forbidden')
  })
})
