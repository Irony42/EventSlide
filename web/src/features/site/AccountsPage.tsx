import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../app/useApi'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import type { OperatorPasswordResetDto, SiteAccountDto } from '../../lib/api/dto'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './adminShared'
import { ResetOutcome } from './components/ResetOutcome'
import { useClientNames } from './hooks/useClientNames'
import { useOperatorAction } from './hooks/useOperatorAction'
import { usePagedList } from './hooks/usePagedList'
import { shortId } from './siteLabels'
import tables from './components/Table.module.css'
import styles from './AccountsPage.module.css'
import type { Locale } from '../../lib/i18n/locale'

type NotMailed = Exclude<OperatorPasswordResetDto, { readonly delivery: 'mail' }>

type Act = 'reset' | 'disable' | 'delete'

/**
 * Every account of the box, by address (`GET /api/site/accounts`), and the acts the console offers on
 * one: send its holder a password reset, switch it off or back on, delete it (an erasure request).
 *
 * Surface: the operator's laptop. **An address and what the account holds, and nothing else**: no
 * display name, no hash, no token, and no count of anything the person made, because the server
 * sends none. The reset goes to the account's own address and nowhere else (the operator guard's
 * R2); the console never sees the link where a mailer delivers, and is handed it only where none
 * could.
 *
 * **An operator's account is offered none of the three that end or suspend an account**: the server
 * refuses both (`account.operatorProtected`) and a button that can only fail is not offered. Every
 * refusal that remains (an account that still owns an event, wrote media, reviewed a photograph, or
 * is the last owner of a client) is the server's, in its own sentence: the console knows none of
 * those rules and restates none.
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
  // Each account names the clients it belongs to, as links: Comptes and Clients lead to one
  // another. The id stands in for a name the listing could not give.
  const clientName = useClientNames()
  const [acting, setActing] = useState<{
    readonly act: Act
    readonly account: SiteAccountDto
  } | null>(null)
  const [outcome, setOutcome] = useState<{
    /** One per request, so a second reset replaces the first instead of inheriting its approval. */
    readonly request: number
    readonly userId: string
    readonly reset: NotMailed
  } | null>(null)
  const [requests, setRequests] = useState(0)
  const reset = useOperatorAction(
    useCallback(
      (id: string, language: Locale) => api.siteResetPassword(id, { locale: language }),
      [api],
    ),
  )

  const disable = useOperatorAction(useCallback((id: string) => api.siteDisableAccount(id), [api]))
  const enable = useOperatorAction(useCallback((id: string) => api.siteEnableAccount(id), [api]))
  const erase = useOperatorAction(useCallback((id: string) => api.siteDeleteAccount(id), [api]))
  const busy = reset.busy || disable.busy || enable.busy || erase.busy

  /**
   * A refusal stays on screen until it is dismissed: one of them carries a thing to do.
   *
   * One at a time, though. Each is pinned, so two refused acts in a row used to leave two
   * sentences up, the first about an account the operator has already moved on from; the
   * newest replaces the one before it. An act that goes through leaves an earlier refusal alone: it
   * is about something else, and it may be the instruction the operator is acting on.
   */
  const lastRefusal = useRef<string | null>(null)
  const refuse = (message: string): void => {
    if (lastRefusal.current !== null) toast.dismiss(lastRefusal.current)
    lastRefusal.current = toast.show(message, { tone: 'danger', durationMs: 0 })
  }

  /** What an act on the account came to: said, and the listing read again where it changed. */
  const settle = (
    result: { readonly ok: true } | { readonly ok: false; readonly message: string | null },
    done: string,
  ): void => {
    setActing(null)
    if (!result.ok) {
      if (result.message !== null) refuse(result.message)
      return
    }
    toast.show(done, { tone: 'success' })
    list.reload()
  }

  const switchOn = (account: SiteAccountDto) => {
    void enable
      .run(account.id, account.id)
      .then((result) => settle(result, t.site.accountEnabledDone))
  }

  const confirm = () => {
    if (acting === null) return
    const { act, account } = acting
    if (act === 'disable') {
      void disable
        .run(account.id, account.id)
        .then((result) => settle(result, t.site.accountDisabledDone))
      return
    }
    if (act === 'delete') {
      void erase
        .run(account.id, account.id)
        .then((result) => settle(result, t.site.accountDeletedDone))
      return
    }
    void reset.run(account.id, account.id, locale).then((result) => {
      setActing(null)
      if (!result.ok) {
        if (result.message !== null) refuse(result.message)
        return
      }
      if (result.value.delivery === 'mail') {
        setOutcome(null)
        toast.show(t.site.resetSent, { tone: 'success' })
        return
      }
      setRequests((count) => count + 1)
      setOutcome({ request: requests + 1, userId: account.id, reset: result.value })
    })
  }

  // The address is in the question: an irreversible act rests on what the operator reads, not on
  // which row they remember having pressed.
  const address = acting?.account.email ?? ''
  const wording = {
    reset: { title: t.site.resetTitle, body: t.site.resetBody, label: t.site.resetPassword },
    disable: {
      title: t.site.disableTitle(address),
      body: t.site.disableBody,
      label: t.site.disableAccount,
    },
    delete: {
      title: t.site.deleteTitle(address),
      body: t.site.deleteBody,
      label: t.site.deleteAccount,
    },
  } as const satisfies Record<Act, { title: string; body: string; label: string }>

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.site.accountsTitle}</h1>
      <p className={styles['hint']}>{t.site.accountsHint}</p>

      {outcome === null ? null : (
        <ResetOutcome
          key={outcome.request}
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
                <th scope="col">{t.site.termsColumn}</th>
                <th scope="col">{t.site.ownedColumn}</th>
                <th scope="col">{t.site.clientsColumn}</th>
                <th scope="col">
                  <span className="visually-hidden">{t.site.accountActionsColumn}</span>
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
                  <td className={tables['muted']}>
                    {account.termsVersion === null || account.termsAcceptedAt === null
                      ? t.site.termsNone
                      : t.site.termsAccepted(
                          account.termsVersion,
                          formatDateTime(account.termsAcceptedAt, locale) ??
                            account.termsAcceptedAt,
                        )}
                  </td>
                  <td>{account.ownedEventCount}</td>
                  <td>
                    {account.clients.length === 0 ? (
                      <span className={tables['muted']}>{t.site.noClient}</span>
                    ) : (
                      <ul className={styles['clients']}>
                        {account.clients.map((membership) => (
                          <li key={membership.clientId}>
                            <Link
                              className={styles['link']}
                              to={`/admin/site/clients/${membership.clientId}`}
                            >
                              {clientName.get(membership.clientId) ?? shortId(membership.clientId)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <div className={tables['actions']}>
                      {account.disabledAt === null ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-describedby={`account-${account.id}`}
                          disabled={busy}
                          onClick={() => setActing({ act: 'reset', account })}
                        >
                          {t.site.resetPassword}
                        </Button>
                      ) : null}
                      {account.siteRole === 'operator' ? null : account.disabledAt === null ? (
                        <Button
                          key="disable"
                          variant="secondary"
                          size="sm"
                          aria-describedby={`account-${account.id}`}
                          disabled={busy}
                          onClick={() => setActing({ act: 'disable', account })}
                        >
                          {t.site.disableAccount}
                        </Button>
                      ) : (
                        <Button
                          key="enable"
                          variant="secondary"
                          size="sm"
                          aria-describedby={`account-${account.id}`}
                          loading={enable.pending === account.id}
                          disabled={busy}
                          onClick={() => switchOn(account)}
                        >
                          {t.site.enableAccount}
                        </Button>
                      )}
                      {account.siteRole === 'operator' ? null : (
                        <Button
                          variant="danger"
                          size="sm"
                          aria-describedby={`account-${account.id}`}
                          disabled={busy}
                          onClick={() => setActing({ act: 'delete', account })}
                        >
                          {t.site.deleteAccount}
                        </Button>
                      )}
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
        open={acting !== null}
        title={wording[acting?.act ?? 'reset'].title}
        description={wording[acting?.act ?? 'reset'].body}
        confirmLabel={wording[acting?.act ?? 'reset'].label}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setActing(null)}
      />
    </div>
  )
}
