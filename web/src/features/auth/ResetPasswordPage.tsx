import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useLocale } from '../../lib/i18n/useTranslations'
import { AuthActions, AuthPage } from './components/AuthPage'
import { AuthForm } from './components/AuthForm'
import { useConfirmPasswordReset } from './hooks/usePasswordReset'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'

/**
 * `/password/reset/:token` (roadmap G2-08 / G2-10): choose a new password with the mailed link.
 *
 * Surface: **whoever asked for the link**, on whatever device opened the mail.
 *
 * There is no preview for a reset link (nothing on the server answers "is this one good?"
 * without spending it), so the form is shown at once and the verdict comes with the password.
 * What each verdict looks like:
 *
 * - **Chosen**: the account's sessions are all closed and none is started, so the page says so
 *   and offers the sign-in. It does not sign anybody in: the link may have been read by
 *   somebody who was not at the keyboard.
 * - **Dead** (never issued, used, replaced, expired, an account since switched off): one
 *   sentence, `auth.invalidToken`, and the way to ask again.
 * - **A password the policy refuses**: said where the person is looking, with everything they
 *   typed still there — the server does not spend the link on a refusal.
 *
 * The token is read from the address and sent in the **body** of the one request this page
 * makes. It is not written anywhere else.
 */
export function ResetPasswordPage() {
  const { token = '' } = useParams()
  const { text: t } = useLocale()
  const { submit, submitting, error } = useConfirmPasswordReset(token)

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [outcome, setOutcome] = useState<'asking' | 'done' | 'dead'>('asking')

  const handleSubmit = () => {
    // The only rule checked here (see `ChangePasswordPage`): two boxes disagreeing is a typing
    // accident, and on a box with no relay a mistyped password is a locked account.
    if (password !== confirmation) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    void submit(password).then((result) => {
      if (result.kind === 'done') setOutcome('done')
      if (result.kind === 'dead') setOutcome('dead')
    })
  }

  if (outcome === 'done') {
    return (
      <AuthPage title={t.auth.resetDoneTitle} intro={t.auth.resetDone} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.submit}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  if (outcome === 'dead') {
    return (
      <AuthPage title={t.auth.deadLinkTitle} intro={t.errors['auth.invalidToken']} focusTitle>
        <AuthActions>
          <Link to="/password/forgot">{t.auth.resetAskAgain}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  return (
    <AuthForm
      title={t.auth.resetTitle}
      intro={t.auth.resetIntro}
      error={error}
      submitting={submitting}
      submitLabel={t.auth.resetSubmit}
      onSubmit={handleSubmit}
    >
      <Field label={t.auth.newPassword} hint={t.auth.newPasswordHint(PASSWORD_MIN_LENGTH)}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>

      <Field
        label={t.auth.confirmPassword}
        {...(mismatch ? { error: t.errors['password.mismatch'] } : {})}
      >
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              setMismatch(false)
            }}
          />
        )}
      </Field>
    </AuthForm>
  )
}
