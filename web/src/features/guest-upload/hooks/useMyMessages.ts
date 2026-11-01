import { useCallback, useMemo, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useLoader } from '../../../lib/useLoader'
import type { GuestbookEntryDto } from '../../../lib/api/dto'

/**
 * The guest's own guestbook messages, from `GET /api/events/:slug/guestbook/mine` (spec 01).
 *
 * View-state and no rules, like `useMyPhotos`: whether a message can be taken back is the
 * server's `canDelete`, whether a new one would be taken is its `accepting`, and the phone
 * recomputes neither.
 *
 * **A failed read shows nothing of the guestbook, and no error.** An older server has no such route
 * (`404`), a suspended account and a removed event answer `404` too, and a guest the host removed is
 * refused (`401`, `403`): a card that said "could not load" would be an apology for something nobody
 * can fix. With no answer there is no `accepting` and no list, so neither the card nor the list shows;
 * the one error that is shown is a refused removal, from the dialog that asked for it.
 *
 * Not read at all unless `enabled`, which is the event's `allowGuestbook` as the join left it: the
 * majority of events have no guestbook and must not cost a request for it.
 */

export interface MyMessagesState {
  readonly items: readonly GuestbookEntryDto[]
  /** A new message would be taken now. `false` until the first answer. */
  readonly accepting: boolean
  /** Published messages appear on the wall, which is what "published" means to their authors. */
  readonly onWall: boolean
  /** The server does not serve a guestbook to this guest: show none of it. */
  readonly unavailable: boolean
  /** A sentence in the language on screen, or `null`. */
  readonly error: string | null
  readonly refresh: () => void
  /** Rejects with the sentence to show, so the dialog that asked can say why it failed. */
  readonly remove: (entryId: string) => Promise<void>
}

type Answer =
  | {
      readonly kind: 'ok'
      readonly items: readonly GuestbookEntryDto[]
      readonly accepting: boolean
      readonly onWall: boolean
    }
  | { readonly kind: 'gone' }

const NO_ITEMS: readonly GuestbookEntryDto[] = []

export const useMyMessages = (slug: string, enabled: boolean): MyMessagesState => {
  const api = useApi()
  const t = useTranslations()
  const [actionFailure, setActionFailure] = useState<unknown>(null)

  const load = useCallback(
    async (signal: AbortSignal): Promise<Answer> => {
      if (!enabled) return { kind: 'gone' }
      const mine = await api.myGuestbook(slug, signal)
      return { kind: 'ok', items: mine.items, accepting: mine.accepting, onWall: mine.onWall }
    },
    [api, slug, enabled],
  )
  const { data, error, reload } = useLoader(load)

  const remove = useCallback(
    async (entryId: string) => {
      setActionFailure(null)
      try {
        await api.deleteMyGuestbookEntry(slug, entryId)
      } catch (cause) {
        setActionFailure(cause)
        throw cause
      }
      reload()
    },
    [api, slug, reload],
  )

  // The refusal's own sentence, composed at render so a change of language reads in the new one.
  const actionError = useMemo(
    () => (actionFailure === null ? null : sentenceFor(actionFailure, t)),
    [actionFailure, t],
  )

  const ok = data?.kind === 'ok' ? data : null
  return {
    items: ok?.items ?? NO_ITEMS,
    accepting: ok?.accepting ?? false,
    onWall: ok?.onWall ?? true,
    unavailable: !enabled || data?.kind === 'gone',
    error: actionError ?? error,
    refresh: reload,
    remove,
  }
}

/** The guestbook's own sentence for a code, else the app's. */
export const sentenceFor = (cause: unknown, t: ReturnType<typeof useTranslations>): string => {
  if (cause instanceof ApiError) {
    const own: Record<string, string | undefined> = t.guestbook.errors
    const code = cause.code
    if (code === 'guestbook.tooLong') {
      const max = cause.details['max']
      if (typeof max === 'number') return t.guestbook.tooLong(max)
    }
    if (Object.hasOwn(own, code)) return own[code] ?? messageForError(cause, t)
  }
  return messageForError(cause, t)
}
