import { useCallback, useMemo } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { useLoader } from '../../../lib/useLoader'
import type { WallItemDto, WallResponse } from '../../../lib/api/dto'

/**
 * What a guest's phone shows of the evening: the published photographs, as the wall has
 * them, and which of them are the guest's own.
 *
 * **The wall's own read, not a second one.** `GET /api/events/:slug/wall` is public and
 * answers with exactly the photographs the room can see, newest first, so the phone shows
 * what the projector shows and cannot show anything else: the read path is structurally
 * incapable of returning a pending photo. It also says, live, whether the host has
 * reactions on — a better answer than the join's, which a guest holds for the whole
 * evening.
 *
 * **Which photographs are the guest's own** comes from the guest's own list, because the
 * wall names an author's display name and never an identity. It only decides what is drawn
 * (no reaction buttons on one's own photograph); the server is what refuses
 * (`403 reaction.ownPhoto`), so a list that failed to load costs a refusal in words and
 * nothing else.
 */

/**
 * What the wall read answered: the photographs, or "this gallery is not served".
 *
 * `404 event.notFound` is the server saying the event is archived, not open or its account
 * suspended (docs/API.md, the wall's errors). Retrying cannot change that, so it is an
 * **answer** here and not a failure: the screen says so once and offers no "Réessayer".
 * A closed event still serves its wall, so a closed evening is an ordinary feed.
 */
type WallAnswer = { readonly gone: false; readonly wall: WallResponse } | { readonly gone: true }

export interface PhotoFeedState {
  /** `null` until the wall has answered once. Absence is not emptiness. */
  readonly items: readonly WallItemDto[] | null
  /** The gallery is no longer served (archived, not open, suspended): nothing to retry. */
  readonly unavailable: boolean
  /** The host's switch, as the wall says it now. */
  readonly reactionsEnabled: boolean
  /** Ids of the guest's own photographs. Empty while unknown or when that read failed. */
  readonly ownIds: ReadonlySet<string>
  /** True until both reads have answered once: drawing bars before then would flash them. */
  readonly settling: boolean
  /** A refresh is in the air: the screen shows the previous answer meanwhile. */
  readonly refreshing: boolean
  /**
   * A sentence in the guest's language when the last read of the wall failed. With `items`
   * still set, what is on screen is older than the guest asked for.
   */
  readonly error: string | null
  readonly refresh: () => void
}

export const usePhotoFeed = (slug: string): PhotoFeedState => {
  const api = useApi()
  const loadWall = useCallback(
    async (signal: AbortSignal): Promise<WallAnswer> => {
      try {
        return { gone: false, wall: await api.wall(slug, signal) }
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404 && cause.code === 'event.notFound') {
          return { gone: true }
        }
        throw cause
      }
    },
    [api, slug],
  )
  const loadMine = useCallback((signal: AbortSignal) => api.myPhotos(slug, signal), [api, slug])
  const wall = useLoader(loadWall)
  const mine = useLoader(loadMine)

  const ownIds = useMemo<ReadonlySet<string>>(
    () => new Set((mine.data?.items ?? []).map((photo) => photo.id)),
    [mine.data],
  )

  const reloadWall = wall.reload
  const reloadMine = mine.reload
  const refresh = useCallback(() => {
    reloadWall()
    reloadMine()
  }, [reloadWall, reloadMine])

  const served = wall.data === null || wall.data.gone ? null : wall.data.wall

  return {
    items: served === null ? null : served.items,
    unavailable: wall.data?.gone === true,
    reactionsEnabled: served?.reactionsEnabled ?? false,
    ownIds,
    settling: (wall.data === null && wall.loading) || (mine.data === null && mine.loading),
    refreshing: wall.data !== null && wall.loading,
    error: wall.error,
    refresh,
  }
}
