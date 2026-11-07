import { useEffect, useRef } from 'react'
import { LoadFailure } from '../../../design-system/components/Async'
import { Badge, type BadgeTone } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { EmptyState } from '../../../design-system/components/EmptyState'
import { Spinner } from '../../../design-system/components/Spinner'
import { useToast } from '../../../design-system/components/useToast'
import { messageForError } from '../../../lib/i18n/translations'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { decisionWording, inDisplayOrder } from './decisionWording'
import styles from './GuestbookMessages.module.css'
import type { GuestbookFilter, GuestbookModeration } from '../hooks/useGuestbookModeration'
import type { QueueSelection } from '../hooks/useQueueSelection'
import type { GuestbookQueueItemDto, ModerationDecision } from '../../../lib/api/dto'
import { copyToClipboard } from '../../../lib/clipboard'

const TONES: Record<GuestbookQueueItemDto['status'], BadgeTone> = {
  pending: 'warning',
  published: 'success',
  rejected: 'danger',
  hidden: 'neutral',
}

export interface GuestbookMessagesProps {
  readonly guestbook: GuestbookModeration
  readonly selection: QueueSelection
  /** False when the event is archived: the messages are read, not decided on. */
  readonly canDecide: boolean
  readonly onDecide: (entryId: string, decision: ModerationDecision) => void
}

/**
 * The messages tab of the console (spec 15): a vertical list of whole messages, with the
 * decisions the server allows on each. The text is guest content: rendered as text, never
 * cut, never translated, never turned into a link.
 */
export function GuestbookMessages({
  guestbook,
  selection,
  canDecide,
  onDecide,
}: GuestbookMessagesProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const toast = useToast()
  const emptyRef = useRef<HTMLDivElement>(null)
  const hadItems = useRef(false)
  const { items, filter } = guestbook

  // A list emptied by the host's own last decision puts the keyboard on the empty state,
  // not on a page that has just lost the element it stood on.
  useEffect(() => {
    if (items.length > 0) {
      hadItems.current = true
    } else if (hadItems.current) {
      hadItems.current = false
      emptyRef.current?.focus()
    }
  }, [items.length])

  const FILTERS: readonly { readonly value: GuestbookFilter; readonly label: string }[] = [
    { value: 'pending', label: t.moderation.filterPending },
    { value: 'all', label: t.moderation.filterAll },
    { value: 'published', label: t.moderation.filterPublished },
    { value: 'rejected', label: t.moderation.filterRejected },
    { value: 'hidden', label: t.moderation.filterHidden },
  ]

  const statusLabel = (status: GuestbookQueueItemDto['status']): string =>
    ({
      pending: t.guestbookHost.statusPending,
      published: t.guestbookHost.statusPublished,
      rejected: t.guestbookHost.statusRejected,
      hidden: t.guestbookHost.statusHidden,
    })[status]

  const copyId = (id: string) => {
    void copyToClipboard(id).then((copied) =>
      copied
        ? toast.show(t.guestbookHost.idCopied, { tone: 'success' })
        : toast.show(t.guestbookHost.copyFailed, { tone: 'danger' }),
    )
  }

  const formatter = new Intl.DateTimeFormat(locale, { timeStyle: 'short', dateStyle: 'short' })
  const unfiltered = filter === 'pending' || filter === 'all'

  let body
  if (guestbook.loading && items.length === 0) {
    body = (
      <div aria-busy="true">
        <Spinner size="lg" label={t.app.loading} />
      </div>
    )
  } else if (guestbook.error !== null && items.length === 0) {
    body = (
      <LoadFailure
        as="h2"
        title={t.moderation.messagesLoadFailed}
        message={messageForError(guestbook.error, t)}
        onRetry={guestbook.refresh}
      />
    )
  } else if (items.length === 0) {
    body = (
      <div ref={emptyRef} tabIndex={-1} className={styles['emptyFocus']}>
        <EmptyState
          as="h2"
          title={unfiltered ? t.moderation.messagesEmpty : t.moderation.emptyFiltered}
          description={unfiltered ? t.moderation.messagesEmptyHint : t.moderation.emptyFilteredHint}
        />
      </div>
    )
  } else {
    body = (
      <ul className={styles['list']} aria-label={t.moderation.messagesListLabel}>
        {items.map((item) => {
          const author = item.authorName ?? t.guestbookHost.anonymous
          const active = selection.focusedId === item.id
          return (
            <li
              key={item.id}
              ref={(element) => selection.registerCard(item.id, element)}
              tabIndex={-1}
              className={styles['card']}
              data-status={item.status}
              data-active={active ? 'true' : undefined}
              aria-current={active ? 'true' : undefined}
              onFocus={() => selection.focus(item.id, { moveDomFocus: false })}
            >
              {/* Guest content: kept in the language it was written in. */}
              <p className={styles['text']} translate="no">
                {item.text}
              </p>
              <p className={styles['meta']}>
                <span translate={item.authorName === null ? undefined : 'no'}>{author}</span>
                <time dateTime={item.createdAt}>{formatter.format(new Date(item.createdAt))}</time>
                <Badge tone={TONES[item.status]}>{statusLabel(item.status)}</Badge>
                <button
                  type="button"
                  className={styles['id']}
                  onClick={() => copyId(item.id)}
                  aria-label={`${t.guestbookHost.copyId}: ${item.id}`}
                >
                  {item.id}
                </button>
              </p>
              {canDecide ? (
                <div className={styles['actions']}>
                  {inDisplayOrder(item.allowedDecisions).map((decision) => {
                    const wording = decisionWording(decision, item.status, author, t)
                    return (
                      <Button
                        key={decision}
                        variant={decision === 'publish' ? 'primary' : 'secondary'}
                        aria-label={wording.ariaLabel}
                        onClick={() => onDecide(item.id, decision)}
                      >
                        {wording.label}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className={styles['panel']}>
      <div className={styles['filters']} role="group" aria-label={t.moderation.filterLabel}>
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={option.value === filter ? 'primary' : 'ghost'}
            aria-pressed={option.value === filter}
            onClick={() => guestbook.setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {guestbook.error !== null && items.length > 0 ? (
        <p role="alert">{messageForError(guestbook.error, t)}</p>
      ) : null}
      {body}
    </div>
  )
}
