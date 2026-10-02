import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AuthForm } from './components/AuthForm'
import { SecondFactorPage } from './SecondFactorPage'
import { useLogin } from './hooks/useAuthActions'

const ADMIN_HOME = '/admin'

/**
 * Where to go once the host is in.
 *
 * `RequireAuth` puts the page they were heading for in the navigation state, so a
 * bookmarked moderation console does not dump them on the dashboard to click through
 * again. The value is read defensively because history state is whatever the browser
 * kept — it survives a reload and can come from an older build.
 */
const redirectTarget = (state: unknown): string => {
  if (typeof state !== 'object' || state === null || !('from' in state)) return ADMIN_HOME
  const from = state.from
  // Only an in-app path: an absolute URL from history state would be an open redirect.
  //
  // The second character decides that as much as the first. A browser reads a backslash
  // in a URL as a slash, so `/\ailleurs.example` *is* `//ailleurs.example` by the time
  // it is resolved, and a check that only refused `//` let it through by one character.
  // That is the same bypass react-router closed in 7.18.0 (GHSA-wrjc-x8rr-h8h6); it is
  // refused here as well rather than left to the router, because this value comes out of
  // history state and is read before the router ever sees it.
  const inAppPath = /^\/(?![/\\])/
  return typeof from === 'string' && inAppPath.test(from) ? from : ADMIN_HOME
}

/** Surface: the host's laptop, usually the day before the event. */
export function LoginPage() {
  const t = useTranslations()
  const { submit, submitting, error } = useLogin()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // The password was right for an account with an authenticator: the server has started no
  // session, and the page asks for the second step in place of the form.
  const [awaitingCode, setAwaitingCode] = useState(false)
  // Why the password step is back, when the second step ended it.
  const [restartReason, setRestartReason] = useState<string | null>(null)

  const goHome = () => navigate(redirectTarget(location.state), { replace: true })

  const handleSubmit = () => {
    setRestartReason(null)
    void submit({ email, password }).then((outcome) => {
      // Nothing is cleared on refusal. A host who mistyped one character should fix
      // that character, not retype an address and a password from their manager.
      if (outcome === 'signedIn') goHome()
      if (outcome === 'secondFactor') setAwaitingCode(true)
    })
  }

  if (awaitingCode) {
    return (
      <SecondFactorPage
        onSignedIn={goHome}
        onRestart={(reason) => {
          // The password is typed again: a half-finished sign-in holds nothing worth keeping,
          // and an address the server just said is over should not be silently resubmitted.
          setPassword('')
          setRestartReason(reason)
          setAwaitingCode(false)
        }}
      />
    )
  }

  return (
    <AuthForm
      title={t.auth.title}
      error={error ?? restartReason}
      submitting={submitting}
      submitLabel={t.auth.submit}
      onSubmit={handleSubmit}
    >
      <Field label={t.auth.email}>
        {(control) => (
          <TextInput
            {...control}
            type="email"
            name="email"
            // `username`, not `email`: it is what a password manager matches a saved
            // login against, and a host at a venue is not going to remember it.
            autoComplete="username"
            inputMode="email"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>

      <Field label={t.auth.password}>
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
    </AuthForm>
  )
}
