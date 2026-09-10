import { useRef } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { fr } from '../../lib/i18n/fr'

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  /** What the action will actually do. "Cette action est définitive", concretely. */
  readonly description?: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
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
  confirmLabel = fr.app.confirm,
  cancelLabel = fr.app.cancel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
            {cancelLabel}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}
