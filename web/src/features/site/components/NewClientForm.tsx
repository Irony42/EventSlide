import { useCallback, useId, useState, type FormEvent } from 'react'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import type { Api } from '../../../lib/api/client'
import type { SiteClientDefaultsDto, SiteInvitationDto } from '../../../lib/api/dto'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale, type Locale } from '../../../lib/i18n/locale'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { SelectField } from '../../admin/components/SelectField'
import { LoadFailure, Pending } from '../../admin/components/AsyncState'
import { useLoader } from '../../admin/hooks/useLoader'
import {
  ceilingsPatch,
  fieldsFromCeilings,
  type CeilingField,
  type CeilingFields,
} from '../ceilingsForm'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { CeilingsFieldset } from './CeilingsFieldset'
import styles from './NewClientForm.module.css'

export interface ClientOpened {
  readonly clientId: string
  readonly name: string
  readonly email: string
  readonly invitation: SiteInvitationDto
}

export interface NewClientFormProps {
  readonly onOpened: (opened: ClientOpened) => void
  readonly onCancel: () => void
}

/**
 * Opens a client and invites its owner (`POST /api/site/clients`).
 *
 * Surface: the operator's laptop. The ceilings start as the box's own defaults
 * (`GET /api/site/client-defaults`: what a form left blank would provision), so what the form
 * shows is what is created, and only the ceilings the operator **changed** are sent: one it left
 * alone takes the default on the server, one it emptied lifts the default for this client. The
 * client is created with no member and no event; the owner chooses their own password from the
 * invitation, and the operator is never asked for one.
 */
export function NewClientForm({ onOpened, onCancel }: NewClientFormProps) {
  const t = useTranslations()
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.siteClientDefaults(signal), [api])
  const { data, loading, error, reload } = useLoader(load)

  return (
    <Card as="h2" title={t.site.newClientTitle} subtitle={t.site.newClientIntro}>
      {loading && data === null ? <Pending label={t.app.loading} /> : null}
      {!loading && error !== null && data === null ? (
        <LoadFailure message={error} onRetry={reload} as="h3" />
      ) : null}
      {data === null ? null : <Form defaults={data} onOpened={onOpened} onCancel={onCancel} />}
    </Card>
  )
}

function Form({
  defaults,
  onOpened,
  onCancel,
}: {
  readonly defaults: SiteClientDefaultsDto
  readonly onOpened: (opened: ClientOpened) => void
  readonly onCancel: () => void
}) {
  const t = useTranslations()
  const api = useApi()
  const { locale } = useLocale()
  const formId = useId()
  const base = fieldsFromCeilings(defaults.ceilings)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [language, setLanguage] = useState<Locale>(locale)
  const [fields, setFields] = useState<CeilingFields>(base)
  const [invalid, setInvalid] = useState<readonly CeilingField[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const open = useOperatorAction(
    useCallback(
      (input: Parameters<Api['siteProvisionClient']>[0]) => api.siteProvisionClient(input),
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
    void open
      .run('open', {
        clientName: name.trim(),
        ownerEmail: email.trim(),
        locale: language,
        ...(Object.keys(outcome.patch).length === 0 ? {} : { ceilings: outcome.patch }),
      })
      .then((result) => {
        if (!result.ok) {
          setFailure(result.message)
          return
        }
        onOpened({
          clientId: result.value.clientId,
          name: name.trim(),
          email: email.trim(),
          invitation: result.value.invitation,
        })
      })
  }

  return (
    <form id={formId} className={styles['form']} onSubmit={submit}>
      <Field label={t.site.clientName}>
        {(control) => (
          <TextInput
            {...control}
            name="clientName"
            autoComplete="off"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label={t.site.ownerEmail}>
        {(control) => (
          <TextInput
            {...control}
            type="email"
            name="ownerEmail"
            autoComplete="off"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>
      <SelectField
        label={t.site.inviteLanguage}
        value={language}
        options={SUPPORTED_LOCALES.map((tag) => ({ value: tag, label: LOCALE_NAMES[tag] }))}
        onChange={(value) => setLanguage(parseLocale(value) ?? locale)}
      />
      <p>{t.site.defaultsHint}</p>
      <CeilingsFieldset fields={fields} onChange={setFields} invalid={invalid} />
      {failure === null ? null : <p role="alert">{failure}</p>}
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" loading={open.busy}>
          {t.site.createClient}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={open.busy}>
          {t.app.cancel}
        </Button>
      </div>
    </form>
  )
}
