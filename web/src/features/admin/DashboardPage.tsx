import { Link } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { Async } from '../../design-system/components/Async'
import { EventStatusBadge } from './components/EventStatusBadge'
import { CeilingBanner } from './components/CeilingBanner'
import { StorageMeter } from './components/StorageMeter'
import { SuspensionScreen } from './components/SuspensionScreen'
import { allowsModeration, lifecycleActions, servesWall } from './eventLifecycle'
import { useEventList } from './hooks/useEventData'
import { useStatusChange } from './hooks/useEventActions'
import { useClientLimits } from './hooks/useClientLimits'
import styles from './DashboardPage.module.css'
import type { EventStatus, EventSummaryDto } from '../../lib/api/dto'

const NEW_EVENT_PATH = '/admin/events/new'
const CLIENT_SPACE_PATH = '/admin/client'

/** Surface: the host's laptop. The first screen a new host sees after signing in. */
export function DashboardPage() {
  const t = useTranslations()
  const events = useEventList()
  const statusChange = useStatusChange()
  const toast = useToast()
  // The caller's own clients and their ceilings; empty on a box with no client space, in which
  // case nothing below renders and the page is what it always was.
  const { clients, contact } = useClientLimits()
  const suspended = clients.some((client) => client.suspended)

  const changeStatus = (event: EventSummaryDto, to: EventStatus) => {
    void statusChange.run(`${event.slug}:${to}`, event.slug, to).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(t.admin.statusSaved, { tone: 'success' })
      // Refetched rather than patched in place: closing an event changes counts the
      // summary carries, and a card showing stale figures next to a fresh status is
      // worse than a second request on a list this size.
      events.reload()
    })
  }

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
              <li>{t.admin.emptyStepTest}</li>
              <li>{t.admin.emptyStepPrint}</li>
            </ol>
          </EmptyState>
        }
      >
        {(list) => (
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
                      {lifecycleActions(event.status, t).map((action) => (
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
                          {t.admin.openModeration}
                        </Link>
                      ) : null}
                      {servesWall(event.status) ? (
                        <Link className={styles['actionLink']} to={`/e/${event.slug}/display`}>
                          {t.admin.openWall}
                        </Link>
                      ) : null}
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
        )}
      </Async>
    </div>
  )
}
