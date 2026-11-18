import { useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { Notice } from '../../../design-system/components/Notice'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { sentenceForCode } from '../hooks/useMyMessages'
import { formatClock } from '../voiceRecording'
import type { OutboxEntry } from '../../../lib/offline/outbox'
import type { StatusTone } from '../../../design-system/components/StatusIcon'
import type { GuestbookEntryDto } from '../../../lib/api/dto'
import styles from './MyMessages.module.css'

/**
 * What the guest wrote in the guestbook, and what became of it (spec 01), and their voice messages
 * (spec 25): the duration, the state, "Retirer ce message" when the server says so, and **no player**.
 * A message already sent is not played back to its author (they listened before sending, and a second
 * door to the recording is a second place for the secret of an event to leak).
 *
 * A voice that failed to be processed says so and offers "Réessayer", which removes the failed line and
 * opens the recorder again: the recording is no longer on the phone, the server answered 202. The
 * recordings still on the phone are listed first, apart: waiting for a network (kept, retried), or
 * blocked by the event (kept, with the reason, and "Enregistrer sur mon téléphone" or "Supprimer").
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
  /** The recordings this phone still holds (spec 25): not in the guestbook until they have left. */
  readonly local?: readonly OutboxEntry[]
  /** "Réessayer": opens the recorder again. The failed line has been removed by then. */
  readonly onRetryVoice?: () => void
  readonly onSaveLocal?: (entry: OutboxEntry) => void
  readonly onDiscardLocal?: (entryId: string) => void
}

export function MyMessages({
  items,
  onWall,
  error,
  onDelete,
  local = [],
  onRetryVoice,
  onSaveLocal,
  onDiscardLocal,
}: MyMessagesProps) {
  const t = useTranslations()
  const copy = t.guestbook
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState(false)

  const voiceCopy = t.guestbookVoice

  /** A voice is never "à l'écran": its states are the processing's and the decision's, in words. */
  const voiceLabelFor = (entry: GuestbookEntryDto): string => {
    const state = entry.voice?.state
    if (state === 'reserved' || state === 'queued' || state === 'running') {
      return voiceCopy.statusProcessing
    }
    switch (entry.status) {
      case 'published':
        return voiceCopy.statusPublished
      case 'rejected':
        return copy.statusRejected
      case 'pending':
      case 'hidden':
        return copy.statusPending
    }
  }

  const labelFor = (entry: GuestbookEntryDto): string => {
    if (entry.voice !== null) return voiceLabelFor(entry)
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
        {local.map((held) => (
          <li key={held.id} className={styles['entry']} data-testid="local-voice">
            <p className={styles['text']}>{voiceCopy.messageLabel(null)}</p>
            {held.caption === null ? null : (
              <p className={styles['text']} translate="no">
                {held.caption}
              </p>
            )}
            <div className={styles['row']}>
              <Badge tone="warning">
                {held.blockedCode == null ? voiceCopy.localWaiting : voiceCopy.localBlocked}
              </Badge>
            </div>
            {held.blockedCode == null ? (
              <p className={styles['hint']}>{voiceCopy.offlineHintKeepOpen}</p>
            ) : (
              <>
                <p className={styles['hint']}>
                  {sentenceForCode(held.blockedCode, t)} {voiceCopy.keptOnPhone}
                </p>
                <div className={styles['row']}>
                  <Button variant="secondary" size="sm" onClick={() => onSaveLocal?.(held)}>
                    {voiceCopy.saveToPhone}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDiscardLocal?.(held.id)}>
                    {voiceCopy.deleteLocal}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
        {items.map((entry) => (
          <li key={entry.id} className={styles['entry']}>
            {entry.voice === null ? (
              <p className={styles['text']}>{entry.text}</p>
            ) : (
              <>
                <p className={styles['text']}>
                  {voiceCopy.messageLabel(
                    entry.voice.durationMs === null ? null : formatClock(entry.voice.durationMs),
                  )}
                </p>
                {entry.voice.caption === null ? null : (
                  <p className={styles['text']} translate="no">
                    {entry.voice.caption}
                  </p>
                )}
                {entry.voice.state === 'failed' ? (
                  <p className={styles['hint']}>{voiceCopy.failed}</p>
                ) : null}
              </>
            )}
            <div className={styles['row']}>
              {entry.voice?.state === 'failed' ? null : (
                <Badge tone={TONES[entry.status]}>{labelFor(entry)}</Badge>
              )}
              {entry.voice?.state === 'failed' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // The failed line goes first (it never counts against the three), then the recorder reopens.
                    void onDelete(entry.id)
                      .then(() => onRetryVoice?.())
                      .catch(() => undefined)
                  }}
                >
                  {voiceCopy.retry}
                </Button>
              ) : null}
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
