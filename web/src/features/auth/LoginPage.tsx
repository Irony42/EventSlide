import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAbout, useAboutHeard } from '../../app/useAbout'
import { useApi } from '../../app/useApi'
import { Field } from '../../design-system/components/Field'
import { Spinner } from '../../design-system/components/Spinner'
import { TextInput } from '../../design-system/components/TextInput'
import { fromOf } from '../../lib/landing'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useLoader } from '../../lib/useLoader'
import { AuthForm } from './components/AuthForm'
import { SecondFactorPage } from './SecondFactorPage'
import { useLogin } from './hooks/useAuthActions'
import { useResolveLanding } from './hooks/useLanding'

/**
 * Whether the history entry is the second step of a sign-in.
 *
 * The step lives in the entry's navigation state and not in the component, so that **Back**
 * returns to the password step (the entry before it) and a **reload** stays on the code step
 * (history state survives one). The half-finished sign-in itself is a cookie the server set and
 * holds for five minutes: a code step restored after it ran out is answered
 * `auth.secondFactorExpired`, and the page then says so on the password step. Read defensively:
 * history state is whatever the browser kept.
 */
const isCodeStep = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'step' in state && state.step === 'code'

/** The state of this entry, keeping where the person was heading and setting the step. */
const stateWithStep = (state: unknown, step: 'code' | null): { from?: string; step?: 'code' } => {
  const from = fromOf(state)
  return { ...(from === null ? {} : { from }), ...(step === null ? {} : { step }) }
}

/**
 * Somebody who opened the sign-in page with a session that is still good: sent where the rules
 * in `lib/landing.ts` send them, instead of a form for an account they are already in.
 */
function AlreadySignedIn({ canOperateSite }: { readonly canOperateSite: boolean }) {
  const t = useTranslations()
  const navigate = useNavigate()
  const { state } = useLocation()
  const resolveLanding = useResolveLanding()

  useEffect(() => {
    let live = true
    void resolveLanding({ state, canOperateSite }).then((path) => {
      if (live) navigate(path, { replace: true })
    })
    return () => {
      live = false
    }
  }, [resolveLanding, navigate, state, canOperateSite])

  return <Spinner size="lg" label={t.auth.alreadySignedIn} />
}

/**
 * Surface: the host's laptop, usually the day before the event.
 *
 * It asks `GET /api/auth/me` once on opening, and shows the form meanwhile: a session that is
 * still good sends the person on (H13), and nobody who is signed out waits for the answer.
 */
export function LoginPage() {
  const api = useApi()
  const probe = useCallback((signal: AbortSignal) => api.session(signal), [api])
  // A failed read leaves the form, which is what somebody who cannot be told otherwise needs.
  const { data } = useLoader(probe)

  if (data !== null && data.authenticated) {
    return <AlreadySignedIn canOperateSite={data.user.canOperateSite} />
  }
  return <SignInForm />
}

function SignInForm() {
  const t = useTranslations()
  const { submit, submitting, error } = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const resolveLanding = useResolveLanding()
  // Whether the box can mail a reset link. False until the server says so, which is the answer
  // that offers no link to a page that cannot work.
  const { features } = useAbout()
  const heard = useAboutHeard()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // The server said the password was right for an account with an authenticator: it has started
  // no session, and the page asks for the second step in place of the form.
  const awaitingCode = isCodeStep(location.state)
  // Why the password step is back, when the second step ended it.
  const [restartReason, setRestartReason] = useState<string | null>(null)
  // The sign-in went through and the landing is being read: the form stays, busy.
  const [arriving, setArriving] = useState(false)

  const goHome = () => {
    setArriving(true)
    void resolveLanding({ state: location.state }).then((path) => navigate(path, { replace: true }))
  }

  const handleSubmit = () => {
    setRestartReason(null)
    void submit({ email, password }).then((outcome) => {
      // Nothing is cleared on refusal. A host who mistyped one character should fix
      // that character, not retype an address and a password from their manager.
      if (outcome === 'signedIn') goHome()
      // A new history entry: Back is the password step again, with what was typed.
      if (outcome === 'secondFactor') {
        navigate(location.pathname, { state: stateWithStep(location.state, 'code') })
      }
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
          navigate(location.pathname, { replace: true, state: stateWithStep(location.state, null) })
        }}
      />
    )
  }

  return (
    <AuthForm
      title={t.auth.title}
      error={error ?? restartReason}
      submitting={submitting || arriving}
      submitLabel={t.auth.submit}
      onSubmit={handleSubmit}
      footer={
        features.forgotPassword ? (
          <Link to="/password/forgot">{t.auth.forgotLink}</Link>
        ) : heard ? (
          // A box with no mail relay has no reset link to send: say who resets it instead of
          // leaving a host who has forgotten the password with nowhere to look.
          <span>{t.auth.forgotNoMail}</span>
        ) : null
      }
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
