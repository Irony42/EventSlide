import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../app/useApi'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { formatBytes, formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './adminShared'
import { InvitationOutcome } from './components/InvitationOutcome'
import { NewClientForm, type ClientOpened } from './components/NewClientForm'
import { usePagedList } from './hooks/usePagedList'
import { standingLabel, standingOf, standingTone } from './siteLabels'
import tables from './components/Table.module.css'
import styles from './ClientsPage.module.css'
import type { SiteClientDto } from '../../lib/api/dto'

/**
 * Every client of the box (`GET /api/site/clients`): its name, whether it is frozen, how many
 * events and members it has and how much of its storage it uses.
 *
 * Surface: the operator's laptop, the console's front page. **Shapes and sizes, never what a
 * client made**: a row is a name the operator gave, two counts and a byte sum, and there is no
 * event name, slug, photograph or guest on the screen because there is none in the answer. The
 * four states every screen owes (a wait, a refusal with a retry, nothing yet, rows) are all here.
 */
export function ClientsPage() {
  const t = useTranslations()
  const api = useApi()
  const fetchPage = useCallback(
    (after: string | undefined, signal?: AbortSignal) =>
      api.siteClients(after === undefined ? {} : { after }, signal),
    [api],
  )
  const list = usePagedList(fetchPage)
  const [creating, setCreating] = useState(false)
  const [opened, setOpened] = useState<ClientOpened | null>(null)

  const handleOpened = (result: ClientOpened) => {
    setCreating(false)
    setOpened(result)
    list.reload()
  }

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>{t.site.clientsTitle}</h1>
        {creating ? null : (
          <Button
            variant="primary"
            onClick={() => {
              setOpened(null)
              setCreating(true)
            }}
          >
            {t.site.newClient}
          </Button>
        )}
      </header>
      <p className={styles['hint']}>{t.site.clientsHint}</p>

      {creating ? (
        <NewClientForm onOpened={handleOpened} onCancel={() => setCreating(false)} />
      ) : null}

      {opened === null ? null : (
        <section className={styles['opened']} aria-label={t.site.clientCreated}>
          <p role="status">{t.site.clientCreated}</p>
          <InvitationOutcome
            invitation={opened.invitation}
            email={opened.email}
            onDismiss={() => setOpened(null)}
          />
          <Link className={styles['link']} to={`/admin/site/clients/${opened.clientId}`}>
            {opened.name}
          </Link>
        </section>
      )}

      {list.loading && list.items.length === 0 ? <Pending label={t.app.loading} /> : null}

      {!list.loading && list.error !== null ? (
        <LoadFailure message={list.error} onRetry={list.reload} />
      ) : null}

      {!list.loading && list.error === null && list.items.length === 0 ? (
        <EmptyState as="h2" title={t.site.clientsEmpty} description={t.site.clientsEmptyHint} />
      ) : null}

      {list.items.length > 0 ? <ClientsTable clients={list.items} /> : null}

      {list.moreError === null ? null : <p role="alert">{list.moreError}</p>}
      {list.hasMore ? (
        <Button variant="secondary" loading={list.loadingMore} onClick={list.more}>
          {t.site.more}
        </Button>
      ) : null}
    </div>
  )
}

function ClientsTable({ clients }: { readonly clients: readonly SiteClientDto[] }) {
  const t = useTranslations()
  const { locale } = useLocale()

  return (
    <div className={tables['wrap']}>
      <table className={tables['table']}>
        <caption className="visually-hidden">{t.site.clientsTableLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{t.site.clientColumn}</th>
            <th scope="col">{t.site.statusColumn}</th>
            <th scope="col">{t.site.eventsColumn}</th>
            <th scope="col">{t.site.membersColumn}</th>
            <th scope="col">{t.site.storageColumn}</th>
            <th scope="col">{t.site.createdColumn}</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const standing = standingOf(client)
            const { maxTotalBytes } = client.ceilings
            const used = formatBytes(client.usage.usedBytes, locale)
            return (
              <tr key={client.id}>
                <th scope="row" className={tables['name']}>
                  <Link className={styles['link']} to={`/admin/site/clients/${client.id}`}>
                    {client.name}
                  </Link>
                </th>
                <td>
                  <Badge tone={standingTone(standing)}>{standingLabel(standing, t)}</Badge>
                </td>
                <td>{t.site.eventsCell(client.usage.eventCount, client.usage.liveEventCount)}</td>
                <td>{client.usage.memberCount}</td>
                <td>
                  {maxTotalBytes === null
                    ? `${used} · ${t.site.noCeiling}`
                    : t.site.storageOf(used, formatBytes(maxTotalBytes, locale))}
                </td>
                <td className={tables['muted']}>
                  {formatDateTime(client.createdAt, locale) ?? client.createdAt}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
