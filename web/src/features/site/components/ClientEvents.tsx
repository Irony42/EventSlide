import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { formatBytes, formatDateTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from '../../admin/components/AsyncState'
import { usePagedList } from '../hooks/usePagedList'
import { eventStatusLabel, eventStatusTone, shortId } from '../siteLabels'
import tables from './Table.module.css'

/**
 * One client's events as **shapes and sizes** (`GET /api/site/clients/:clientId/events`): an id, a
 * status, instants, a quota and what is used.
 *
 * Surface: the operator's laptop. There is no event name, address, join code or photograph here
 * because the server sends none (roadmap D-06: the name is the client's data, and the address
 * leads to the public wall). A row is told apart by the first characters of its id, which is all
 * an operator needs to say "the second one" to its owner, and no more than the API gave.
 */
export function ClientEvents({ clientId }: { readonly clientId: string }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const fetchPage = useCallback(
    (after: string | undefined, signal?: AbortSignal) =>
      api.siteClientEvents(clientId, after === undefined ? {} : { after }, signal),
    [api, clientId],
  )
  const list = usePagedList(fetchPage)

  return (
    <Card as="h2" title={t.site.eventsTitle} subtitle={t.site.eventsHint}>
      {list.loading && list.items.length === 0 ? <Pending label={t.app.loading} /> : null}
      {!list.loading && list.error !== null ? (
        <LoadFailure message={list.error} onRetry={list.reload} as="h3" />
      ) : null}
      {!list.loading && list.error === null && list.items.length === 0 ? (
        <p>{t.site.eventsEmpty}</p>
      ) : null}
      {list.items.length > 0 ? (
        <div className={tables['wrap']}>
          <table className={tables['table']}>
            <caption className="visually-hidden">{t.site.eventsTableLabel}</caption>
            <thead>
              <tr>
                <th scope="col">{t.site.eventColumn}</th>
                <th scope="col">{t.site.eventStatusColumn}</th>
                <th scope="col">{t.site.photosColumn}</th>
                <th scope="col">{t.site.usedColumn}</th>
                <th scope="col">{t.site.startsColumn}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((event) => (
                <tr key={event.id}>
                  <th scope="row">{t.site.eventLabel(shortId(event.id))}</th>
                  <td>
                    <Badge tone={eventStatusTone(event.status)}>
                      {eventStatusLabel(event.status, t)}
                    </Badge>
                  </td>
                  <td>{t.site.photoCount(event.photoCount)}</td>
                  <td>
                    {event.quotaBytes === null
                      ? formatBytes(event.usedBytes, locale)
                      : t.site.storageOf(
                          formatBytes(event.usedBytes, locale),
                          formatBytes(event.quotaBytes, locale),
                        )}
                  </td>
                  <td className={tables['muted']}>
                    {event.startsAt === null
                      ? '—'
                      : (formatDateTime(event.startsAt, locale) ?? event.startsAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.moreError === null ? null : <p role="alert">{list.moreError}</p>}
      {list.hasMore ? (
        <Button variant="secondary" size="sm" loading={list.loadingMore} onClick={list.more}>
          {t.site.more}
        </Button>
      ) : null}
    </Card>
  )
}
