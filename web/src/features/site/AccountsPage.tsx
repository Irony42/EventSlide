import { useCallback, useState } from 'react'
import { useApi } from '../../app/useApi'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import type { SiteAccountDto, SiteResetDto } from '../../lib/api/dto'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from '../admin/components/AsyncState'
import { ResetOutcome } from './components/ResetOutcome'
import { useOperatorAction } from './hooks/useOperatorAction'
import { usePagedList } from './hooks/usePagedList'
import tables from './components/Table.module.css'
import styles from './AccountsPage.module.css'
import type { Locale } from '../../lib/i18n/locale'

type NotMailed = Exclude<SiteResetDto, { readonly delivery: 'mail' }>

/**
 * Every account of the box, by address (`GET /api/site/accounts`), and the one act the console
 * offers on it today: send its holder a password reset.
 *
 * Surface: the operator's laptop. **An address and what the account holds, and nothing else**: no
 * display name, no hash, no token, and no count of anything the person made, because the server
 * sends none. The reset goes to the account's own address and nowhere else (the operator guard's
 * R2); the console never sees the link where a mailer delivers, and is handed it only where none
 * could.
 */
export function AccountsPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const fetchPage = useCallback(
    (after: string | undefined, signal?: AbortSignal) =>
      api.siteAccounts(after === undefined ? {} : { after }, signal),
    [api],
  )
  const list = usePagedList(fetchPage)
  const [confirming, setConfirming] = useState<SiteAccountDto | null>(null)
  const [outcome, setOutcome] = useState<{
    readonly userId: string
    readonly reset: NotMailed
  } | null>(null)
  const reset = useOperatorAction(
    useCallback(
      (id: string, language: Locale) => api.siteResetPassword(id, { locale: language }),
      [api],
    ),
  )

  const confirm = () => {
    const account = confirming
    if (account === null) return
    void reset.run(account.id, account.id, locale).then((result) => {
      setConfirming(null)
      if (!result.ok) {
        if (result.message !== null) toast.show(result.message, { tone: 'danger' })
        return
      }
      if (result.value.delivery === 'mail') {
        setOutcome(null)
        toast.show(t.site.resetSent, { tone: 'success' })
        return
      }
      setOutcome({ userId: account.id, reset: result.value })
    })
  }

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.site.accountsTitle}</h1>
      <p className={styles['hint']}>{t.site.accountsHint}</p>

      {outcome === null ? null : (
        <ResetOutcome
          // One box per request: a second reset replaces the first instead of mixing with it.
          key={outcome.userId}
          userId={outcome.userId}
          reset={outcome.reset}
          onDismiss={() => setOutcome(null)}
        />
      )}

      {list.loading && list.items.length === 0 ? <Pending label={t.app.loading} /> : null}

      {!list.loading && list.error !== null ? (
        <LoadFailure message={list.error} onRetry={list.reload} />
      ) : null}

      {!list.loading && list.error === null && list.items.length === 0 ? (
        <EmptyState as="h2" title={t.site.accountsEmpty} />
      ) : null}

      {list.items.length > 0 ? (
        <div className={tables['wrap']}>
          <table className={tables['table']}>
            <caption className="visually-hidden">{t.site.accountsTableLabel}</caption>
            <thead>
              <tr>
                <th scope="col">{t.site.addressColumn}</th>
                <th scope="col">{t.site.roleColumn}</th>
                <th scope="col">{t.site.accountStateColumn}</th>
                <th scope="col">{t.site.lastLoginColumn}</th>
                <th scope="col">{t.site.ownedColumn}</th>
                <th scope="col">{t.site.clientsColumn}</th>
                <th scope="col">
                  <span className="visually-hidden">{t.site.resetPassword}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((account) => (
                <tr key={account.id}>
                  <th scope="row" className={tables['name']} id={`account-${account.id}`}>
                    {account.email}
                  </th>
                  <td>
                    {account.siteRole === 'operator' ? (
                      <Badge tone="accent">{t.site.siteRoleOperator}</Badge>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={account.disabledAt === null ? 'success' : 'danger'}>
                      {account.disabledAt === null ? t.site.accountActive : t.site.accountDisabled}
                    </Badge>
                    {account.mustChangePassword ? (
                      <p className={tables['muted']}>{t.site.mustChange}</p>
                    ) : null}
                  </td>
                  <td className={tables['muted']}>
                    {account.lastLoginAt === null
                      ? t.site.neverSignedIn
                      : (formatDateTime(account.lastLoginAt, locale) ?? account.lastLoginAt)}
                  </td>
                  <td>{account.ownedEventCount}</td>
                  <td>{account.clients.length}</td>
                  <td>
                    <div className={tables['actions']}>
                      {account.disabledAt === null ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-describedby={`account-${account.id}`}
                          disabled={reset.busy}
                          onClick={() => setConfirming(account)}
                        >
                          {t.site.resetPassword}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {list.moreError === null ? null : <p role="alert">{list.moreError}</p>}
      {list.hasMore ? (
        <Button variant="secondary" loading={list.loadingMore} onClick={list.more}>
          {t.site.more}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        title={t.site.resetTitle}
        description={t.site.resetBody}
        confirmLabel={t.site.resetPassword}
        busy={reset.busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
