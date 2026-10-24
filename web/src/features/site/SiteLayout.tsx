import { useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useApi } from '../../app/useApi'
import { useSession } from '../../app/useSession'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { errorMessage } from './adminShared'
import { StepUpProvider } from './StepUpProvider'
import styles from './SiteLayout.module.css'

/**
 * Where a session stands with the second factor, as the console needs it.
 *
 * `required` is the box asking for one of this account (`REQUIRE_OPERATOR_2FA`); `verified` is
 * whether **this session** passed it. Until it has, every route under `/api/site` answers `403
 * auth.secondFactorRequired`, and a console that rendered its screens anyway would show an
 * operator a row of refusals. An account with no authenticator is sent to enrol; one that has an
 * authenticator and a session that skipped it (the box began requiring one after it signed in) is
 * asked to sign in again, where the code is asked.
 */
function SecondFactorGate({ children }: { readonly children: ReactNode }) {
  const t = useTranslations()
  const api = useApi()
  const navigate = useNavigate()
  const { session } = useSession()
  const [failure, setFailure] = useState<string | null>(null)

  if (session === null || !session.authenticated) return null
  const { required, verified, enrolled } = session.user.secondFactor
  if (!required || verified) return <>{children}</>

  return (
    <EmptyState
      as="h1"
      title={t.site.factorTitle}
      description={enrolled ? t.site.factorSignIn : t.site.factorEnrol}
      action={
        enrolled ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                setFailure(null)
                api.logout().then(
                  () => navigate('/login', { replace: true }),
                  (cause: unknown) => setFailure(errorMessage(cause, t)),
                )
              }}
            >
              {t.site.factorSignOut}
            </Button>
            {failure === null ? null : <p role="alert">{failure}</p>}
          </>
        ) : (
          <Link className={styles['link']} to="/admin/security">
            {t.site.factorEnrolLink}
          </Link>
        )
      }
    />
  )
}

/**
 * The operator's console: its sections, its confirmation prompt and the gate on the second factor.
 *
 * Surface: **the operator's laptop**, on `/admin/site/**`, the maintainer's own "super admin"
 * space. It is the one screen in the product built around what its reader must *not* see: the
 * introduction says so in as many words, and nothing under it is able to show a photograph, an
 * event's name, a slug or a join code, because none of them is in any answer it reads.
 *
 * The three sections are plain links (not tabs): each is an address of its own, so the browser's
 * back button and a copied link behave, and a client's page belongs to "Clients" without needing a
 * fourth entry.
 */
export function SiteLayout() {
  const t = useTranslations()
  const { pathname } = useLocation()

  const clients = pathname === '/admin/site' || pathname.startsWith('/admin/site/clients/')
  const sections: readonly {
    readonly to: string
    readonly label: string
    readonly current: boolean
  }[] = [
    { to: '/admin/site', label: t.site.navClients, current: clients },
    {
      to: '/admin/site/accounts',
      label: t.site.navAccounts,
      current: pathname === '/admin/site/accounts',
    },
    { to: '/admin/site/audit', label: t.site.navAudit, current: pathname === '/admin/site/audit' },
  ]

  return (
    <StepUpProvider>
      <div className={styles['console']}>
        <header className={styles['header']}>
          <p className={styles['brand']}>{t.site.consoleTitle}</p>
          <p className={styles['intro']}>{t.site.consoleIntro}</p>
          <nav aria-label={t.site.navLabel} className={styles['nav']}>
            {sections.map((section) => (
              <Link
                key={section.to}
                to={section.to}
                className={styles['navLink']}
                {...(section.current ? { 'aria-current': 'page' as const } : {})}
              >
                {section.label}
              </Link>
            ))}
          </nav>
        </header>
        <SecondFactorGate>
          <Outlet />
        </SecondFactorGate>
      </div>
    </StepUpProvider>
  )
}
