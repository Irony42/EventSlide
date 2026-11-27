import { Link, useLocation } from 'react-router-dom'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { AuthActions, AuthPage } from '../components/AuthPage'

/** Whether the form was answered `busy`, from the entry's navigation state (which a reload keeps). */
const isBusy = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'status' in state && state.status === 'busy'

/**
 * `/signup/sent` (spec 31): "check your inbox", **the same screen whatever the server did** with
 * the address. The one variant, `busy`, is the box's own day (a global state that says nothing
 * about an address), and a visit to this address with no state is the ordinary one.
 */
export function SignupSentPage() {
  const t = useTranslations()
  const busy = isBusy(useLocation().state)

  return (
    <AuthPage
      title={busy ? t.signup.busyTitle : t.signup.sentTitle}
      intro={busy ? t.signup.busy : t.signup.sent}
      focusTitle
    >
      <AuthActions>
        <Link to="/login">{t.auth.backToLogin}</Link>
      </AuthActions>
    </AuthPage>
  )
}
