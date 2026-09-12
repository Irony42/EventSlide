import { describe, expect, it } from 'vitest'
import type { PhotoStatus } from '../photos/photoStatus'
import { asPhotoId } from '../shared/ids'
import {
  buildQueue,
  defaultOrderFor,
  filterQueue,
  nextAfterDecision,
  orderQueue,
  partitionForBulk,
  pendingCount,
  type QueueItem,
} from './moderationQueue'

const anItem = (id: string, arrivedAt: string, status: PhotoStatus = 'pending'): QueueItem => ({
  id: asPhotoId(id),
  status,
  createdAt: new Date(arrivedAt),
  hasCaption: false,
})

const ids = (items: readonly QueueItem[]): readonly string[] => items.map((item) => item.id)

const oneOfEachStatus = (): readonly QueueItem[] => [
  anItem('pending-1', '2025-06-14T20:00:00Z', 'pending'),
  anItem('published-1', '2025-06-14T20:01:00Z', 'published'),
  anItem('rejected-1', '2025-06-14T20:02:00Z', 'rejected'),
  anItem('hidden-1', '2025-06-14T20:03:00Z', 'hidden'),
]

describe('defaultOrderFor', () => {
  it('serves the pending tab oldest first so an early guest is not starved', () => {
    expect(defaultOrderFor('pending')).toBe('oldestFirst')
  })

  it.each(['published', 'rejected', 'hidden', 'all'] as const)(
    'browses the %s tab newest first',
    (filter) => {
      expect(defaultOrderFor(filter)).toBe('newestFirst')
    },
  )
})

describe('filterQueue', () => {
  it('keeps every item under the all filter', () => {
    expect(ids(filterQueue(oneOfEachStatus(), 'all'))).toEqual([
      'pending-1',
      'published-1',
      'rejected-1',
      'hidden-1',
    ])
  })

  it.each(['pending', 'published', 'rejected', 'hidden'] as const)(
    'keeps only the %s items',
    (filter) => {
      expect(ids(filterQueue(oneOfEachStatus(), filter))).toEqual([filter + '-1'])
    },
  )
})

describe('orderQueue', () => {
  it('puts the earliest arrival first under oldestFirst', () => {
    const items = [anItem('late', '2025-06-14T21:00:00Z'), anItem('early', '2025-06-14T20:00:00Z')]

    expect(ids(orderQueue(items, 'oldestFirst'))).toEqual(['early', 'late'])
  })

  it('puts the latest arrival first under newestFirst', () => {
    const items = [anItem('early', '2025-06-14T20:00:00Z'), anItem('late', '2025-06-14T21:00:00Z')]

    expect(ids(orderQueue(items, 'newestFirst'))).toEqual(['late', 'early'])
  })

  it('leaves the array it was given untouched', () => {
    const items = [anItem('late', '2025-06-14T21:00:00Z'), anItem('early', '2025-06-14T20:00:00Z')]

    orderQueue(items, 'oldestFirst')

    expect(ids(items)).toEqual(['late', 'early'])
  })

  it.each(['oldestFirst', 'newestFirst'] as const)(
    'breaks a same-instant tie by id under %s, so two moderators agree',
    (order) => {
      const items = [
        anItem('photo-b', '2025-06-14T20:00:00Z'),
        anItem('photo-a', '2025-06-14T20:00:00Z'),
      ]

      expect(ids(orderQueue(items, order))).toEqual(['photo-a', 'photo-b'])
    },
  )

  it('keeps a same-instant tie in id order when the rows already arrived that way', () => {
    const sameInstant = '2025-06-14T20:00:00Z'
    const alreadyAscending = [anItem('photo-a', sameInstant), anItem('photo-b', sameInstant)]

    expect(ids(orderQueue(alreadyAscending, 'oldestFirst'))).toEqual(['photo-a', 'photo-b'])
  })
})

