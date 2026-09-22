import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AuthForm } from './components/AuthForm'
import { useChangePassword } from './hooks/useAuthActions'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'

/**
 * Surface: the host's laptop. Reached on purpose, or forced by
 * `MustChangePasswordGate` for a moderator who has never chosen a password.
 */
export function ChangePasswordPage() {
  const t = useTranslations()
  const { submit, submitting, error } = useChangePassword()
  const toast = useToast()
  const navigate = useNavigate()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const handleSubmit = () => {
    // The only rule checked here. Two boxes disagreeing is a typing accident the
    // client can see; everything else — length, reuse, "too common" — is the server's
    // judgement, and duplicating it would mean two rulebooks with the weaker one
    // deciding.
    if (next !== confirmation) {
      setMismatch(true)
      return
    }
    setMismatch(false)

    void submit({ currentPassword: current, newPassword: next }).then((accepted) => {
      if (!accepted) return
      toast.show(t.auth.passwordSaved, { tone: 'success' })
      navigate('/admin', { replace: true })
    })
  }

  return (
    <AuthForm
      title={t.auth.changePassword}
      intro={t.auth.changePasswordIntro}
      error={error}
      submitting={submitting}
      submitLabel={t.app.save}
      onSubmit={handleSubmit}
    >
      <Field label={t.auth.currentPassword}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        )}
      </Field>

      <Field label={t.auth.newPassword} hint={t.auth.newPasswordHint(PASSWORD_MIN_LENGTH)}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="newPassword"
            // `new-password` is what stops a manager from offering the old one back,
            // and what makes it offer to save the new one.
            autoComplete="new-password"
            required
            value={next}
            onChange={(event) => setNext(event.target.value)}
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
              // Clears as soon as they start fixing it: an error that stays put while
              // the value changes reads as a screen that has stopped responding.
              setMismatch(false)
            }}
          />
        )}
      </Field>
    </AuthForm>
  )
}
