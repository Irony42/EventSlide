import { useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { Notice } from '../../../design-system/components/Notice'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { StatusTone } from '../../../design-system/components/StatusIcon'
import type { GuestbookEntryDto } from '../../../lib/api/dto'
import styles from './MyMessages.module.css'

/**
 * What the guest wrote in the guestbook, and what became of it (spec 01).
 *
 * Every status is said in words, a refusal included, for the reason `MyPhotos` gives. "Retirer ce
 * message" appears **only when the server says `canDelete`**: the phone never recomputes the
 * rule, so it never offers a button the server would answer with a 403.
 *
 * The text is a text node and nothing else.
 */

const TONES: Record<GuestbookEntryDto['status'], StatusTone> = {
  pending: 'neutral',
  published: 'success',
  rejected: 'danger',
  hidden: 'neutral',
}

export interface MyMessagesProps {
  readonly items: readonly GuestbookEntryDto[]
  /** Published messages are shown on the wall: otherwise "published" says it is not. */
  readonly onWall: boolean
  /** A sentence in the language on screen, or `null`. */
  readonly error: string | null
  readonly onDelete: (entryId: string) => Promise<void>
}

export function MyMessages({ items, onWall, error, onDelete }: MyMessagesProps) {
  const t = useTranslations()
  const copy = t.guestbook
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState(false)

  const labelFor = (entry: GuestbookEntryDto): string => {
    switch (entry.status) {
      case 'pending':
        return copy.statusPending
      case 'published':
        return onWall ? copy.statusPublished : copy.statusPublishedNotOnWall
      case 'rejected':
        return copy.statusRejected
      case 'hidden':
        return copy.statusHidden
    }
  }

  const confirm = async () => {
    if (pending === null) return
    setBusy(true)
    try {
      await onDelete(pending)
      setRemoved(true)
    } catch {
      // The refusal's sentence is `error`, shown below: the dialog only closes.
      setRemoved(false)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <Card as="h2" title={copy.mine} className={styles['mine']}>
      {error === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {error}
        </Notice>
      )}
      {/* Mounted only once there is something to say: a live region announces on insertion. */}
      {removed && error === null ? (
        <Notice tone="success" variant="boxed" role="status">
          {copy.removed}
        </Notice>
      ) : null}
      <ul className={styles['list']}>
        {items.map((entry) => (
          <li key={entry.id} className={styles['entry']}>
            <p className={styles['text']}>{entry.text}</p>
            <div className={styles['row']}>
              <Badge tone={TONES[entry.status]}>{labelFor(entry)}</Badge>
              {entry.canDelete ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRemoved(false)
                    setPending(entry.id)
                  }}
                >
                  {copy.remove}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        title={copy.removeTitle}
        confirmLabel={copy.removeConfirm}
        cancelLabel={copy.removeCancel}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => {
          if (!busy) setPending(null)
        }}
      />
    </Card>
  )
}
