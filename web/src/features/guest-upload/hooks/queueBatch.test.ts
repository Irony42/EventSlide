import { describe, expect, it } from 'vitest'
import { summarizeBatch } from './queueBatch'
import type { UploadItem, UploadItemState } from './useUploadQueue'

/** The rule the pane's one-line summary stands on, as a plain function over the rows. */

const row = (state: UploadItemState, photoId: string | null = null): UploadItem => ({
  id: `upload-${state}-${photoId ?? 'none'}`,
  file: new File([], 'p.jpg'),
  previewUrl: 'blob:p',
  state,
  progress: 0,
  error: null,
  photoId,
  retryable: false,
  outboxId: null,
})

describe('summarizeBatch', () => {
  it('is not a finished batch when there is nothing in it', () => {
    expect(summarizeBatch([])).toEqual({
      settledOk: false,
      arrived: 0,
      alreadyThere: 0,
      photoIds: [],
    })
  })

  it('is finished when every photo is sent or was already there', () => {
    const batch = summarizeBatch([row('done', 'a'), row('duplicate', 'b'), row('done', 'c')])

    expect(batch).toEqual({
      settledOk: true,
      arrived: 3,
      alreadyThere: 1,
      photoIds: ['a', 'b', 'c'],
    })
  })

  it.each(['pending', 'preparing', 'uploading', 'queued', 'failed'] as const)(
    'is not finished while one photo is %s, however many of the others arrived',
    (state) => {
      const batch = summarizeBatch([row('done', 'a'), row('duplicate', 'b'), row(state)])

      expect(batch.settledOk).toBe(false)
      expect(batch.arrived).toBe(2)
      expect(batch.alreadyThere).toBe(1)
    },
  )

  it('counts a batch of nothing but duplicates as arrived, all of it already there', () => {
    expect(summarizeBatch([row('duplicate', 'a'), row('duplicate', 'b')])).toMatchObject({
      settledOk: true,
      arrived: 2,
      alreadyThere: 2,
    })
  })

  it('lists only the ids the server gave, and none for a photo that has none', () => {
    const batch = summarizeBatch([row('done', 'a'), row('done', null), row('uploading', 'z')])

    expect(batch.photoIds).toEqual(['a'])
  })
})
