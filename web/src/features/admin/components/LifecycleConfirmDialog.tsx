import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { confirmationFor } from '../eventLifecycle'
import type { TransitionRequest } from '../hooks/useLifecycleTransition'

export interface LifecycleConfirmDialogProps {
  /** The move waiting for an answer; `null` while the dialog is closed. */
  readonly request: TransitionRequest | null
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * The question before a move that cannot be taken back (revue UX 30/10, HOT-4 and NAV-1).
 *
 * Archiving says what stops and what stays, and its button is red like every destructive
 * confirmation. Opening an event to guests is a commitment and not a loss, so it is asked
 * lighter: the same dialog, a button in the primary colour, and one sentence on why there is
 * no way back to the draft. The event's name is a person's words and goes in verbatim.
 */
export function LifecycleConfirmDialog({
  request,
  busy,
  onConfirm,
  onCancel,
}: LifecycleConfirmDialogProps) {
  const t = useTranslations()
  const kind = request === null ? null : confirmationFor(request.from, request.to)
  const name = request?.eventName ?? ''

  return kind === 'open' ? (
    <ConfirmDialog
      open
      title={t.admin.openTitle(name)}
      description={t.admin.openHint}
      confirmLabel={t.admin.goLive}
      confirmVariant="primary"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  ) : (
    <ConfirmDialog
      open={kind === 'archive'}
      title={t.admin.archiveTitle(name)}
      // A draft never ran: it has no screen to stop and no album to keep, so the sentence that
      // says both would be wrong about it.
      description={request?.from === 'draft' ? t.admin.archiveDraftHint : t.admin.archiveHint}
      confirmLabel={t.admin.archiveEvent}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
