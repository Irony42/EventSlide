import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiError } from './http'
import { fr } from './i18n/fr'
import { messageForError } from './i18n/translations'
import { usePagedList, type Page } from './usePagedList'

/**
 * The paging every console listing shares (WEB-HOST-10): the rows of the pages after the
 * first belong to the first page they were read after, so a reload cannot show them again.
 * The pages are read by cursor, and a cursor outlives nothing.
 */

type Row = string

/** A stable `fetchPage` (a fresh object per read, as a network answer is) over a table of pages keyed by cursor, counting how often each was read. */
const listing = (pages: Readonly<Record<string, Page<Row, string>>>) => {
  const reads: (string | undefined)[] = []
  const fetchPage = (cursor: string | undefined): Promise<Page<Row, string>> => {
    reads.push(cursor)
    const page = pages[cursor ?? 'first']
    return page === undefined
      ? Promise.reject(new Error('no such page'))
      : Promise.resolve({ ...page })
  }
  return { fetchPage, reads }
}

describe('usePagedList', () => {
  it('appends the next page to the first and stops at the end', async () => {
    const { fetchPage } = listing({
      first: { items: ['a', 'b'], next: 'two' },
      two: { items: ['c'], next: null },
    })
    const { result } = renderHook(() => usePagedList(fetchPage))
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']))
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.more())
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b', 'c']))
    expect(result.current.hasMore).toBe(false)
  })

  it('drops the pages after the first when the list is reloaded', async () => {
    const { fetchPage, reads } = listing({
      first: { items: ['a'], next: 'two' },
      two: { items: ['b'], next: null },
    })
    const { result } = renderHook(() => usePagedList(fetchPage))
    await waitFor(() => expect(result.current.items).toEqual(['a']))
    act(() => result.current.more())
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']))

    act(() => result.current.reload())
    await waitFor(() => expect(reads.filter((cursor) => cursor === undefined)).toHaveLength(2))
    await waitFor(() => expect(result.current.items).toEqual(['a']))
    // The cursor is the first page's again, not the end of the one that was dropped.
    expect(result.current.hasMore).toBe(true)
  })

  it('keeps the rows already read when a later page fails, and says why', async () => {
    const refusal = new ApiError(503, 'server.unavailable')
    const fetchPage = (cursor: string | undefined): Promise<Page<Row, string>> =>
      cursor === undefined
        ? Promise.resolve({ items: ['a'], next: 'two' })
        : Promise.reject(refusal)
    const { result } = renderHook(() => usePagedList(fetchPage))
    await waitFor(() => expect(result.current.items).toEqual(['a']))

    act(() => result.current.more())
    await waitFor(() => expect(result.current.moreError).toBe(messageForError(refusal, fr)))
    expect(result.current.items).toEqual(['a'])
    expect(result.current.loadingMore).toBe(false)
  })
})
