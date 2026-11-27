import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useApi } from '../../../lib/useApi'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Notice } from '../../../design-system/components/Notice'
import type { Api } from '../../../lib/api/client'
import type { ClientDefaultsDto, ProvisionedClientDto, SiteSignupDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useLoader } from '../../../lib/useLoader'
import {
  ceilingsPatch,
  fieldsFromCeilings,
  type CeilingField,
  type CeilingFields,
} from '../ceilingsForm'
import { CeilingsFieldset } from '../components/CeilingsFieldset'
import { useOperatorAction } from '../hooks/useOperatorAction'
import styles from './SignupsPage.module.css'

export interface ApproveSignupDialogProps {
  readonly signup: SiteSignupDto
  readonly onApproved: (signup: SiteSignupDto, result: ProvisionedClientDto) => void
  readonly onCancel: () => void
  /** The write was refused: the list behind the dialog may be out of date. */
  readonly onFailed: () => void
}

/**
 * Approves one held request: the ceilings, prefilled with the box's defaults the way the form that
 * opens a client gets them, and « Valider et envoyer l'invitation » (`POST
 * /api/site/signups/:id/approve`, behind the console's step-up).
 *
 * Surface: the operator's laptop. Only the ceilings the operator **changed** are sent, like the
 * client form: one it left alone takes the default on the server, one it emptied lifts it. When
 * the address already has an account, the dialog says the person will have to sign in to accept.
 */
export function ApproveSignupDialog({
  signup,
  onApproved,
  onCancel,
  onFailed,
}: ApproveSignupDialogProps) {
  const t = useTranslations()
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.siteClientDefaults(signal), [api])
  const { data, loading, error, reload } = useLoader(load)

  return (
    <Dialog
      open
      title={t.siteSignups.approveTitle(signup.clientName)}
      description={t.siteSignups.approveIntro}
      onClose={onCancel}
    >
      {loading && data === null ? <Pending label={t.app.loading} /> : null}
      {!loading && error !== null && data === null ? (
        <LoadFailure message={error} onRetry={reload} as="h3" />
      ) : null}
      {data === null ? null : (
        <Form
          signup={signup}
          defaults={data}
          onApproved={onApproved}
          onCancel={onCancel}
          onFailed={onFailed}
        />
      )}
    </Dialog>
  )
}

function Form({
  signup,
  defaults,
  onApproved,
  onCancel,
  onFailed,
}: {
  readonly signup: SiteSignupDto
  readonly defaults: ClientDefaultsDto
  readonly onApproved: (signup: SiteSignupDto, result: ProvisionedClientDto) => void
  readonly onCancel: () => void
  readonly onFailed: () => void
}) {
  const t = useTranslations()
  const api = useApi()
  // Stable: the form's changes are measured against it, and it must not move under them.
  const base = useMemo(() => fieldsFromCeilings(defaults.ceilings), [defaults])
  const [fields, setFields] = useState<CeilingFields>(base)
  const [invalid, setInvalid] = useState<readonly CeilingField[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const approve = useOperatorAction(
    useCallback(
      (id: string, input: Parameters<Api['siteApproveSignup']>[1]) =>
        api.siteApproveSignup(id, input),
      [api],
    ),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const outcome = ceilingsPatch(fields, base, () => new Date())
    if (!outcome.ok) {
      setInvalid(outcome.invalid)
      return
    }
    setInvalid([])
    setFailure(null)
    void approve
      .run(
        signup.id,
        signup.id,
        Object.keys(outcome.patch).length === 0 ? {} : { ceilings: outcome.patch },
      )
      .then((result) => {
        if (!result.ok) {
          setFailure(result.message)
          if (result.message !== null) onFailed()
          return
        }
        onApproved(signup, result.value)
      })
  }

  return (
    <form className={styles['form']} onSubmit={submit}>
      {signup.existingAccount ? (
        <Notice tone="accent" variant="boxed">
          {t.siteSignups.existingAccountNotice}
        </Notice>
      ) : null}
      <CeilingsFieldset fields={fields} onChange={setFields} invalid={invalid} />
      {failure === null ? null : <p role="alert">{failure}</p>}
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" loading={approve.busy}>
          {t.siteSignups.approveConfirm}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={approve.busy}>
          {t.app.cancel}
        </Button>
      </div>
    </form>
  )
}
