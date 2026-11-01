import { describe, expect, it } from 'vitest'
import type { EntryStatus } from './guestbookEntry'
import { orderGuestbookQueue, pendingGuestbookCount } from './guestbookQueue'
import type { GuestbookEntryId } from '../shared/ids'

const row = (id: string, status: EntryStatus, minute: number) => ({
  id: id as GuestbookEntryId,
  status,
  createdAt: new Date(Date.UTC(2026, 5, 20, 21, minute)),
})

describe('orderGuestbookQueue', () => {
  it('puts what waits for a decision first, oldest first, so nobody is starved', () => {
    const ordered = orderGuestbookQueue([
      row('c', 'pending', 30),
      row('a', 'pending', 10),
      row('b', 'pending', 20),
    ])
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('then lists on the screen, taken off it and refused, each newest first', () => {
    const ordered = orderGuestbookQueue([
      row('r1', 'rejected', 1),
      row('h1', 'hidden', 2),
      row('p1', 'published', 3),
      row('p2', 'published', 4),
      row('w1', 'pending', 50),
      row('r2', 'rejected', 5),
    ])
    expect(ordered.map((entry) => entry.id)).toEqual(['w1', 'p2', 'p1', 'h1', 'r2', 'r1'])
  })

  it('breaks a tie on the id, so two moderators see the same order', () => {
    const ordered = orderGuestbookQueue([row('b', 'pending', 1), row('a', 'pending', 1)])
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('does not reorder the array it was given', () => {
    const input = [row('b', 'published', 2), row('a', 'pending', 1)]
    orderGuestbookQueue(input)
    expect(input.map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})

describe('pendingGuestbookCount', () => {
  it('counts only the messages waiting for a decision', () => {
    expect(
      pendingGuestbookCount([
        row('a', 'pending', 1),
        row('b', 'published', 2),
        row('c', 'pending', 3),
      ]),
    ).toBe(2)
  })
})
