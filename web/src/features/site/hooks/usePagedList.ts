import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { errorMessage } from '../adminShared'
import { useLoader } from '../adminShared'

/** One page of a listing: the rows, and the cursor of the next page or `null` at the end. */
export interface Page<Item, Cursor> {
  readonly items: readonly Item[]
  readonly next: Cursor | null
}

export interface PagedList<Item> {
  readonly items: readonly Item[]
  /** The first page is in flight. */
  readonly loading: boolean
  /** The first page failed: a sentence in the reader's language, or `null`. */
  readonly error: string | null
  /** Starts again from the first page, which is what a write does to a list it changed. */
  readonly reload: () => void
  readonly hasMore: boolean
  readonly more: () => void
  readonly loadingMore: boolean
  /** The next page failed. The rows already read stay: it is a refusal to say, not a blank page. */
  readonly moreError: string | null
}

/**
 * A listing read page by page, newest first, as every `/api/site` read is paged.
 *
 * The first page is `useLoader`'s, so it has the four states every screen owes its reader (a wait,
 * a refusal with a retry, an empty answer, rows). The pages after it are read on request and
 * appended; they belong to the first page they were read after, so a reload drops them and a
 * second reload cannot show rows of the first. A cursor outlives nothing (docs/SECURITY.md §18),
 * and reloading is what the console does.
 *
 * `fetchPage` must be stable (a `useCallback` over `useApi()`): it identifies the request.
 */
export const usePagedList = <Item, Cursor>(
  fetchPage: (cursor: Cursor | undefined, signal?: AbortSignal) => Promise<Page<Item, Cursor>>,
): PagedList<Item> => {
  const t = useTranslations()
  const loadFirst = useCallback((signal: AbortSignal) => fetchPage(undefined, signal), [fetchPage])
  const first = useLoader(loadFirst)
  const [later, setLater] = useState<{
    /** The first page these rows were read after. */
    readonly after: Page<Item, Cursor>
    readonly items: readonly Item[]
    readonly next: Cursor | null
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** A refusal belongs to the first page it was read after, like the rows do. */
  const [failure, setFailure] = useState<{
    readonly after: Page<Item, Cursor>
    readonly cause: unknown
  } | null>(null)

  const current = later !== null && later.after === first.data ? later : null
  const items = [...(first.data?.items ?? []), ...(current?.items ?? [])]
  const next = current === null ? (first.data?.next ?? null) : current.next

  const more = useCallback(() => {
    const base = first.data
    if (base === null || next === null) return
    setLoadingMore(true)
    setFailure(null)
    fetchPage(next)
      .then(
        (page) =>
          setLater({
            after: base,
            items: [...(current?.items ?? []), ...page.items],
            next: page.next,
          }),
        (cause: unknown) => setFailure({ after: base, cause }),
      )
      .finally(() => setLoadingMore(false))
  }, [fetchPage, first.data, next, current])

  const moreError = useMemo(
    () =>
      failure === null || failure.after !== first.data ? null : errorMessage(failure.cause, t),
    [failure, first.data, t],
  )

  return {
    items,
    loading: first.loading,
    error: first.error,
    reload: first.reload,
    hasMore: next !== null,
    more,
    loadingMore,
    moreError,
  }
}
