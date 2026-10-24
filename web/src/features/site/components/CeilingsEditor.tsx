import { useCallback, useState, type FormEvent } from 'react'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import { useToast } from '../../../design-system/components/useToast'
import type { SiteCeilingsPatch, SiteClientDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  ceilingsPatch,
  fieldsFromCeilings,
  isEmptyPatch,
  type CeilingField,
  type CeilingFields,
} from '../ceilingsForm'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { CeilingsFieldset } from './CeilingsFieldset'
import styles from './CeilingsEditor.module.css'

export interface CeilingsEditorProps {
  readonly client: SiteClientDto
  readonly onChanged: () => void
}

/**
 * Changes a client's ceilings (`PUT /api/site/clients/:clientId/ceilings`), **with a reason**.
 *
 * Surface: the operator's laptop. The reason is the one free text the operator writes into the
 * log, and the form says what it is for: one line, no address, read by the operator and not by the
 * client, a non-financial motive. It is mandatory on the wire, so the box is `required` (the
 * browser refuses an empty one before anything is sent), and whatever is typed is judged by the
 * server, whose sentence is what the operator reads when it refuses: the form restates no rule
 * about what a reason may say.
 *
 * Only the boxes that changed are sent (a patch: a key left out keeps the client's value, an empty
 * box removes the ceiling), so saving a reason beside an untouched figure cannot rewrite it.
 * Nothing is sent at all when nothing changed: a reason for no change is a log line about nothing.
 *
 * The parent keys this component by the client's ceilings, so a saved change reads back into the
 * form instead of leaving it showing what was typed.
 */
export function CeilingsEditor({ client, onChanged }: CeilingsEditorProps) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const base = fieldsFromCeilings(client.ceilings)
  const [fields, setFields] = useState<CeilingFields>(base)
  const [reason, setReason] = useState('')
  const [invalid, setInvalid] = useState<readonly CeilingField[]>([])
  const [unchanged, setUnchanged] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const save = useOperatorAction(
    useCallback(
      (id: string, patch: SiteCeilingsPatch, why: string) => api.siteSetCeilings(id, patch, why),
      [api],
    ),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    setUnchanged(false)
    const outcome = ceilingsPatch(fields, base, () => new Date())
    if (!outcome.ok) {
      setInvalid(outcome.invalid)
      return
    }
    setInvalid([])
    if (isEmptyPatch(outcome.patch)) {
      setUnchanged(true)
      return
    }
    void save.run('ceilings', client.id, outcome.patch, reason.trim()).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      toast.show(t.site.ceilingsSaved, { tone: 'success' })
      setReason('')
      onChanged()
    })
  }

  return (
    <Card as="h2" title={t.site.ceilingsTitle}>
      <form className={styles['form']} onSubmit={submit}>
        <CeilingsFieldset fields={fields} onChange={setFields} invalid={invalid} renewable />
        <Field label={t.site.ceilingsReason} hint={t.site.ceilingsReasonHint}>
          {(control) => (
            <TextInput
              {...control}
              name="reason"
              autoComplete="off"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        {unchanged ? <p role="status">{t.site.ceilingsUnchanged}</p> : null}
        {failure === null ? null : <p role="alert">{failure}</p>}
        <div>
          <Button type="submit" variant="primary" loading={save.busy}>
            {t.site.ceilingsSave}
          </Button>
        </div>
      </form>
    </Card>
  )
}
