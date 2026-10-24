import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './adminShared'
import { CeilingsEditor } from './components/CeilingsEditor'
import { ClientEvents } from './components/ClientEvents'
import { ClientSummary } from './components/ClientSummary'
import { InviteForm } from './components/InviteForm'
import { useSiteClient } from './hooks/useSiteClient'
import styles from './ClientPage.module.css'

/**
 * One client, opened from the listing (`/admin/site/clients/:clientId`): what it is using, its
 * ceilings and the reason for changing them, an invitation into its account, its events as shapes
 * and sizes, and the way to its slice of the log.
 *
 * Surface: the operator's laptop. Nothing on it is what the client made: the events are rows of
 * ids, statuses and bytes, and the two free texts are the client's **name**, which the operator
 * gave it, and the addresses the operator types into the invitation form.
 *
 * An id that names nobody (a client deleted by the end of its engagement, a mistyped address) is
 * said in the server's own words (`client.notFound`), with the way back.
 */
export function ClientPage() {
  const t = useTranslations()
  const { clientId = '' } = useParams()
  const { client, missing, loading, error, reload } = useSiteClient(clientId)

  return (
    <div className={styles['page']}>
      <nav aria-label={t.site.allClients}>
        <Link className={styles['back']} to="/admin/site">
          {t.site.allClients}
        </Link>
      </nav>

      {loading && client === null ? <Pending label={t.app.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} /> : null}

      {missing ? (
        <EmptyState
          as="h1"
          title={t.errors['client.notFound']}
          action={<Link to="/admin/site">{t.site.allClients}</Link>}
        />
      ) : null}

      {client === null ? null : (
        <>
          <ClientSummary client={client} onChanged={reload} />
          <CeilingsEditor
            // Keyed by what it shows, so a saved change reads back into the form.
            key={JSON.stringify(client.ceilings)}
            client={client}
            onChanged={reload}
          />
          <InviteForm clientId={client.id} />
          <ClientEvents clientId={client.id} />
          <p>
            <Link className={styles['back']} to={`/admin/site/audit?clientId=${client.id}`}>
              {t.site.auditLink}
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
