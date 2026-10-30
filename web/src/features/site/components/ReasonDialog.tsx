import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import { useTranslations } from '../../../lib/i18n/useTranslations'

export interface ReasonDialogProps {
  readonly open: boolean
  readonly title: string
  /** What the act will do, in words, before it is sent. */
  readonly description: string
  readonly confirmLabel: string
  readonly busy: boolean
  /** The server's own sentence when it refused the act, shown where the operator is looking. */
  readonly failure: string | null
  readonly onConfirm: (reason: string) => void
  readonly onCancel: () => void
}

/**
 * The confirmation of every takedown act: what it will do, a **mandatory reason**, and a button
 * that is not offered until a reason has been written. The reason is one line, which the server
 * bounds and judges (`audit.reasonInvalid`): this only refuses to send nothing.
 *
 * Surface: the operator's laptop. It names no photograph and no event beyond what the card behind
 * it already shows (an id), and it opens with the safe choice focused, as every confirmation does.
 * A person who is then asked to confirm themselves (the step-up) is asked by the console's own
 * prompt, on top of this one.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  failure,
  onConfirm,
  onCancel,
}: ReasonDialogProps) {
  const t = useTranslations()
  const [reason, setReason] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const written = reason.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (written !== '' && !busy) onConfirm(written)
  }

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {t.app.cancel}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={written === ''}
            onClick={() => onConfirm(written)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label={t.site.takedownReason} hint={t.site.takedownReasonHint}>
          {(control) => (
            <TextInput
              {...control}
              name="reason"
              autoComplete="off"
              spellCheck={false}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        {failure === null ? null : <p role="alert">{failure}</p>}
      </form>
    </Dialog>
  )
}
