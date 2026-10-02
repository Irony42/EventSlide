import { useState } from 'react'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AuthForm } from './components/AuthForm'
import { useSecondFactorLogin } from './hooks/useAuthActions'

export interface SecondFactorPageProps {
  /** The server started the session. The page that rendered this decides where to go. */
  readonly onSignedIn: () => void
  /**
   * The half-finished sign-in is over (five minutes, five wrong codes, or the account changed
   * underneath it). Handed the sentence the server's code picks, so the password step can say
   * why it is back — or `null` when the person chose to start again.
   */
  readonly onRestart: (reason: string | null) => void
}

/**
 * The second step of a sign-in (roadmap §10.1, G2-13 / P3-15): the six digits from the
 * authenticator app, or — behind a toggle, because it is the exception — one of the
 * recovery codes.
 *
 * Surface: the operator's laptop. Rendered by `LoginPage` in place of the password form
 * and not as a route of its own: the half-finished sign-in lives in a cookie the server
 * set, and a URL for this step would be a page that opens, asks for a code, and can never
 * have a password behind it.
 *
 * Nothing here decides whether a code is right. A wrong one keeps what the person typed
 * (they fix a digit, they do not retype six), and the server's code picks the sentence.
 */
export function SecondFactorPage({ onSignedIn, onRestart }: SecondFactorPageProps) {
  const t = useTranslations()
  const { submit, submitting, error } = useSecondFactorLogin()
  const [mode, setMode] = useState<'code' | 'recovery'>('code')
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    const proof = mode === 'code' ? { code: value.trim() } : { recoveryCode: value.trim() }
    void submit(proof).then((outcome) => {
      if (outcome.kind === 'signedIn') onSignedIn()
      // The sentence is the one the server's code picked; the password step shows it.
      if (outcome.kind === 'expired') onRestart(outcome.reason)
    })
  }

  const switchMode = () => {
    setMode((current) => (current === 'code' ? 'recovery' : 'code'))
    setValue('')
  }

  return (
    <AuthForm
      title={t.auth.secondFactorTitle}
      intro={mode === 'code' ? t.auth.secondFactorIntro : t.auth.secondFactorRecoveryIntro}
      error={error}
      submitting={submitting}
      submitLabel={t.auth.secondFactorSubmit}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button variant="ghost" onClick={switchMode}>
            {mode === 'code' ? t.auth.secondFactorRecoveryToggle : t.auth.secondFactorAppToggle}
          </Button>
          <Button variant="ghost" onClick={() => onRestart(null)}>
            {t.auth.secondFactorRestart}
          </Button>
        </>
      }
    >
      <Field label={mode === 'code' ? t.auth.secondFactorCode : t.auth.recoveryCode}>
        {(control) => (
          <TextInput
            {...control}
            name={mode === 'code' ? 'code' : 'recoveryCode'}
            // `one-time-code` is what makes a phone offer the code from a message, and
            // a password manager fill it; a recovery code is not one and must not be.
            autoComplete={mode === 'code' ? 'one-time-code' : 'off'}
            inputMode={mode === 'code' ? 'numeric' : 'text'}
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
    </AuthForm>
  )
}
