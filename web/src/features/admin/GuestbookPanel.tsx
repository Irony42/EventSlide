import { Link } from 'react-router-dom'
import { Async } from '../../design-system/components/Async'
import { Badge } from '../../design-system/components/Badge'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { GUESTBOOK_STATUS_TONE, useGuestbookRowFormat } from '../../app/guestbookRow'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useGuestbookQueue } from './hooks/useGuestbookQueue'
import styles from './GuestbookPanel.module.css'

export interface GuestbookPanelProps {
  readonly slug: string
  /** Whether the event can still be moderated: an archived book is read, not decided on. */
  readonly canDecide: boolean
}

/**
 * The host's guestbook (spec 01): every message, pending first, with the decisions the
 * server allows on each. The buttons are the server's `allowedDecisions`: this panel works
 * out no rule. The message id is shown and copyable, for an operator to be told which one.
 */
export function GuestbookPanel({ slug, canDecide }: GuestbookPanelProps) {
  const t = useTranslations()
  const { statusLabel, formatDate, copyId, anonymous } = useGuestbookRowFormat()
  const queue = useGuestbookQueue(slug)

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
                    const author = item.authorName ?? anonymous
                    return (
                      <li key={item.id} className={styles['row']}>
                        <p className={styles['text']}>{item.text}</p>
                        <p className={styles['meta']}>
                          <span>{author}</span>
                          <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                          <Badge tone={GUESTBOOK_STATUS_TONE[item.status]}>
                            {statusLabel(item.status)}
                          </Badge>
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
