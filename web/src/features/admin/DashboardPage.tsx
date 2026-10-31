import { Link } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { VisuallyHidden } from '../../design-system/components/VisuallyHidden'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { Async } from '../../design-system/components/Async'
import { EventStatusBadge } from './components/EventStatusBadge'
import { CeilingBanner } from './components/CeilingBanner'
import { LifecycleConfirmDialog } from './components/LifecycleConfirmDialog'
import { StorageMeter } from './components/StorageMeter'
import { SuspensionScreen } from './components/SuspensionScreen'
import { allowsModeration, canManageEvent, lifecycleActions, linksToWall } from './eventLifecycle'
import { useEvent, useEventList } from './hooks/useEventData'
import { AmbianceMarker } from '../../design-system/components/AmbianceMarker'
import { useLifecycleTransition } from './hooks/useLifecycleTransition'
import { useClientLimits } from './hooks/useClientLimits'
import styles from './DashboardPage.module.css'

const NEW_EVENT_PATH = '/admin/events/new'
const CLIENT_SPACE_PATH = '/admin/client'

/** Surface: the host's laptop. The first screen a new host sees after signing in. */
export function DashboardPage() {
  const t = useTranslations()
  const events = useEventList()
  // The caller's own clients and their ceilings; empty on a box with no client space, in which
  // case nothing below renders and the page is what it always was.
  const { clients, contact } = useClientLimits()
  const suspended = clients.some((client) => client.suspended)

  // Refetched rather than patched in place: closing an event changes counts the summary
  // carries, and a card showing stale figures next to a fresh status is worse than a second
  // request on a list this size.
  const transition = useLifecycleTransition(events.reload)

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t.admin.events}</h1>
        {clients.length > 0 ? (
          <Link className={styles['actionLink']} to={CLIENT_SPACE_PATH}>
            {t.clientSpace.spaceLink}
          </Link>
        ) : null}
        {suspended ? null : (
          <Link className={styles['actionLink']} to={NEW_EVENT_PATH}>
            {t.admin.newEvent}
          </Link>
        )}
      </div>

      {suspended ? <SuspensionScreen contact={contact} /> : null}
      {clients
        .filter((client) => !client.suspended)
        .map((client) => (
          <CeilingBanner key={client.id} limits={client} contact={contact} />
        ))}

      <Async
        state={events}
        label={t.admin.loading}
        empty={
          <EmptyState
            title={t.admin.eventsEmpty}
            description={t.admin.eventsEmptyHint}
            action={
              suspended ? undefined : (
                <Link className={styles['actionLink']} to={NEW_EVENT_PATH}>
                  {t.admin.newEvent}
                </Link>
              )
            }
          >
            {/* What a first event takes, in the order it is done: generic, so it is the same for a
              self-hoster and for a client of a box. The test on the venue's own network is the
              step that is skipped and regretted. */}
            <ol className={styles['steps']}>
              <li>{t.admin.emptyStepCreate}</li>
              <li>{t.admin.emptyStepPrint}</li>
              <li>{t.admin.emptyStepScreen}</li>
              <li>{t.admin.emptyStepOpen}</li>
              <li>{t.admin.emptyStepTest}</li>
            </ol>
          </EmptyState>
        }
      >
        {(list) => (
          <>
            {/* A host with one evening sees the dashboard in its ambiance too (ADR 0010, 28/10). */}
            {list.length === 1 && list[0] !== undefined ? (
              <SingleEventAmbiance slug={list[0].slug} />
            ) : null}
            <ul className={styles['list']}>
              {list.map((event) => (
                <li key={event.id}>
                  <Card
                    title={
                      // The card itself is never clickable — 1.0's tile was a
                      // `div role="button"` with a nested button inside it. The name is
                      // the link, so it has an address and answers the keyboard.
                      <Link className={styles['eventLink']} to={`/admin/events/${event.slug}`}>
                        {event.name}
                      </Link>
                    }
                    footer={
                      <>
                        {allowsModeration(event.status) ? (
                          <Link
                            className={styles['actionLink']}
                            to={`/admin/events/${event.slug}/moderation`}
                          >
                            {t.admin.openModeration}
                          </Link>
                        ) : null}
                        {linksToWall(event.status) ? (
                          <>
                            {/* A tab of its own, like the event page's tile: the wall has no way back to
                              the console. The hint describes the link without joining its name. */}
                            <Link
                              className={styles['actionLink']}
                              to={`/e/${event.slug}/display`}
                              target="_blank"
                              rel="noopener"
                              aria-describedby={`wall-hint-${event.id}`}
                            >
                              {t.admin.openWall}
                            </Link>
                            <VisuallyHidden id={`wall-hint-${event.id}`}>
                              {event.status === 'draft'
                                ? `${t.about.opensInNewTab}. ${t.admin.wallDraftHint}`
                                : t.about.opensInNewTab}
                            </VisuallyHidden>
                          </>
                        ) : null}
                        {/* Last, and after the ways in: the thumb that aims at "Moderate" must not land on
                          a button that closes the evening (revue UX 30/10, NAV-1). The owner's: a
                          moderator's request to change the lifecycle is answered 403, so the buttons
                          are not offered to them. The server still decides. */}
                        {(canManageEvent(event.role) ? lifecycleActions(event.status, t) : []).map(
                          (action) => (
                            <Button
                              key={action.to}
                              variant={action.primary ? 'primary' : 'secondary'}
                              size="sm"
                              loading={transition.pending === `${event.slug}:${action.to}`}
                              disabled={transition.busy}
                              onClick={() =>
                                transition.request({
                                  slug: event.slug,
                                  eventName: event.name,
                                  from: event.status,
                                  to: action.to,
                                })
                              }
                            >
                              {action.label}
                            </Button>
                          ),
                        )}
                      </>
                    }
                  >
                    <div className={styles['facts']}>
                      <EventStatusBadge status={event.status} />
                      <span>{t.admin.photos(event.photoCount)}</span>
                      <span>{t.admin.guests(event.guestCount)}</span>
                      {event.pendingCount > 0 ? (
                        <Badge tone="warning">{t.moderation.pending(event.pendingCount)}</Badge>
                      ) : null}
                    </div>
                    {/*
                  No bar here: `GET /api/events` answers with summaries that carry no
                  quota, and a bar drawn against a ceiling the client invented would be
                  a number a host makes decisions on. The event page has the quota.
                */}
                    <StorageMeter usedBytes={event.usedBytes} quotaBytes={null} />
                  </Card>
                </li>
              ))}
            </ul>
            <LifecycleConfirmDialog
              request={transition.asking}
              busy={transition.busy}
              onConfirm={transition.confirm}
              onCancel={transition.cancel}
            />
          </>
        )}
      </Async>
    </div>
  )
}

/**
 * The ambiance of the host's only event, read with the event itself: the summaries the list
 * carries hold no theme, and one more read on a one-event dashboard is cheaper than widening
 * every summary on the wire. Nothing renders while it loads or if it fails.
 */
function SingleEventAmbiance({ slug }: { readonly slug: string }) {
  const event = useEvent(slug)
  return (
    <AmbianceMarker
      ambiance={event.data?.settings.theme.ambiance}
      custom={event.data?.settings.theme.custom}
      groundUrl={event.data?.settings.theme.groundUrl}
    />
  )
}
