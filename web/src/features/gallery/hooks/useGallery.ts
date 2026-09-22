import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import type { GalleryDto, GalleryPhotoDto } from '../../../lib/api/dto'

/**
 * The shared gallery as view-state (roadmap §4.1): what the link opens onto, and the
 * pages of it loaded so far.
 *
 * No rule lives here. Whether a link is alive, whether it wants a password, which
 * photographs it shows and for how long a URL works are all the server's; this only tells
 * its four answers apart — the album, "not available", "wants a password", and a failure
 * worth a retry — and keeps what has been loaded.
 *
 * ## Why the pages are re-read on a timer
 *
 * Every URL in a page is signed for an hour. A guest who leaves the album open and comes
 * back to download is otherwise holding links that answer `404`, which reads exactly like
 * a revoked album. So the pages already loaded are re-read, in place, a little before
 * their signatures lapse — which is also how a link the host revoked stops showing on a
 * page somebody left open.
 */

export type GalleryPhase = 'loading' | 'ready' | 'unavailable' | 'locked' | 'failed'

export interface GalleryState {
  readonly phase: GalleryPhase
  /** Present once `ready`. */
  readonly gallery: GalleryDto | null
  readonly items: readonly GalleryPhotoDto[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  /** What the last failure was: the first load, a page, or a password. Rendered by the page. */
  readonly failure: unknown
  readonly unlocking: boolean
  readonly unlockFailure: unknown
  readonly unlock: (password: string) => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly retry: () => void
}

/** Fifteen minutes inside the hour a signed URL lives, so a slow network never loses the race. */
export const GALLERY_REFRESH_MS = 45 * 60 * 1000

/** A refresh re-reads what was on screen, and no more than this many pages of it. */
const MAX_REFRESH_PAGES = 50

interface Loaded {
  readonly gallery: GalleryDto
  readonly items: readonly GalleryPhotoDto[]
  readonly cursor: string | null
}

type Answer =
  | { readonly phase: 'ready'; readonly loaded: Loaded }
  | { readonly phase: 'unavailable' | 'locked' | 'failed'; readonly failure: unknown }

/** The server's answer, sorted into what the page draws. */
const classify = (cause: unknown): Answer => {
  if (cause instanceof ApiError && cause.code === 'gallery.passwordRequired') {
    return { phase: 'locked', failure: null }
  }
  if (cause instanceof ApiError && cause.code === 'gallery.notAvailable') {
    return { phase: 'unavailable', failure: null }
  }
  return { phase: 'failed', failure: cause }
}

export const useGallery = (
  token: string,
  { refreshEveryMs = GALLERY_REFRESH_MS }: { readonly refreshEveryMs?: number } = {},
): GalleryState => {
  const api = useApi()
  const [attempt, setAttempt] = useState(0)
  /** Tagged with the attempt that produced it, so `loading` is derived rather than stored. */
  const [answer, setAnswer] = useState<{ readonly attempt: number; readonly value: Answer } | null>(
    null,
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailure, setMoreFailure] = useState<unknown>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockFailure, setUnlockFailure] = useState<unknown>(null)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /**
   * The album from the start: the summary, then pages until at least `atLeast` photographs
   * are loaded again — one page for a first load, as many as were on screen for a refresh.
   */
  const read = useCallback(
    async (atLeast: number, signal?: AbortSignal): Promise<Loaded> => {
      const gallery = await api.gallery(token, signal)
      const items: GalleryPhotoDto[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const page = await api.galleryPhotos(token, cursor, signal)
        items.push(...page.items)
        cursor = page.nextCursor
        pages += 1
      } while (cursor !== null && items.length < atLeast && pages < MAX_REFRESH_PAGES)
      return { gallery, items, cursor }
    },
    [api, token],
  )

  useEffect(() => {
    const controller = new AbortController()
    read(1, controller.signal).then(
      (loaded) => setAnswer({ attempt, value: { phase: 'ready', loaded } }),
      (cause: unknown) => {
        if (!controller.signal.aborted) setAnswer({ attempt, value: classify(cause) })
      },
    )
    return () => controller.abort()
  }, [read, attempt])

  const current = answer !== null && answer.attempt === attempt ? answer.value : null
  const loaded = current?.phase === 'ready' ? current.loaded : null
  const shown = loaded?.items.length ?? 0

  // Re-read what is on screen before its signatures lapse. See the file comment.
  useEffect(() => {
    if (loaded === null) return
    const timer = setInterval(() => {
      read(shown).then(
        (fresh) => {
          if (alive.current) setAnswer({ attempt, value: { phase: 'ready', loaded: fresh } })
        },
        (cause: unknown) => {
          // A link that died while the page was open says so; a network blip does not
          // take the album off the screen — the next tick tries again.
          const classified = classify(cause)
          if (alive.current && classified.phase !== 'failed') {
            setAnswer({ attempt, value: classified })
          }
        },
      )
    }, refreshEveryMs)
    return () => clearInterval(timer)
  }, [loaded, shown, read, attempt, refreshEveryMs])

  const loadMore = useCallback(async () => {
    if (loaded === null || loaded.cursor === null || loadingMore) return
    setLoadingMore(true)
    setMoreFailure(null)
    try {
      const page = await api.galleryPhotos(token, loaded.cursor)
      if (!alive.current) return
      setAnswer({
        attempt,
        value: {
          phase: 'ready',
          loaded: {
            gallery: loaded.gallery,
            items: [...loaded.items, ...page.items],
            cursor: page.nextCursor,
          },
        },
      })
    } catch (cause) {
      if (!alive.current) return
      const classified = classify(cause)
      if (classified.phase === 'failed') setMoreFailure(cause)
      else setAnswer({ attempt, value: classified })
    } finally {
      if (alive.current) setLoadingMore(false)
    }
  }, [api, token, loaded, loadingMore, attempt])

  const unlock = useCallback(
    async (password: string) => {
      setUnlocking(true)
      setUnlockFailure(null)
      try {
        await api.unlockGallery(token, password)
        // The cookie is set; the same read as the first one now opens the album.
        if (alive.current) setAttempt((previous) => previous + 1)
      } catch (cause) {
        if (!alive.current) return
        // A link that died while the password form was open is not a wrong password.
        if (cause instanceof ApiError && cause.code === 'gallery.notAvailable') {
          setAnswer({ attempt, value: { phase: 'unavailable', failure: null } })
        } else {
          setUnlockFailure(cause)
        }
      } finally {
        if (alive.current) setUnlocking(false)
      }
    },
    [api, token, attempt],
  )

  const retry = useCallback(() => {
    setMoreFailure(null)
    setAttempt((previous) => previous + 1)
  }, [])

  return {
    phase: current === null ? 'loading' : current.phase,
    gallery: loaded?.gallery ?? null,
    items: loaded?.items ?? [],
    hasMore: loaded !== null && loaded.cursor !== null,
    loadingMore,
    failure: current !== null && current.phase === 'failed' ? current.failure : moreFailure,
    unlocking,
    unlockFailure,
    unlock,
    loadMore,
    retry,
  }
}
