import { Link } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import { fr } from '../../lib/i18n/fr'
import { LoadFailure, Pending } from './components/AsyncState'
import { EventStatusBadge } from './components/EventStatusBadge'
import { StorageMeter } from './components/StorageMeter'
import { allowsModeration, lifecycleActions, servesWall } from './eventLifecycle'
import { useEventList } from './hooks/useEventData'
import { useStatusChange } from './hooks/useEventActions'
import styles from './DashboardPage.module.css'
import type { EventStatus, EventSummaryDto } from '../../lib/api/dto'

const NEW_EVENT_PATH = '/admin/events/new'

/** Surface: the host's laptop. The first screen a new host sees after signing in. */
export function DashboardPage() {
  const { data: events, loading, error, reload } = useEventList()
  const statusChange = useStatusChange()
  const toast = useToast()

  const changeStatus = (event: EventSummaryDto, to: EventStatus) => {
    void statusChange.run(`${event.slug}:${to}`, event.slug, to).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(fr.admin.statusSaved, { tone: 'success' })
      // Refetched rather than patched in place: closing an event changes counts the
      // summary carries, and a card showing stale figures next to a fresh status is
      // worse than a second request on a list this size.
      reload()
    })
  }

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{fr.admin.events}</h1>
        <Link className={styles['actionLink']} to={NEW_EVENT_PATH}>
          {fr.admin.newEvent}
        </Link>
      </div>

      {loading ? <Pending label={fr.admin.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} /> : null}

      {!loading && error === null && events !== null && events.length === 0 ? (
        <EmptyState
          title={fr.admin.eventsEmpty}
          description={fr.admin.eventsEmptyHint}
          action={
            <Link className={styles['actionLink']} to={NEW_EVENT_PATH}>
              {fr.admin.newEvent}
            </Link>
          }
        />
      ) : null}

      {!loading && error === null && events !== null && events.length > 0 ? (
        <ul className={styles['list']}>
          {events.map((event) => (
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
                    {lifecycleActions(event.status).map((action) => (
                      <Button
                        key={action.to}
                        variant={action.primary ? 'primary' : 'secondary'}
                        size="sm"
                        loading={statusChange.pending === `${event.slug}:${action.to}`}
                        disabled={statusChange.busy}
                        onClick={() => changeStatus(event, action.to)}
                      >
                        {action.label}
                      </Button>
                    ))}
                    {allowsModeration(event.status) ? (
                      <Link
                        className={styles['actionLink']}
                        to={`/admin/events/${event.slug}/moderation`}
                      >
                        {fr.admin.openModeration}
                      </Link>
                    ) : null}
                    {servesWall(event.status) ? (
                      <Link className={styles['actionLink']} to={`/e/${event.slug}/display`}>
                        {fr.admin.openWall}
                      </Link>
                    ) : null}
                  </>
                }
              >
                <div className={styles['facts']}>
                  <EventStatusBadge status={event.status} />
                  <span>{fr.admin.photos(event.photoCount)}</span>
                  <span>{fr.admin.guests(event.guestCount)}</span>
                  {event.pendingCount > 0 ? (
                    <Badge tone="warning">{fr.moderation.pending(event.pendingCount)}</Badge>
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
      ) : null}
    </div>
  )
}
