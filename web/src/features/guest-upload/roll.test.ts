import { describe, expect, it } from 'vitest'
import { heldPoses, keepFirst, posesLeft } from './roll'
import type { UploadItem, UploadItemState } from './hooks/useUploadQueue'

const row = (state: UploadItemState, overrides: Partial<UploadItem> = {}): UploadItem => ({
  id: `upload-${state}`,
  file: new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
  previewUrl: 'blob:a',
  state,
  progress: 0,
  error: null,
  photoId: null,
  retryable: false,
  outboxId: null,
  missionId: null,
  caption: null,
  challengeId: null,
  ...overrides,
})

const files = (count: number): readonly File[] =>
  Array.from({ length: count }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }))

describe('heldPoses: what the phone owes the server and the server has not counted', () => {
  it('counts a photo chosen, one being prepared and one in flight', () => {
    expect(heldPoses([row('pending'), row('preparing'), row('uploading')], 0)).toBe(3)
  })

  it('counts what the outbox holds for the network', () => {
    expect(heldPoses([], 4)).toBe(4)
  })

  it('counts a row handed to the outbox once, by the outbox: never twice', () => {
    expect(heldPoses([row('queued', { outboxId: 'o-1' })], 1)).toBe(1)
  })

  it('does not count a photo that arrived: the server counts it at its next read', () => {
    expect(heldPoses([row('done'), row('duplicate')], 0)).toBe(0)
  })

  it('counts a failed photo that a retry would send, and not one that cannot be retried', () => {
    expect(heldPoses([row('failed', { retryable: true })], 0)).toBe(1)
    expect(heldPoses([row('failed', { retryable: false })], 0)).toBe(0)
  })
})

describe('posesLeft: the roll as the phone counts it', () => {
  it('is nothing to count without a cap, and for a server that predates the roll', () => {
    expect(posesLeft(null, 3)).toBeNull()
    expect(posesLeft(undefined, 3)).toBeNull()
  })

  it('is the cap less what the server counted and what the phone still owes', () => {
    expect(posesLeft({ max: 27, taken: 10 }, 5)).toBe(12)
  })

  it('never goes below zero, even when the phone owes more than the roll holds', () => {
    expect(posesLeft({ max: 3, taken: 2 }, 5)).toBe(0)
  })
})

describe('keepFirst: a pick cut to the poses left', () => {
  it('keeps the first photographs in the order the picker gave them, and counts what is set aside', () => {
    const picked = files(5)
    const { kept, dropped } = keepFirst(picked, 3)
    expect(kept).toEqual(picked.slice(0, 3))
    expect(dropped).toBe(2)
  })

  it('keeps everything that fits, exactly at the limit too', () => {
    expect(keepFirst(files(3), 3)).toEqual({ kept: files(3), dropped: 0 })
  })

  it('keeps everything with no cap', () => {
    expect(keepFirst(files(40), null).dropped).toBe(0)
  })

  it('keeps nothing at zero poses', () => {
    expect(keepFirst(files(2), 0)).toEqual({ kept: [], dropped: 2 })
  })
})
