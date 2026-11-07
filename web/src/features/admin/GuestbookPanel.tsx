import { Link } from 'react-router-dom'
import { Async } from '../../design-system/components/Async'
import { Badge, type BadgeTone } from '../../design-system/components/Badge'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { useGuestbookQueue } from './hooks/useGuestbookQueue'
import styles from './GuestbookPanel.module.css'
import type { GuestbookQueueItemDto } from '../../lib/api/dto'
import { copyToClipboard } from '../../lib/clipboard'

export interface GuestbookPanelProps {
  readonly slug: string
  /** Whether the event can still be moderated: an archived book is read, not decided on. */
  readonly canDecide: boolean
}

const TONES: Record<GuestbookQueueItemDto['status'], BadgeTone> = {
  pending: 'warning',
  published: 'success',
  rejected: 'danger',
  hidden: 'neutral',
}

/**
 * The host's guestbook (spec 01): every message, pending first, with the decisions the
 * server allows on each. The buttons are the server's `allowedDecisions`: this panel works
 * out no rule. The message id is shown and copyable, for an operator to be told which one.
 */
export function GuestbookPanel({ slug, canDecide }: GuestbookPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const toast = useToast()
  const queue = useGuestbookQueue(slug)

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

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })

  return (
    <Card as="h2" title={t.guestbookHost.title}>
      <Async state={queue} as="h3">
        {(data) =>
          canDecide ? (
            // The decisions live in the moderation console (spec 15): one surface that decides.
            <>
              <p className={styles['hint']}>{t.guestbookHost.hint}</p>
              {data.pendingCount > 0 ? (
                <Badge tone="warning">{t.guestbookHost.pending(data.pendingCount)}</Badge>
              ) : null}
              <p>
                {t.guestbookHost.onWall(
                  data.items.filter((item) => item.status === 'published').length,
                )}
              </p>
              <Link to={`/admin/events/${slug}/moderation?vue=messages`}>
                {t.guestbookHost.openMessages}
              </Link>
            </>
          ) : (
            <>
              <p className={styles['hint']}>{t.guestbookHost.hint}</p>
              {data.pendingCount > 0 ? (
                <Badge tone="warning">{t.guestbookHost.pending(data.pendingCount)}</Badge>
              ) : null}
              {data.items.length === 0 ? (
                <EmptyState as="h3" title={t.guestbookHost.empty} />
              ) : (
                <ul className={styles['list']}>
                  {data.items.map((item) => {
                    const author = item.authorName ?? t.guestbookHost.anonymous
                    return (
                      <li key={item.id} className={styles['row']}>
                        <p className={styles['text']}>{item.text}</p>
                        <p className={styles['meta']}>
                          <span>{author}</span>
                          <time dateTime={item.createdAt}>
                            {formatter.format(new Date(item.createdAt))}
                          </time>
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
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )
        }
      </Async>
    </Card>
  )
}
