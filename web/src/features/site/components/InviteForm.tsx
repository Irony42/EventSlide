import { useCallback, useState, type FormEvent } from 'react'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import type { OperatorInvitationDto } from '../../../lib/api/dto'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale, type Locale } from '../../../lib/i18n/locale'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { SelectField } from '../adminShared'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { InvitationOutcome } from './InvitationOutcome'
import styles from './InviteForm.module.css'

type Role = 'owner' | 'member'

const parseRole = (value: string): Role => (value === 'owner' ? 'owner' : 'member')

/**
 * Invites somebody into a client's account (`POST /api/site/clients/:clientId/invitations`).
 *
 * Surface: the operator's laptop. Into the **account**, never into an event: the operator guard's
 * R4 is that no act of the operator grants a role on an event, so this form has no event to pick.
 * What it can say about the invitation afterwards is the server's three answers
 * (`InvitationOutcome`): mailed, handed back as a link because no mail went out, or waiting for an
 * owner's agreement because the client already holds something (R1).
 */
export function InviteForm({ clientId }: { readonly clientId: string }) {
  const t = useTranslations()
  const api = useApi()
  const { locale } = useLocale()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [language, setLanguage] = useState<Locale>(locale)
  const [failure, setFailure] = useState<string | null>(null)
  const [sent, setSent] = useState<{
    readonly email: string
    readonly invitation: OperatorInvitationDto
  } | null>(null)
  const invite = useOperatorAction(
    useCallback(
      (
        id: string,
        input: { readonly email: string; readonly role: Role; readonly locale: Locale },
      ) => api.siteInviteToClient(id, input),
      [api],
    ),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    setSent(null)
    const address = email.trim()
    void invite
      .run('invite', clientId, { email: address, role, locale: language })
      .then((result) => {
        if (!result.ok) {
          setFailure(result.message)
          return
        }
        setSent({ email: address, invitation: result.value.invitation })
        setEmail('')
      })
  }

  return (
    <Card as="h2" title={t.site.inviteTitle} subtitle={t.site.inviteIntro}>
      <form className={styles['form']} onSubmit={submit}>
        <Field label={t.site.inviteEmail}>
          {(control) => (
            <TextInput
              {...control}
              type="email"
              name="email"
              autoComplete="off"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <SelectField
          label={t.site.inviteRole}
          value={role}
          options={[
            { value: 'member', label: t.site.roleMember },
            { value: 'owner', label: t.site.roleOwner },
          ]}
          onChange={(value) => setRole(parseRole(value))}
        />
        <SelectField
          label={t.site.inviteLanguage}
          value={language}
          options={SUPPORTED_LOCALES.map((tag) => ({ value: tag, label: LOCALE_NAMES[tag] }))}
          onChange={(value) => setLanguage(parseLocale(value) ?? locale)}
        />
        {failure === null ? null : <p role="alert">{failure}</p>}
        <div>
          <Button type="submit" variant="primary" loading={invite.busy}>
            {t.site.inviteSend}
          </Button>
        </div>
      </form>
      {sent === null ? null : (
        <InvitationOutcome
          invitation={sent.invitation}
          email={sent.email}
          onDismiss={() => setSent(null)}
        />
      )}
    </Card>
  )
}
