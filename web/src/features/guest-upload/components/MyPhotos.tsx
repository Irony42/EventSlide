import { useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../../design-system/components/EmptyState'
import { IconButton } from '../../../design-system/components/IconButton'
import { Spinner } from '../../../design-system/components/Spinner'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { fr } from '../../../lib/i18n/fr'
import type { StatusTone } from '../../../design-system/components/StatusIcon'
import type { GuestPhotoDto, PhotoStatus } from '../../../lib/api/dto'
import styles from './MyPhotos.module.css'

/**
 * What the guest sent, and what became of it.
 *
 * Every status is shown in words, including a refusal. Silence after an upload is
 * indistinguishable from a failure, and a guest who cannot tell sends the photo again
 * — which is how 1.0's wall ended up with the same photo four times.
 *
 * The delete control appears only when the DTO says `canDelete`. That flag is computed
 * server-side from the grace window, the status and the event's setting; recomputing
 * any part of it here is what made 1.0 offer a button that answered 403.
 */

const LABELS: Record<PhotoStatus, string> = {
  pending: fr.upload.statusPending,
  published: fr.upload.statusPublished,
  rejected: fr.upload.statusRejected,
  hidden: fr.upload.statusHidden,
}

const TONES: Record<PhotoStatus, StatusTone> = {
  // Waiting is the normal case, not a warning: nothing is wrong and there is nothing
  // for the guest to do about it.
  pending: 'neutral',
  published: 'success',
  rejected: 'danger',
  hidden: 'neutral',
}

export interface MyPhotosProps {
  readonly photos: readonly GuestPhotoDto[]
  readonly loading: boolean
  /** A French sentence, ready to render. `null` when nothing has failed. */
  readonly error: string | null
  readonly onRetry: () => void
  readonly onDelete: (photoId: string) => Promise<void>
}

export function MyPhotos({ photos, loading, error, onRetry, onDelete }: MyPhotosProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (pendingDelete === null) return
    setDeleting(true)
    try {
      await onDelete(pendingDelete)
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  return (
    <Card as="h2" title={fr.upload.mine} className={styles['mine']}>
      {error === null ? null : (
        <div className={styles['failure']}>
          <p className={styles['error']} role="alert">
            <StatusIcon tone="danger" />
            {error}
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {fr.app.retry}
          </Button>
        </div>
      )}

      {loading ? (
        <div className={styles['loading']}>
          <Spinner label={fr.app.loading} />
        </div>
      ) : null}

      {!loading && error === null && photos.length === 0 ? (
        <EmptyState as="h3" title={fr.upload.mineEmpty} />
      ) : null}

      {photos.length === 0 ? null : (
        <ul className={styles['list']}>
          {photos.map((photo, index) => (
            <li key={photo.id} className={styles['photo']}>
              {/* The caption is the photo's own description; without one the fallback
                  says what it is rather than reading a filename aloud. */}
              <img
                className={styles['thumb']}
                src={photo.thumbUrl}
                alt={photo.caption ?? fr.upload.mineAlt}
              />
              <div className={styles['detail']}>
                <Badge tone={TONES[photo.status]}>{LABELS[photo.status]}</Badge>
                {photo.caption === null ? null : (
                  <p className={styles['caption']}>{photo.caption}</p>
                )}
              </div>
              {photo.canDelete ? (
                <IconButton
                  aria-label={fr.upload.deleteOwnNumbered(index + 1)}
                  icon={<CloseIcon />}
                  variant="danger"
                  onClick={() => setPendingDelete(photo.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Never `window.confirm`: it cannot be styled, cannot be tested, and is
          suppressed outright in some in-app browsers — including the ones a guest
          reaches this page through after scanning a QR code from a message. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={fr.upload.deleteOwnConfirm}
        confirmLabel={fr.upload.deleteOwn}
        busy={deleting}
        onConfirm={() => {
          void confirmDelete()
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  )
}
