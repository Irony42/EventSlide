import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../../app/useSession'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { ADMIN_HOME, forcedByGate, fromOf } from '../../lib/landing'
import { AuthForm } from './components/AuthForm'
import { useChangePassword } from './hooks/useAuthActions'
import { useResolveLanding } from './hooks/useLanding'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'

/**
 * Surface: the host's laptop. Reached on purpose, or forced by
 * `MustChangePasswordGate` for an account whose password was set for it and not by it.
 *
 * **Both ways bring the person back to where they were going** (`from` in the navigation state:
 * the gate writes it, and so does the account menu), not to the dashboard. They differ in two
 * things: a forced change says why, in a sentence above the form, and has no way out (every other
 * address of the console leads back here); a voluntary one has an "Annuler" that returns to
 * where the person was.
 */
export function ChangePasswordPage() {
  const t = useTranslations()
  const { submit, submitting, error, clearError } = useChangePassword()
  const toast = useToast()
  const navigate = useNavigate()
  const { state } = useLocation()
  const { session } = useSession()
  const resolveLanding = useResolveLanding()
  // The session says so, and so does the gate that sent the person here (see `forcedByGate`):
  // choosing the password makes the session forget itself, the gate shows its wait, and this page
  // is mounted again before it leaves, when the session no longer says the change was forced.
  const mustChange = session !== null && session.authenticated && session.user.mustChangePassword
  const forced = mustChange || forcedByGate(state)

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
      // The server's sentence answered the attempt before this one, about a password that
      // may no longer be in the box. The newest finding replaces it rather than sitting
      // beside it.
      clearError()
      setMismatch(true)
      return
    }
    setMismatch(false)

    void submit({ currentPassword: current, newPassword: next }).then((accepted) => {
      if (!accepted) return
      toast.show(t.auth.passwordSaved, { tone: 'success' })
      void resolveLanding({ state }).then((path) => navigate(path, { replace: true }))
    })
  }

  return (
    <AuthForm
      title={t.auth.changePassword}
      intro={
        forced
          ? `${t.auth.changePasswordForced} ${t.auth.changePasswordIntro}`
          : t.auth.changePasswordIntro
      }
      error={error}
      submitting={submitting}
      submitLabel={t.app.save}
      onSubmit={handleSubmit}
      footer={
        forced ? null : (
          <Button variant="ghost" onClick={() => navigate(fromOf(state) ?? ADMIN_HOME)}>
            {t.app.cancel}
          </Button>
        )
      }
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
