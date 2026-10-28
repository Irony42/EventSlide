import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { readEventTheme } from '../../../design-system/eventTheme'
import { rememberEventTheme } from '../../../lib/guestSession'
import { ApiError } from '../../../lib/http'
import { useLoader } from '../../../lib/useLoader'
import type { EventThemeDto, GuestPhotoDto, WallItemDto, WallResponse } from '../../../lib/api/dto'

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
  /** The server no longer recognises this guest (`401` on their own list). */
  readonly signedOut: boolean
  /**
   * The gallery is no longer served (archived, not open, suspended): nothing to retry.
   * Read from the **wall**, which is public, so a guest's cookie cannot make it say so; the
   * upload screen's own-photos read cannot claim the same (see `useMyPhotos`).
   */
  readonly unavailable: boolean
  /** The host's switch, as the wall says it now. */
  readonly reactionsEnabled: boolean
  /**
   * The event's look as the wall says it now, or `null` until it has answered (or when it
   * carries none this build can read). It is the answer the screen prefers to the join's
   * stored copy, which a host's later change leaves behind. The wall's read is the feed's own,
   * so this costs no request.
   */
  readonly theme: EventThemeDto | null
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
  const loadMine = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<{ readonly items: readonly GuestPhotoDto[]; readonly signedOut: boolean }> => {
      try {
        const answer = await api.myPhotos(slug, signal)
        return { items: answer.items, signedOut: false }
      } catch (cause) {
        // The guest's access is gone (no cookie, or one past its 36 hours). The feed is public and
        // still reads, so this is an answer, not a failure: the screen reports it to the device.
        if (cause instanceof ApiError && cause.status === 401) return { items: [], signedOut: true }
        throw cause
      }
    },
    [api, slug],
  )
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
  const answered = useMemo(() => readEventTheme(served?.theme ?? null), [served])
  // What was learned stands: a later answer with no theme this build can read (a server rolled
  // back mid-evening) must not drop the page back to the join's older copy. Adjusted during
  // render rather than in an effect, which is the supported way to derive state from a prop.
  const [learned, setLearned] = useState<EventThemeDto | null>(null)
  if (answered !== null && answered !== learned) setLearned(answered)
  const theme = answered ?? learned
  // Written back so the next open — this screen's or the upload screen's — paints it first.
  useEffect(() => {
    if (theme !== null) rememberEventTheme(slug, theme)
  }, [slug, theme])

  return {
    items: served === null ? null : served.items,
    unavailable: wall.data?.gone === true,
    signedOut: mine.data?.signedOut === true,
    reactionsEnabled: served?.reactionsEnabled ?? false,
    theme,
    ownIds,
    settling: (wall.data === null && wall.loading) || (mine.data === null && mine.loading),
    refreshing: wall.data !== null && wall.loading,
    error: wall.error,
    refresh,
  }
}
