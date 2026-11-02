import { Async } from '../../design-system/components/Async'
import { Badge, type BadgeTone } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { decisionWording, inDisplayOrder } from '../moderation/components/decisionWording'
import { useDecideGuestbookEntry, useGuestbookQueue } from './hooks/useGuestbookQueue'
import styles from './GuestbookPanel.module.css'
import type { GuestbookQueueItemDto, ModerationDecision } from '../../lib/api/dto'

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
  const { reload } = queue
  const decide = useDecideGuestbookEntry()

  const statusLabel = (status: GuestbookQueueItemDto['status']): string =>
    ({
      pending: t.guestbookHost.statusPending,
      published: t.guestbookHost.statusPublished,
      rejected: t.guestbookHost.statusRejected,
      hidden: t.guestbookHost.statusHidden,
    })[status]

  const copyId = (id: string) => {
    const failed = () => toast.show(t.guestbookHost.copyFailed, { tone: 'danger' })
    // Absent on a plain-HTTP LAN address, which is not a secure context.
    if (navigator.clipboard === undefined) {
      failed()
      return
    }
    void navigator.clipboard
      .writeText(id)
      .then(() => toast.show(t.guestbookHost.idCopied, { tone: 'success' }), failed)
  }

  const run = (item: GuestbookQueueItemDto, decision: ModerationDecision) => {
    void decide.run(item.id, slug, item.id, decision).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(t.guestbookHost.decided, { tone: 'success' })
      reload()
    })
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })

  return (
    <Card as="h2" title={t.guestbookHost.title}>
      <Async state={queue} as="h3">
        {(data) => (
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
                      {canDecide ? (
                        <div className={styles['actions']}>
                          {inDisplayOrder(item.allowedDecisions).map((decision) => {
                            const wording = decisionWording(decision, item.status, author, t)
                            return (
                              <Button
                                key={decision}
                                variant={decision === 'publish' ? 'primary' : 'secondary'}
                                disabled={decide.busy}
                                aria-label={wording.ariaLabel}
                                onClick={() => run(item, decision)}
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
            )}
          </>
        )}
      </Async>
    </Card>
  )
}
