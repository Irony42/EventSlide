import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../../app/ApiProvider'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import type { GuestPhotoDto } from '../../../lib/api/dto'

/**
 * The guest's own photos, from `GET /api/events/:slug/photos/mine`.
 *
 * It exists because silence after an upload is indistinguishable from a failure, and a
 * guest who cannot tell sends the photo again. The list carries whatever the host
 * decided, including a refusal — being told beats wondering.
 *
 * `canDelete` is never recomputed here. The server derives it from the grace window
 * and the current status, and 1.0's client-side version of the same rule is why it
 * offered a delete button that answered 403.
 */

export interface MyPhotosState {
  readonly photos: readonly GuestPhotoDto[]
  readonly loading: boolean
  /** A French sentence, ready to render. `null` when nothing has failed. */
  readonly error: string | null
  readonly refresh: () => void
  readonly remove: (photoId: string) => Promise<void>
}

export const useMyPhotos = (slug: string): MyPhotosState => {
  const api = useApi()
  const [state, setState] = useState<Pick<MyPhotosState, 'photos' | 'loading' | 'error'>>({
    photos: [],
    loading: true,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  /**
   * Marks the refetch as pending here rather than in the effect body: setting state
   * inside an effect causes a cascading render and lint rejects it. The first load
   * already starts from `loading: true`.
   */
  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }))
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    api.myPhotos(slug, controller.signal).then(
      (response) => {
        if (current) setState({ photos: response.items, loading: false, error: null })
      },
      (cause: unknown) => {
        if (!current) return
        // The abort is this effect's own cleanup — StrictMode mounts twice — and not
        // a failure to report to the guest.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState({ photos: [], loading: false, error: fr.upload.mineFailed })
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [api, slug, attempt])

  const remove = useCallback(
    async (photoId: string) => {
      try {
        await api.deleteMyPhoto(slug, photoId)
        refresh()
      } catch (cause) {
        // The list is kept: a refused deletion is not a reason to blank the one screen
        // that tells the guest their photos arrived.
        setState((previous) => ({
          ...previous,
          error: cause instanceof ApiError ? cause.message : fr.errors.unknown,
        }))
      }
    },
    [api, refresh, slug],
  )

  return { ...state, refresh, remove }
}
