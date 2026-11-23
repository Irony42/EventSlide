import { useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { Textarea } from '../../../design-system/components/Textarea'
import type { HouseholdImportResponseDto } from '../../../lib/api/dto'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './HouseholdsPage.module.css'

export interface HouseholdImportProps {
  /** Sends the pasted text; a refusal is thrown and shown as its sentence. */
  readonly onSubmit: (text: string) => Promise<HouseholdImportResponseDto>
  readonly onClose: () => void
}

/**
 * "Coller une liste" (spec 30, lot 3): one household per line, `Nom ; places`. The server reads it
 * tolerantly and **says what it left out**: the dialog stays open after the paste to show how many
 * households were added and, line by line, why the others were not, so a host never has to guess.
 */
export function HouseholdImport({ onSubmit, onClose }: HouseholdImportProps) {
  const t = useTranslations()
  const text = t.rsvp.households
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [result, setResult] = useState<HouseholdImportResponseDto | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      setResult(await onSubmit(pasted))
    } catch (cause) {
      setProblem(messageForError(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={text.importTitle}
      {...(result === null ? { description: text.importHint } : {})}
      onClose={onClose}
      footer={
        result === null ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t.app.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="household-import"
              disabled={pasted.trim() === ''}
              loading={busy}
            >
              {busy ? text.importSending : text.importSubmit}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {text.importClose}
          </Button>
        )
      }
    >
      {result === null ? (
        <form id="household-import" className={styles['form']} onSubmit={(e) => void submit(e)}>
          <Field label={text.importLabel}>
            {(control) => (
              <Textarea
                {...control}
                rows={8}
                value={pasted}
                placeholder={text.importPlaceholder}
                onChange={(event) => setPasted(event.target.value)}
              />
            )}
          </Field>
          {problem === null ? null : (
            <Notice tone="danger" variant="boxed" role="alert">
              {problem}
            </Notice>
          )}
        </form>
      ) : (
        <div className={styles['form']}>
          <Notice
            tone={result.households.length === 0 ? 'warning' : 'success'}
            variant="boxed"
            role="status"
          >
            {result.households.length === 0
              ? text.importNothing
              : text.importDone(result.households.length)}
          </Notice>
          {result.skipped.length === 0 ? null : (
            <section>
              <h3 className={styles['skippedTitle']}>{text.importSkippedTitle}</h3>
              <ul className={styles['skipped']}>
                {result.skipped.map((line) => (
                  <li key={line.line}>
                    {text.importSkippedLine(line.line, text.importReasons[line.reason])}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  )
}
