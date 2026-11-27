import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { SignupConfirmedDto } from '../../../lib/api/dto'
import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import { Spinner } from '../../../design-system/components/Spinner'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { AuthActions, AuthPage } from '../components/AuthPage'
import { useLangParam } from './hooks/useLangParam'
import { useSignupConfirmation } from './hooks/useSignup'

/**
 * `/signup/confirm/:token` (spec 31): confirm the address of a request.
 *
 * **The page acts on a button press and never on opening.** A mail client's antivirus opens the
 * links of a mail before the person reads it, so this page reads what the link is (spending
 * nothing), shows the masked address, and writes only when "Confirm" is pressed.
 *
 * What the press leads to is the server's word, `{ next }` and never a link (the invitation that
 * lets the person choose a password exists only in the mail): `mail` (the account is open),
 * `review` (the operator validates each account) or `held` (the box is open but its disk guard
 * held the request back; the account opens as soon as there is room).
 *
 * `?lang=` is honoured like on `/signup`: the mail's link carries the language of the request.
 */
export function SignupConfirmPage() {
  const { token = '' } = useParams()
  const t = useTranslations()
  useLangParam()
  const { preview, loading, loadError, unavailable, reload, confirm, confirming, error } =
    useSignupConfirmation(token)
  const [next, setNext] = useState<SignupConfirmedDto['next'] | null>(null)

  if (next !== null) {
    const done = {
      mail: { title: t.signup.mailTitle, body: t.signup.mailDone },
      review: { title: t.signup.reviewTitle, body: t.signup.reviewDone },
      held: { title: t.signup.pendingTitle, body: t.signup.pendingDone },
    }[next]
    return (
      <AuthPage title={done.title} intro={done.body} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.backToLogin}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  if (unavailable) {
    return (
      <AuthPage title={t.signup.confirmTitle} intro={t.signup.unavailable} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.backToLogin}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  if (loadError !== null) {
    return (
      <AuthPage title={t.signup.confirmTitle} focusTitle>
        <Notice tone="danger" role="alert" variant="boxed">
          {loadError}
        </Notice>
        <AuthActions>
          <Button type="button" variant="secondary" onClick={reload}>
            {t.app.retry}
          </Button>
        </AuthActions>
      </AuthPage>
    )
  }

  if (loading || preview === null) {
    return <Spinner size="lg" label={t.app.loading} />
  }

  if (preview.state === 'spent') {
    return (
      <AuthPage title={t.signup.spentTitle} intro={t.signup.spent} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.backToLogin}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  if (preview.state === 'expired') {
    return (
      <AuthPage title={t.signup.expiredTitle} intro={t.signup.expired} focusTitle>
        <AuthActions>
          <Link to="/signup">{t.signup.restart}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  return (
    <AuthPage title={t.signup.confirmTitle} intro={t.signup.confirmIntro(preview.maskedEmail)}>
      {error === null ? null : (
        <Notice tone="danger" role="alert" variant="boxed">
          {error}
        </Notice>
      )}
      <AuthActions>
        <Button
          type="button"
          loading={confirming}
          onClick={() => {
            void confirm().then((result) => {
              if (result !== null) setNext(result)
            })
          }}
        >
          {t.signup.confirmSubmit}
        </Button>
      </AuthActions>
    </AuthPage>
  )
}
