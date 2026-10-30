import { useRef } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { useTranslations } from '../../lib/i18n/useTranslations'

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  /** What the action will actually do. "Cette action est définitive", concretely. */
  readonly description?: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  /**
   * `danger` by default, because the dialog exists for destructive acts. `primary` is for the
   * light confirmation of something that is a commitment rather than a loss (opening the doors
   * to guests), where a red button would say the wrong thing.
   */
  readonly confirmVariant?: 'danger' | 'primary'
  /** The confirm request is in flight: the button keeps its label and shows a spinner. */
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * The destructive confirmation, in place of `window.confirm`.
 *
 * 1.0 asked `window.confirm('Supprimer définitivement photo-123.jpg ?')`: a filename
 * means nothing to a host, the wording could not be changed, the dialog could not be
 * tested, and some embedded browsers suppress it entirely — so on those the delete
 * happened with no prompt at all.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useTranslations()
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open={open}
      title={title}
      {...(description === undefined ? {} : { description })}
      onClose={onCancel}
      // Focus lands on the safe choice. A destructive dialog that opens with the
      // destructive button focused turns a reflexive Enter into a deleted photo.
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {cancelLabel ?? t.app.cancel}
          </Button>
          <Button variant={confirmVariant} loading={busy} onClick={onConfirm}>
            {confirmLabel ?? t.app.confirm}
          </Button>
        </>
      }
    />
  )
}
