import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { ADMIN_HOME, fromOf } from '../../lib/landing'
import { AuthForm } from './components/AuthForm'
import { useDeleteOwnAccount } from './hooks/useAuthActions'

/**
 * Surface: the host's laptop, reached from the account menu on a box that has accounts for other
 * people. A person erases their own account (GDPR art. 17).
 *
 * It says what goes, what stays and what is asked first, **before** the password is typed: the
 * act is not undone. The server decides whether it may happen (`account.holdsEvents` while the
 * person still owns an event, and the others), and the page only prints its sentence. Success
 * leaves for the sign-in page, since the session ended with the account.
 */
export function DeleteAccountPage() {
  const t = useTranslations()
  const { submit, submitting, error } = useDeleteOwnAccount()
  const toast = useToast()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')

  return (
    <AuthForm
      title={t.auth.deleteAccount}
      intro={t.auth.deleteAccountIntro}
      error={error}
      submitting={submitting}
      submitLabel={t.auth.deleteAccountSubmit}
      submitVariant="danger"
      onSubmit={() => {
        void submit({ password, code: code.trim() }).then((deleted) => {
          if (!deleted) return
          toast.show(t.auth.deleteAccountDone, { tone: 'success' })
          navigate('/login', { replace: true })
        })
      }}
      footer={
        <Button variant="ghost" onClick={() => navigate(fromOf(state) ?? ADMIN_HOME)}>
          {t.app.cancel}
        </Button>
      }
    >
      <Field label={t.auth.password} hint={t.auth.deleteAccountConfirm}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <Field label={t.auth.deleteAccountCode} hint={t.auth.deleteAccountCodeHint}>
        {(control) => (
          <TextInput
            {...control}
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        )}
      </Field>
    </AuthForm>
  )
}
