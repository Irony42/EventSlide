import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../../app/useSession'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { Spinner } from '../../design-system/components/Spinner'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime } from '../../lib/format'
import { useLocale } from '../../lib/i18n/useTranslations'
import { AuthActions, AuthPage } from './components/AuthPage'
import { AuthAlert, AuthForm } from './components/AuthForm'
import { useSignOut } from './hooks/useAuthActions'
import { useAcceptInvitation, useInvitationPreview } from './hooks/useInvitation'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'
import styles from './AcceptInvitationPage.module.css'
import type { AcceptOutcome } from './hooks/useInvitation'
import type { InvitationAcceptedDto, InvitationPreviewDto } from '../../lib/api/client'
import type { UiText } from '../../lib/i18n/translations'

/** What the link is for, in a sentence. The name is content: printed as written. */
const describe = (preview: InvitationPreviewDto, text: UiText): string => {
  if (preview.kind === 'event') return text.auth.invitationToModerate(preview.targetName)
  return preview.role === 'owner'
    ? text.auth.invitationToOwn(preview.targetName)
    : text.auth.invitationToJoin(preview.targetName)
}

/** Where a person who has just accepted should be: the event, or — for a client — the console. */
const destination = (accepted: InvitationAcceptedDto): string =>
  accepted.eventSlug === null ? '/admin' : `/admin/events/${encodeURIComponent(accepted.eventSlug)}`

/**
 * `/invite/:token`: the page every mailed or copied invitation opens (roadmap §10.3, G2-10).
 *
 * Surface: **the invitee**, a stranger holding a link, on whatever device opened it — a phone
 * as often as a laptop — who may not read French (the language picker is in the shell's
 * header) and has no account yet. The next screen they see is the host's console.
 *
 * What it will and will not say, all of it decided by what the link says and nothing else:
 *
 * - **One sentence for every dead link.** Unknown, malformed, spent, replaced, expired, for an
 *   event since archived: the server answers one `404` for all of them, and so does this page.
 *   Whichever it was, the remedy is the same — ask whoever sent it for another.
 * - **It never says whether the address has an account.** The preview does not carry it, so
 *   the page offers both ways in at once: choose a name and a password, or sign in with the
 *   account you already have. The person knows which one they are; a stranger holding the link
 *   must not be able to find out. The one place the server says it is `409
 *   invitation.signInRequired`, to somebody who sent a password and so is, by definition, the
 *   holder.
 * - **Signed in, it offers that account** — accepting needs no password then, and the session
 *   is the only thing that names the account — and a way to leave it, because the browser may
 *   belong to somebody else.
 *
 * The token is read from the address and goes to `/api/invitations/:token` and nowhere else:
 * it is not written to the title, to storage or to a log line (the server redacts the path,
 * `securityHeaders` sends no referrer, and `server.ts` serves this shell uncached and
 * un-indexable).
 */
