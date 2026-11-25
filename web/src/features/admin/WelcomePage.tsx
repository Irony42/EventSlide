import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { HostEventsLink } from '../../app/HostEventsLink'
import { isEventLogoUrl } from '../../lib/brand'
import { canManageEvent, isMutable } from '../../lib/eventLifecycle'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { LogoField } from './components/LogoField'
import { useEvent } from './hooks/useEventData'
import styles from './WelcomePage.module.css'

/**
 * The screen a new event opens on (surface: the host's laptop, the moment after « Créer
 * l'évènement »).
 *
 * It asks for one thing, the logo, because the guest's page, the room's screen, the invitation and
 * the printed QR all carry it and it used to be asked only deep in the settings. It is skippable
 * and says where the logo can be found later. It sends nothing of its own: `LogoField` is the same
 * control, and the same endpoint, as on the Apparence page.
 *
 * Owner only, on an event that can still change: anyone else who reaches this address is sent to
 * the event's page, which is where the host goes next either way.
 */
export function WelcomePage() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const home = `/admin/events/${encodeURIComponent(slug)}`

  if (event === null) {
    if (loading) return <Pending label={t.admin.eventLoading} />
    return (
      <div className={styles['page']}>
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }

  // A presentation of the rule, not the rule: the logo routes themselves are the owner's and
  // refuse an archived event. The screen would only offer a control whose every press fails.
  if (!canManageEvent(event.role) || !isMutable(event.status)) {
    return <Navigate to={home} replace />
  }

  const copy = t.admin.welcome
  const hasLogo = isEventLogoUrl(event.settings.brand?.logoUrl)

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{copy.title(event.name)}</h1>
      <p className={styles['lead']}>{copy.lead}</p>

      <LogoField
        slug={slug}
        logoUrl={event.settings.brand?.logoUrl}
        disabled={false}
        onChanged={replace}
      />

      <div className={styles['actions']}>
        {/* « Plus tard » is the way out of a step the host may not want; « Continuer » is the
            primary action only once there is a logo to go on with. */}
        <Button
          variant={hasLogo ? 'primary' : 'secondary'}
          onClick={() => navigate(home, { replace: true })}
        >
          {hasLogo ? copy.continue : copy.later}
        </Button>
      </div>

      <p className={styles['later']}>{copy.findLater}</p>
    </div>
  )
}
