import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../../app/useApi'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './adminShared'
import { useClientNames } from './hooks/useClientNames'
import { usePagedList } from './hooks/usePagedList'
import { auditSentence, reasonOf, shortId } from './siteLabels'
import styles from './AuditPage.module.css'

/**
 * The box's whole log, newest first (`GET /api/site/audit`), or one client's slice of it
 * (`?clientId=`).
 *
 * Surface: the operator's laptop. Unlike the client's own view of its log, this one names the
 * account behind an operator or a member (by the first characters of its id, which is what the log
 * holds) and carries the **reason** the operator gave for a change of ceilings: the one free text
 * the log keeps, printed as text and never as markup.
 *
 * The client's name is read beside, from the listing, so a line says which client it is about; a
 * listing that cannot be read leaves the id in its place and does not stop the log.
 */
export function AuditPage() {
  const [params] = useSearchParams()
  const clientId = params.get('clientId') ?? undefined
  // Keyed by the filter: the listing it loads is another listing, and the rows of the old one must
  // not stay on screen under the new heading while it is on its way.
  return <AuditLog key={clientId ?? 'all'} clientId={clientId} />
}

function AuditLog({ clientId }: { readonly clientId: string | undefined }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()

  const fetchPage = useCallback(
    (before: number | undefined, signal?: AbortSignal) =>
      api.siteAudit(
        {
          ...(clientId === undefined ? {} : { clientId }),
          ...(before === undefined ? {} : { before }),
        },
        signal,
      ),
    [api, clientId],
  )
  const list = usePagedList(fetchPage)

  const nameOf = useClientNames()

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.site.auditTitle}</h1>
      <p className={styles['hint']}>{t.site.auditHint}</p>
      {clientId === undefined ? null : (
        <p>
          {/* Says **which** client, not only that there is a filter: the address carries an id,
              and an operator who followed a link here would otherwise have to guess. The name
              is the one the listing gives; until it arrives, or if it cannot, the id stands in. */}
          {t.site.auditFilteredFor(nameOf.get(clientId) ?? shortId(clientId))}{' '}
          <Link className={styles['link']} to={`/admin/site/clients/${clientId}`}>
            {t.site.auditToClient}
          </Link>{' '}
          <Link className={styles['link']} to="/admin/site/audit">
            {t.site.auditShowAll}
          </Link>
        </p>
      )}

      {list.loading && list.items.length === 0 ? <Pending label={t.app.loading} /> : null}

      {!list.loading && list.error !== null ? (
        <LoadFailure message={list.error} onRetry={list.reload} />
      ) : null}

      {!list.loading && list.error === null && list.items.length === 0 ? (
        <EmptyState as="h2" title={t.site.auditEmpty} />
      ) : null}

      {list.items.length > 0 ? (
        <ol className={styles['rows']}>
          {list.items.map((entry) => {
            const reason = reasonOf(entry)
            return (
              <li key={entry.seq} className={styles['row']}>
                <time className={styles['when']} dateTime={entry.at}>
                  {formatDateTime(entry.at, locale) ?? entry.at}
                </time>
                <span className={styles['what']}>{auditSentence(entry, t)}</span>
                <Badge tone="neutral">
                  {entry.actor.userId === null
                    ? t.site.actors[entry.actor.kind]
                    : `${t.site.actors[entry.actor.kind]} · ${t.site.auditAccount(shortId(entry.actor.userId))}`}
                </Badge>
                {entry.clientId === null ? null : (
                  <Link className={styles['link']} to={`/admin/site/clients/${entry.clientId}`}>
                    {nameOf.get(entry.clientId) ?? shortId(entry.clientId)}
                  </Link>
                )}
                {reason === null ? null : (
                  <span className={styles['reason']}>{t.site.auditReason(reason)}</span>
                )}
              </li>
            )
          })}
        </ol>
      ) : null}

      {list.moreError === null ? null : <p role="alert">{list.moreError}</p>}
      {list.hasMore ? (
        <Button variant="secondary" loading={list.loadingMore} onClick={list.more}>
          {t.site.auditMore}
        </Button>
      ) : null}
    </div>
  )
}
