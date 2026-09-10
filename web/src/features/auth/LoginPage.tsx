import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { fr } from '../../lib/i18n/fr'
import { AuthForm } from './components/AuthForm'
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
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    ? from
    : ADMIN_HOME
}

/** Surface: the host's laptop, usually the day before the event. */
export function LoginPage() {
  const { submit, submitting, error } = useLogin()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = () => {
    void submit({ email, password }).then((accepted) => {
      // Nothing is cleared on refusal. A host who mistyped one character should fix
      // that character, not retype an address and a password from their manager.
      if (accepted) navigate(redirectTarget(location.state), { replace: true })
    })
  }

  return (
    <AuthForm
      title={fr.auth.title}
      error={error}
      submitting={submitting}
      submitLabel={fr.auth.submit}
      onSubmit={handleSubmit}
    >
      <Field label={fr.auth.email}>
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

      <Field label={fr.auth.password}>
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
