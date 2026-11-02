import { useCallback, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { sentenceFor } from './useMyMessages'

/**
 * Writing a guestbook message (spec 01): the request, and what became of it.
 *
 * `send` resolves to what the server decided (`published` on an event that publishes on arrival,
 * `pending` otherwise), because the thank-you must say what is true and the phone does not know the
 * moderation mode. A refusal is kept as a sentence in `error`, in the language on screen, and the
 * text is **kept** by the caller: a guest who loses a paragraph to a limit retypes nothing.
 */

export interface GuestbookWriter {
  readonly sending: boolean
  readonly error: string | null
  /** `null` when it failed (see `error`). */
  readonly send: (text: string) => Promise<{ readonly status: string } | null>
  readonly clearError: () => void
}

export const useGuestbook = (slug: string, onWritten: () => void): GuestbookWriter => {
  const api = useApi()
  const t = useTranslations()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  const send = useCallback(
    async (text: string) => {
      setSending(true)
      setFailure(null)
      try {
        const created = await api.writeGuestbookEntry(slug, text)
        onWritten()
        return { status: created.status }
      } catch (cause) {
        setFailure(cause)
        return null
      } finally {
        setSending(false)
      }
    },
    [api, slug, onWritten],
  )

  const clearError = useCallback(() => setFailure(null), [])

  return {
    sending,
    error: failure === null ? null : sentenceFor(failure, t),
    send,
    clearError,
  }
}