describe('buildQueue', () => {
  const arrivals = (): readonly QueueItem[] => [
    anItem('published-1', '2025-06-14T20:00:00Z', 'published'),
    anItem('pending-late', '2025-06-14T21:00:00Z'),
    anItem('pending-early', '2025-06-14T20:30:00Z'),
  ]

  it('filters before it orders', () => {
    const result = buildQueue(arrivals(), { filter: 'pending', order: 'oldestFirst' })

    expect(result.ok && ids(result.value)).toEqual(['pending-early', 'pending-late'])
  })

  it('returns every matching item when no limit is asked for', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'newestFirst' })

    expect(result.ok && result.value).toHaveLength(3)
  })

  it('truncates to the limit after ordering, not before', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'oldestFirst', limit: 2 })

    expect(result.ok && ids(result.value)).toEqual(['published-1', 'pending-early'])
  })

  it('honours a limit of one, the smallest page a caller may ask for', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'oldestFirst', limit: 1 })

    expect(result.ok && ids(result.value)).toEqual(['published-1'])
  })

  it('returns the whole queue when the limit is larger than it', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'oldestFirst', limit: 4 })

    expect(result.ok && ids(result.value)).toEqual(['published-1', 'pending-early', 'pending-late'])
  })

  it('returns an empty queue rather than an error before anything has arrived', () => {
    const result = buildQueue([], { filter: 'pending', order: 'oldestFirst', limit: 10 })

    expect(result.ok && result.value).toEqual([])
  })

  it('refuses a limit of zero, which would render as a lost queue', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'oldestFirst', limit: 0 })

    expect(!result.ok && result.error.code).toBe('moderation.limitInvalid')
  })

  it('refuses a fractional limit rather than letting slice round it', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'oldestFirst', limit: 1.5 })

    expect(!result.ok && result.error.code).toBe('moderation.limitInvalid')
  })

  it('treats a negative limit as bad input, not as a conflict', () => {
    const result = buildQueue(arrivals(), { filter: 'all', order: 'oldestFirst', limit: -1 })

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('pendingCount', () => {
  it('counts only the photos still waiting on a decision', () => {
    const items = [
      anItem('waiting-1', '2025-06-14T20:00:00Z'),
      anItem('waiting-2', '2025-06-14T20:01:00Z'),
      anItem('on-the-wall', '2025-06-14T20:02:00Z', 'published'),
      anItem('turned-down', '2025-06-14T20:03:00Z', 'rejected'),
      anItem('taken-off', '2025-06-14T20:04:00Z', 'hidden'),
    ]

    expect(pendingCount(items)).toBe(2)
  })

  it('is zero for an empty queue', () => {
    expect(pendingCount([])).toBe(0)
  })
})

describe('nextAfterDecision', () => {
  const queue = (): readonly QueueItem[] => [
    anItem('first', '2025-06-14T20:00:00Z'),
    anItem('second', '2025-06-14T20:01:00Z'),
    anItem('third', '2025-06-14T20:02:00Z'),
  ]

  it('focuses the following photo after a decision on the first', () => {
    const next = nextAfterDecision(queue(), asPhotoId('first'), 'pending', 'oldestFirst')

    expect(next).toBe(asPhotoId('second'))
  })

  it('focuses the following photo after a decision in the middle', () => {
    const next = nextAfterDecision(queue(), asPhotoId('second'), 'pending', 'oldestFirst')

    expect(next).toBe(asPhotoId('third'))
  })

  it('focuses the preceding photo after a decision on the last row, never wrapping to the top', () => {
    const next = nextAfterDecision(queue(), asPhotoId('third'), 'pending', 'oldestFirst')

    expect(next).toBe(asPhotoId('second'))
  })

  it('focuses nothing when the decided photo was the only one', () => {
    const only = [anItem('only', '2025-06-14T20:00:00Z')]

    const next = nextAfterDecision(only, asPhotoId('only'), 'pending', 'oldestFirst')

    expect(next).toBeNull()
  })

  it('focuses nothing for a photo another moderator already dealt with', () => {
    const next = nextAfterDecision(queue(), asPhotoId('gone'), 'pending', 'oldestFirst')

    expect(next).toBeNull()
  })

  it('follows the displayed order rather than the arrival order', () => {
    const next = nextAfterDecision(queue(), asPhotoId('second'), 'pending', 'newestFirst')

    expect(next).toBe(asPhotoId('first'))
  })

  it('focuses nothing when the queue is empty', () => {
    const next = nextAfterDecision([], asPhotoId('first'), 'pending', 'oldestFirst')

    expect(next).toBeNull()
  })

  it('skips over a photo the current filter excludes', () => {
    const mixed = [
      anItem('pending-first', '2025-06-14T20:00:00Z'),
      anItem('published-between', '2025-06-14T20:01:00Z', 'published'),
      anItem('pending-last', '2025-06-14T20:02:00Z'),
    ]

    const next = nextAfterDecision(mixed, asPhotoId('pending-first'), 'pending', 'oldestFirst')

    expect(next).toBe(asPhotoId('pending-last'))
  })
})

describe('partitionForBulk', () => {
  const selection = (): readonly QueueItem[] => [
    anItem('on-the-wall', '2025-06-14T20:00:00Z', 'published'),
    anItem('fresh', '2025-06-14T20:01:00Z'),
  ]

  it('keeps the items the decision can legally act on', () => {
    const { applicable } = partitionForBulk(selection(), 'hide')

    expect(applicable).toEqual([asPhotoId('on-the-wall')])
  })

  it('skips an illegal transition instead of failing the whole batch', () => {
    const { skipped } = partitionForBulk(selection(), 'hide')

    expect(skipped).toEqual([asPhotoId('fresh')])
  })

  it.each([
    ['pending', 'hide'],
    ['rejected', 'hide'],
  ] as const)('skips a %s photo when the batch decision is %s', (status, decision) => {
    const items = [anItem('candidate', '2025-06-14T20:00:00Z', status)]

    const { skipped } = partitionForBulk(items, decision)

    expect(skipped).toEqual([asPhotoId('candidate')])
  })

  it.each(['publish', 'reject'] as const)(
    'accepts a pending photo for %s, the two verdicts a fresh arrival can receive',
    (decision) => {
      const items = [anItem('fresh', '2025-06-14T20:00:00Z')]

      const { applicable } = partitionForBulk(items, decision)

      expect(applicable).toEqual([asPhotoId('fresh')])
    },
  )

  it('has nothing to apply and nothing to skip for an empty selection', () => {
    expect(partitionForBulk([], 'publish')).toEqual({ applicable: [], skipped: [] })
  })

  it('accepts a decision that changes nothing, so a repeated batch is not an error', () => {
    const items = [anItem('already-published', '2025-06-14T20:00:00Z', 'published')]

    const { applicable } = partitionForBulk(items, 'publish')

    expect(applicable).toEqual([asPhotoId('already-published')])
  })
})
