import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { messageForCode } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
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
  /**
   * A sentence in the guest's current language, ready to render. `null` when nothing
   * has failed.
   */
  readonly error: string | null
  readonly refresh: () => void
  readonly remove: (photoId: string) => Promise<void>
}

/**
 * What went wrong, kept as a fact rather than as a sentence.
 *
 * The sentence is composed at render, from {@link Failure} and the active table, and
 * that is the whole reason this type exists: storing the finished French put the copy
 * table into the read effect's dependencies, so changing language re-read the list. On
 * venue Wi-Fi that is a round trip for a word — and when it failed, the error branch
 * replaced the thumbnails with an empty list and told the guest their uploads could not
 * be shown, for no reason except that they had tapped the language picker.
 *
 * `code` is the server's own, so a refused deletion still says *why* it was refused,
 * in whichever language the guest is reading when they look at it.
 */
type Failure = { readonly kind: 'load' } | { readonly kind: 'action'; readonly code: string | null }

interface Loaded {
  readonly photos: readonly GuestPhotoDto[]
  readonly loading: boolean
  readonly failure: Failure | null
}

export const useMyPhotos = (slug: string): MyPhotosState => {
  const t = useTranslations()
  const api = useApi()
  const [state, setState] = useState<Loaded>({
    photos: [],
    loading: true,
    failure: null,
  })
  const [attempt, setAttempt] = useState(0)

  /**
   * Marks the refetch as pending here rather than in the effect body: setting state
   * inside an effect causes a cascading render and lint rejects it. The first load
   * already starts from `loading: true`.
   */
  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, failure: null }))
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    api.myPhotos(slug, controller.signal).then(
      (response) => {
        if (current) setState({ photos: response.items, loading: false, failure: null })
      },
      (cause: unknown) => {
        if (!current) return
        // The abort is this effect's own cleanup — StrictMode mounts twice — and not
        // a failure to report to the guest.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState({ photos: [], loading: false, failure: { kind: 'load' } })
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
          failure: { kind: 'action', code: cause instanceof ApiError ? cause.code : null },
        }))
      }
    },
    [api, refresh, slug],
  )

  /**
   * The sentence, composed here rather than where the failure was caught.
   *
   * This is what lets the read effect above depend on nothing but the request, and it is
   * also the honest behaviour: a guest who changes language while a refusal is on screen
   * reads the refusal in the language they just chose.
   */
  const error = useMemo<string | null>(() => {
    if (state.failure === null) return null
    if (state.failure.kind === 'load') return t.upload.mineFailed
    return state.failure.code === null ? t.errors.unknown : messageForCode(state.failure.code, t)
  }, [state.failure, t])

  return { photos: state.photos, loading: state.loading, error, refresh, remove }
}
