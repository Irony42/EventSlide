import { useRef, useState } from 'react'
import { Button } from '../../design-system/components/Button'
import { Dialog } from '../../design-system/components/Dialog'
import { Field } from '../../design-system/components/Field'
import { StatusIcon } from '../../design-system/components/StatusIcon'
import { TextInput } from '../../design-system/components/TextInput'
import { fr } from '../../lib/i18n/fr'
import styles from './PurgeEventDialog.module.css'

export interface PurgeEventDialogProps {
  readonly open: boolean
  readonly slug: string
  readonly eventName: string
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Deleting an entire album.
 *
 * A single OK button is not enough friction for an action that removes every photo
 * every guest sent, and the media before the rows. Typing the address makes the host
 * name the thing they are destroying — which is also the check that catches the real
 * accident: two events open in two tabs, and the purge fired on the wrong one.
 */
export function PurgeEventDialog({
  open,
  slug,
  eventName,
  busy,
  onConfirm,
  onCancel,
}: PurgeEventDialogProps) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = typed.trim() === slug

  /**
   * Every way out of this dialog empties the box.
   *
   * Cleared on the way out rather than on the way in: a confirmation that arrives
   * pre-satisfied — because the host typed the address, cancelled, and came back — is
   * not a confirmation. Doing it in the handlers keeps it out of an effect, which
   * would cost a second render on every open.
   */
  const cancel = () => {
    setTyped('')
    onCancel()
  }

  const confirm = () => {
    setTyped('')
    onConfirm()
  }

  return (
    <Dialog
      open={open}
      title={fr.admin.purgeTitle}
      // The event's own name, so the dialog says out loud which album is at stake.
      description={eventName}
      onClose={cancel}
      // Not dismissible by a stray click beside the panel — but Escape still works,
      // because trapping someone in a modal is worse than a decision they can retake.
      dismissible={false}
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            {fr.app.cancel}
          </Button>
          <Button variant="danger" loading={busy} disabled={!matches} onClick={confirm}>
            {fr.admin.purge}
          </Button>
        </>
      }
    >
      <div className={styles['body']}>
        <p className={styles['warning']}>
          <span className={styles['warningGlyph']}>
            <StatusIcon tone="danger" />
          </span>
          {fr.admin.purgeWarning}
        </p>
        <Field label={fr.admin.purgeConfirmLabel} hint={fr.admin.purgeConfirmHint(slug)}>
          {(control) => (
            <TextInput
              {...control}
              ref={inputRef}
              name="purgeConfirmation"
              // A password manager has no business filling this in, and neither has the
              // browser's own history of the last event a host deleted.
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
