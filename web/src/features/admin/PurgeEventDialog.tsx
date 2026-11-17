import { useRef, useState } from 'react'
import { Button } from '../../design-system/components/Button'
import { Dialog } from '../../design-system/components/Dialog'
import { Field } from '../../design-system/components/Field'
import { Notice } from '../../design-system/components/Notice'
import { TextInput } from '../../design-system/components/TextInput'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { wordMatches } from './albumDeletion'
import styles from './PurgeEventDialog.module.css'

export interface PurgeEventDialogProps {
  readonly open: boolean
  readonly slug: string
  readonly eventName: string
  readonly busy: boolean
  /**
   * `word`: the album has no complete archive that was sent (spec 22), so the host types the word
   * of the language on screen instead of the address. The default is the address, as before.
   */
  readonly confirmWith?: 'address' | 'word'
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
  confirmWith = 'address',
  onConfirm,
  onCancel,
}: PurgeEventDialogProps) {
  const t = useTranslations()
  const word = t.exportPurge.confirmWord
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The word is compared without regard to case or spaces; the address, exactly as it always was.
  const matches = confirmWith === 'word' ? wordMatches(typed, word) : typed.trim() === slug

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
      title={t.admin.purgeTitle}
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
            {t.app.cancel}
          </Button>
          <Button variant="danger" loading={busy} disabled={!matches} onClick={confirm}>
            {t.admin.purge}
          </Button>
        </>
      }
    >
      <div className={styles['body']}>
        <Notice tone="danger" variant="boxed">
          {t.admin.purgeWarning}
        </Notice>
        <Field
          label={confirmWith === 'word' ? t.exportPurge.wordLabel : t.admin.purgeConfirmLabel}
          hint={
            confirmWith === 'word' ? t.exportPurge.wordPrompt(word) : t.admin.purgeConfirmHint(slug)
          }
        >
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
