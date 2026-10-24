import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { siteLinkOnly } from '../../app/aboutAnswer'
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
import { TermsAgreement } from './components/TermsAgreement'
import { useSignOut } from './hooks/useAuthActions'
import { useAcceptInvitation, useInvitationPreview } from './hooks/useInvitation'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'
import styles from './AcceptInvitationPage.module.css'
import type { AcceptOutcome } from './hooks/useInvitation'
import type { InvitationAcceptedDto, InvitationPreviewDto } from '../../lib/api/client'
import { messageForError, type UiText } from '../../lib/i18n/translations'

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
 * - **On a box that asks for its terms** (the preview carries `terms`, roadmap G2-20), both ways
 *   in end with a required, unticked box and a link to read them. Left empty it is a message
 *   under the box and nothing is sent, and the server's own `terms.notAccepted` is worded the
 *   same way for a page whose preview was read before the box changed its mind. It is a form
 *   error and never a dead link: the box is only shown for a link that was read as alive.
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
  // Which required boxes were left empty when the form was sent. See `createAccount`.
  const [blank, setBlank] = useState({ name: false, password: false })
  const [refusal, setRefusal] = useState<string | null>(null)
  // The terms box (G2-20): ticked, and whether the form was sent while it was not.
  const [agreed, setAgreed] = useState(false)
  const [termsMissing, setTermsMissing] = useState(false)
  const termsBox = useRef<HTMLInputElement>(null)
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
        <AuthAlert>{messageForError(view.cause, t)}</AuthAlert>
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

  // What accepting agrees to, on a box that says so. The link is only ever one the server's own
  // rule would have accepted (`siteLinkOnly`), whatever a rewritten response carried.
  const terms = preview.terms
  const termsField =
    terms === undefined ? null : (
      <TermsAgreement
        version={terms.version}
        href={siteLinkOnly(terms.url)}
        checked={agreed}
        boxRef={termsBox}
        onChange={(checked) => {
          setAgreed(checked)
          setTermsMissing(false)
        }}
        {...(termsMissing ? { error: t.errors['terms.notAccepted'] } : {})}
      />
    )

  /** The tick to send: nothing on a box that asks for none, and nothing sent while it is empty. */
  const tick = (): { readonly acceptTerms?: boolean } | null => {
    if (terms === undefined) return {}
    if (agreed) return { acceptTerms: true }
    setTermsMissing(true)
    termsBox.current?.focus()
    return null
  }

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
        setRefusal(t.errors['invitation.signInRequired'])
        return
      case 'refused':
        setRefusal(outcome.message)
        // The session this page was drawn for is gone: it said "accept as <this account>" and
        // the server has no account to attach. Ask who is signed in again, and the page answers
        // with the form for somebody who is not — under the sentence the server gave.
        if (outcome.code === 'invitation.credentialsRequired') refresh()
    }
  }

  const createAccount = () => {
    // Two things are checked here, and neither is a rule about names or passwords. Two boxes
    // disagreeing is a typing accident the client can see (as in `ChangePasswordPage`), and
    // nobody can reset a password they mistyped on a box with no mail relay. A box left empty is
    // not sent: the server's schema refuses an empty string before its own rules see it, with
    // the generic `request.invalid`, which says nothing about which box. Everything else —
    // length, "too common", how long a name may be — is the server's.
    const missing = { name: displayName.trim() === '', password: password === '' }
    setBlank(missing)
    if (missing.name || missing.password) return
    if (password !== confirmation) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    // The terms last, so the first thing wrong with the form is the first thing said.
    const ticked = tick()
    if (ticked === null) return
    setRefusal(null)
    void accepting.submit({ kind: 'newAccount', displayName, password, ...ticked }).then(settle)
  }

  const acceptAsSignedIn = () => {
    const ticked = tick()
    if (ticked === null) return
    setRefusal(null)
    void accepting.submit({ kind: 'signedInAccount', ...ticked }).then(settle)
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
        {termsField}
      </AuthForm>
    )
  }

  return (
    <AuthForm
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
      <Field
        label={t.auth.invitationName}
        hint={t.auth.invitationNameHint}
        {...(blank.name ? { error: t.errors['accountName.empty'] } : {})}
      >
        {(control) => (
          <TextInput
            {...control}
            type="text"
            name="displayName"
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value)
              setBlank((current) => ({ ...current, name: false }))
            }}
          />
        )}
      </Field>

      <Field
        label={t.auth.password}
        hint={t.auth.newPasswordHint(PASSWORD_MIN_LENGTH)}
        {...(blank.password ? { error: t.errors['password.tooShort'] } : {})}
      >
        {(control) => (
          <TextInput
            {...control}
            type="password"
            name="password"
            // `new-password`: it is what makes a manager offer to generate and save one.
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setBlank((current) => ({ ...current, password: false }))
            }}
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

      {termsField}
    </AuthForm>
  )
}
