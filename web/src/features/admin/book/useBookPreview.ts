import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlbumBookPreviewInput } from '../../../lib/api/client'
import type { BookPreviewDto } from '../../../lib/api/dto'
import { ApiError, isAbortError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useApi } from '../../../lib/useApi'

/** How long the settings stay still before the preview is planned again. */
export const BOOK_PREVIEW_DEBOUNCE_MS = 350

export interface BookPreviewState {
  /** The last plan the server made: kept on screen while the next one is being made. */
  readonly preview: BookPreviewDto | null
  /** Whether a plan for the current settings is on its way (or waiting for the settings to settle). */
  readonly pending: boolean
  /** A sentence for a failure of the last read, or `null`. */
  readonly error: string | null
  /** The code of that failure, when the server gave one (`book.empty` has a screen of its own). */
  readonly code: string | null
  readonly retry: () => void
}

/**
 * The plan of the book the settings describe, read from the server (`GET …/book/preview`), debounced.
 *
 * View-state only: the server plans, this asks. The previous plan stays on screen while a new one is
 * made (a book that blinks out at every keystroke is no preview), a read that is overtaken by a newer
 * one is aborted and its answer is never shown, and the first read does not wait.
 */
export const useBookPreview = (slug: string, input: AlbumBookPreviewInput): BookPreviewState => {
  const api = useApi()
  const t = useTranslations()
  const text = useRef(t)
  const [state, setState] = useState<{
    readonly preview: BookPreviewDto | null
    readonly error: string | null
    readonly code: string | null
  }>({ preview: null, error: null, code: null })
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const seen = useRef(false)

  // The translation table is read when a failure is told, not a reason to ask again.
  useEffect(() => {
    text.current = t
  }, [t])

  const key = JSON.stringify(input)

  useEffect(() => {
    const controller = new AbortController()
    const wait = seen.current ? BOOK_PREVIEW_DEBOUNCE_MS : 0
    const timer = window.setTimeout(() => {
      seen.current = true
      const input = JSON.parse(key) as AlbumBookPreviewInput
      const read = api.albumBookPreview(slug, input, controller.signal)
      void read.then(
        (preview) => {
          setState({ preview, error: null, code: null })
          setSettledFor(key)
        },
        (cause: unknown) => {
          if (isAbortError(cause)) return
          setState((current) => ({
            preview: current.preview,
            error: messageForError(cause, text.current),
            code: cause instanceof ApiError ? cause.code : null,
          }))
          setSettledFor(key)
        },
      )
    }, wait)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [api, slug, key, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, pending: settledFor !== key, retry }
}