export function AcceptInvitationPage() {
  const { token = '' } = useParams()
  const { locale, text: t } = useLocale()
  const navigate = useNavigate()
  const toast = useToast()
  const { view, reload } = useInvitationPreview(token)
  const { session, loading: sessionLoading, refresh } = useSession()
  const accepting = useAcceptInvitation(token)
  const leaving = useSignOut()

  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The link was good when the page read it and is not any more: spent by the person it was
  // for, or replaced by a newer one, in the minute this page has been open.
  const [diedUnderUs, setDiedUnderUs] = useState(false)

  if (view.kind === 'loading' || sessionLoading) {
    return (
      <AuthPage title={t.auth.invitationTitle}>
        <Spinner label={t.app.loading} />
      </AuthPage>
    )
  }

  if (view.kind === 'failed') {
    return (
      <AuthPage title={t.auth.invitationTitle} focusTitle>
        <AuthAlert>{view.message}</AuthAlert>
        <AuthActions>
          <Button type="button" variant="primary" onClick={reload}>
            {t.app.retry}
          </Button>
        </AuthActions>
      </AuthPage>
    )
  }

  if (view.kind === 'dead' || diedUnderUs) {
    return (
      <AuthPage title={t.auth.deadLinkTitle} intro={t.errors['invitation.notFound']} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.submit}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  const { preview } = view
  const expiry = formatDateTime(preview.expiresAt, locale)
  const intro =
    expiry === null
      ? describe(preview, t)
      : `${describe(preview, t)} ${t.auth.invitationExpires(expiry)}`
  const signedInAs = session !== null && session.authenticated ? session.user.email : null

  const settle = (outcome: AcceptOutcome) => {
    switch (outcome.kind) {
      case 'accepted':
        toast.show(t.auth.invitationAccepted, { tone: 'success' })
        navigate(destination(outcome.accepted), { replace: true })
        return
      case 'dead':
        setDiedUnderUs(true)
        return
      case 'signInRequired':
        setRefusal(t.auth.invitationSignInRequired)
        return
      case 'refused':
        setRefusal(outcome.message)
    }
  }

  const createAccount = () => {
    // The one rule checked here, as in `ChangePasswordPage`: two boxes disagreeing is a typing
    // accident the client can see, and nobody can reset a password they mistyped on a box
    // with no mail relay. Everything else — length, "too common", the name — is the server's.
    if (password !== confirmation) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setRefusal(null)
    void accepting.submit({ kind: 'newAccount', displayName, password }).then(settle)
  }

  const acceptAsSignedIn = () => {
    setRefusal(null)
    void accepting.submit({ kind: 'signedInAccount' }).then(settle)
  }

  const useAnotherAccount = () => {
    setRefusal(null)
    void leaving.signOut().then((result) => {
      // The page asks again who is signed in, and answers with the form for somebody who is not.
      if (result.ok) refresh()
      else setRefusal(result.message)
    })
  }

  if (signedInAs !== null) {
    return (
      <AuthForm
        // Keyed: leaving this account swaps the form for the other one, and the keyboard goes
        // to the new heading instead of to a button that has just been removed.
        key="signed-in"
        title={t.auth.invitationTitle}
        intro={intro}
        focusTitle
        error={refusal}
        submitting={accepting.submitting}
        submitLabel={t.auth.invitationAcceptAs}
        onSubmit={acceptAsSignedIn}
        footer={
          <Button type="button" variant="ghost" loading={leaving.busy} onClick={useAnotherAccount}>
            {t.auth.invitationUseAnother}
          </Button>
        }
      >
        <p>{t.auth.invitationSignedInAs(signedInAs)}</p>
      </AuthForm>
    )
  }

  return (
    <AuthForm
      key="new-account"
      title={t.auth.invitationTitle}
      intro={`${intro} ${t.auth.invitationChoose}`}
      focusTitle
      error={refusal}
      submitting={accepting.submitting}
      submitLabel={t.auth.invitationSubmit}
      onSubmit={createAccount}
      footer={
        <span className={styles['haveAccount']}>
          {t.auth.invitationHaveAccount}{' '}
          {/* Back to this very link afterwards: `LoginPage` reads `from` out of the navigation
              state (history, never the URL) and refuses anything that is not a path inside
              the app. */}
          <Link to="/login" state={{ from: `/invite/${encodeURIComponent(token)}` }}>
            {t.auth.submit}
          </Link>
        </span>
      }
    >
      <Field label={t.auth.invitationName} hint={t.auth.invitationNameHint}>
        {(control) => (
          <TextInput
            {...control}
            type="text"
            name="displayName"
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        )}
      </Field>

      <Field label={t.auth.password} hint={t.auth.newPasswordHint(PASSWORD_MIN_LENGTH)}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="password"
            // `new-password`: it is what makes a manager offer to generate and save one.
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>

      <Field
        label={t.auth.invitationConfirmPassword}
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
