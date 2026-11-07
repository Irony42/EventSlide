import { useCallback, useMemo } from 'react'
import type { BadgeTone } from '../design-system/components/Badge'
import { useToast } from '../design-system/components/useToast'
import type { GuestbookQueueItemDto } from '../lib/api/dto'
import { copyToClipboard } from '../lib/clipboard'
import type { UiText } from '../lib/i18n/translations'
import { useLocale, useTranslations } from '../lib/i18n/useTranslations'

/**
 * What a guestbook message row needs beyond its text, shared by the host's guestbook panel
 * (`admin/`) and the moderation console's messages tab (`moderation/`), which used to carry a
 * copy each: the badge tone and word of a status, the date format, and the copyable id.
 */
type Status = GuestbookQueueItemDto['status']

export const GUESTBOOK_STATUS_TONE: Readonly<Record<Status, BadgeTone>> = {
  pending: 'warning',
  published: 'success',
  rejected: 'danger',
  hidden: 'neutral',
}

export const guestbookStatusLabel = (status: Status, text: UiText): string =>
  ({
    pending: text.guestbookHost.statusPending,
    published: text.guestbookHost.statusPublished,
    rejected: text.guestbookHost.statusRejected,
    hidden: text.guestbookHost.statusHidden,
  })[status]

/** A message's date and time, short, in the reader's language. */
export const guestbookDateFormat = (locale: string): ((iso: string) => string) => {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })
  return (iso) => formatter.format(new Date(iso))
}

export interface GuestbookRowFormat {
  readonly statusLabel: (status: Status) => string
  readonly formatDate: (iso: string) => string
  /** Copies a message id and says whether it worked. */
  readonly copyId: (id: string) => void
  /** The name shown for a message with no author. */
  readonly anonymous: string
}

export const useGuestbookRowFormat = (): GuestbookRowFormat => {
  const text = useTranslations()
  const { locale } = useLocale()
  const toast = useToast()
  const formatDate = useMemo(() => guestbookDateFormat(locale), [locale])
  const statusLabel = useCallback((status: Status) => guestbookStatusLabel(status, text), [text])
  const copyId = useCallback(
    (id: string) => {
      void copyToClipboard(id).then((copied) =>
        copied
          ? toast.show(text.guestbookHost.idCopied, { tone: 'success' })
          : toast.show(text.guestbookHost.copyFailed, { tone: 'danger' }),
      )
    },
    [text, toast],
  )
  return { statusLabel, formatDate, copyId, anonymous: text.guestbookHost.anonymous }
}
