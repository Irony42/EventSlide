import { describe, expect, it } from 'vitest'
import { asGuestId } from '../shared/ids'
import {
  rankContributors,
  TOP_CONTRIBUTORS_LIMIT,
  type ContributorEntry,
} from './contributorRanking'

const entry = (id: string, overrides: Partial<ContributorEntry> = {}): ContributorEntry => ({
  guestId: asGuestId(id),
  displayName: id,
  revoked: false,
  photos: 1,
  reactions: 0,
  ...overrides,
})

describe('rankContributors', () => {
  it('ranks by published sends, then reactions received, then guest id', () => {
    const { top } = rankContributors([
      entry('d', { photos: 2, reactions: 5 }),
      entry('c', { photos: 2, reactions: 5 }),
      entry('b', { photos: 2, reactions: 9 }),
      entry('a', { photos: 7, reactions: 0 }),
    ])

    expect(top.map((line) => line.displayName)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('leaves a guest the host removed out of the ranking', () => {
    const { top, anonymous } = rankContributors([
      entry('gone', { photos: 50, revoked: true }),
      entry('gone-anon', { photos: 9, revoked: true, displayName: null }),
      entry('kept'),
    ])

    expect(top.map((line) => line.displayName)).toEqual(['kept'])
    expect(anonymous).toEqual({ guests: 0, photos: 0 })
  })

  it('leaves out a guest with no published send', () => {
    const { top, anonymous } = rankContributors([
      entry('quiet', { photos: 0, reactions: 12 }),
      entry('quiet-anon', { photos: 0, displayName: null }),
    ])

    expect(top).toEqual([])
    expect(anonymous).toEqual({ guests: 0, photos: 0 })
  })

  it('folds guests without a name into one line and never lists them', () => {
    const { top, anonymous } = rankContributors([
      entry('x', { displayName: null, photos: 4 }),
      entry('y', { displayName: null, photos: 3 }),
      entry('named'),
    ])

    expect(top.map((line) => line.displayName)).toEqual(['named'])
    expect(anonymous).toEqual({ guests: 2, photos: 7 })
  })

  it('names ten guests at most, whatever the caller asks for', () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      entry(`g${String(index).padStart(2, '0')}`),
    )

    expect(rankContributors(many, 50).top).toHaveLength(TOP_CONTRIBUTORS_LIMIT)
    expect(rankContributors(many).top).toHaveLength(TOP_CONTRIBUTORS_LIMIT)
  })

  it('honours a smaller limit', () => {
    expect(rankContributors([entry('a'), entry('b')], 1).top).toHaveLength(1)
  })

  it('does not count the unnamed ones against the limit', () => {
    const named = Array.from({ length: 10 }, (_, index) => entry(`n${index}`))
    const { top, anonymous } = rankContributors([...named, entry('anon', { displayName: null })])

    expect(top).toHaveLength(10)
    expect(anonymous.guests).toBe(1)
  })
})
