import { useCallback, useState } from 'react'
import { useApi } from '../../app/useApi'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Progress, type ProgressTone } from '../../design-system/components/Progress'
import { useToast } from '../../design-system/components/useToast'
import { formatBytes, formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { auditActor, auditSentence } from './auditLabels'
import { errorMessage } from './errorMessage'
import { LoadFailure, Pending } from './components/AsyncState'
import { SuspensionScreen } from './components/SuspensionScreen'
import { useAction } from './hooks/useAction'
import { useAbout } from '../../app/useAbout'
import { contactActionOf } from './ceilingLevels'
import { useLoader } from './hooks/useLoader'
import styles from './ClientSpacePage.module.css'
import type {
  CeilingMeterDto,
  ClientAuditEntryDto,
  ClientLimitsDto,
  PendingInvitationDto,
} from '../../lib/api/dto'

const TONE: Readonly<Record<CeilingMeterDto['level'], ProgressTone>> = {
  ok: 'accent',
  warning: 'warning',
  reached: 'danger',
}

/**
 * What a client's owner reads of their own account (roadmap §10.9; G2-16 / P3-17): the
 * ceilings and how much of each is used, what waits for their approval, and what the operator
 * did on the account.
 *
 * **Everything on it is the caller's own.** Each section asks the server about the clients the
 * caller belongs to, and the server answers for nobody else's: a client id sent from here is
 * checked against the caller's roster and is a `404` for any other. A member who is not an owner
 * sees the limits and nothing below them, because the log and the approvals are the owner's.
 *
 * Surface: the host's laptop. Not a second console: it reads, and the one thing it does is the
 * owner's consent that R1 of the operator guard asks for.
 */
export function ClientSpacePage() {
  const t = useTranslations()
  const api = useApi()
  const contact = contactActionOf(useAbout())
  // Asked for directly and not through `useClientLimits`: the page exists only on a box with a
  // client space, so there is no mode to read, and a failed read has to be said here rather than
  // read as "no limit at all".
  const load = useCallback(
    async (signal: AbortSignal) => (await api.myLimits(signal)).clients,
    [api],
  )
  const { data, loading, error, reload } = useLoader(load)
  const clients = data ?? []

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.clientSpace.spaceTitle}</h1>

      {loading ? <Pending label={t.admin.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} /> : null}

      {!loading && error === null && data !== null && clients.length === 0 ? (
        <EmptyState title={t.clientSpace.noLimits} />
      ) : null}

      {clients.map((client) => (
        <section key={client.id} className={styles['client']}>
          <LimitsCard limits={client} />
          {client.suspended ? <SuspensionScreen contact={contact} /> : null}
          {client.role === 'owner' ? (
            <>
              <PendingInvitations client={client} />
              <AuditLog client={client} />
            </>
          ) : null}
        </section>
      ))}
    </div>
  )
}

function LimitsCard({ limits }: { readonly limits: ClientLimitsDto }) {
  const t = useTranslations()
  const { locale } = useLocale()

  const label = (meter: CeilingMeterDto): string => {
    switch (meter.kind) {
      case 'events':
        return t.clientSpace.eventsMeter(meter.used, meter.max)
      case 'eventsPerPeriod':
        return t.clientSpace.eventsPerPeriodMeter(meter.used, meter.max)
      case 'storage':
        return t.clientSpace.storageMeter(
          formatBytes(meter.used, locale),
          formatBytes(meter.max, locale),
        )
    }
  }

  return (
    <Card
      as="h2"
      title={limits.name}
      subtitle={t.clientSpace.limitsTitle}
      footer={
        <Badge tone="neutral">
          {limits.role === 'owner' ? t.clientSpace.roleOwner : t.clientSpace.roleMember}
        </Badge>
      }
    >
      {limits.meters.length === 0 && limits.ceilings.liveAllowed ? (
        <p>{t.clientSpace.noLimits}</p>
      ) : (
        <ul className={styles['meters']}>
          {limits.meters.map((meter) => (
            <li key={meter.kind}>
              <span>{label(meter)}</span>
              <Progress
                value={meter.used}
                max={meter.max}
                label={label(meter)}
                tone={TONE[meter.level]}
              />
            </li>
          ))}
          {limits.ceilings.liveAllowed ? null : <li>{t.clientSpace.liveNotAllowed}</li>}
        </ul>
      )}
    </Card>
  )
}

function PendingInvitations({ client }: { readonly client: ClientLimitsDto }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const load = useCallback(
    async (signal: AbortSignal) => (await api.pendingInvitations(client.id, signal)).items,
    [api, client.id],
  )
  const { data, loading, error, reload } = useLoader(load)
  const approval = useAction(useCallback((id: string) => api.approveInvitation(id), [api]))

  const approve = (invitation: PendingInvitationDto) => {
    void approval.run(invitation.id, invitation.id).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        reload()
        return
      }
      toast.show(t.clientSpace.approved, { tone: 'success' })
      reload()
    })
  }

  return (
    <Card as="h2" title={t.clientSpace.pendingTitle} subtitle={t.clientSpace.pendingHint}>
      {loading ? <Pending label={t.admin.loading} /> : null}
      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} as="h3" /> : null}
      {!loading && error === null && data !== null && data.length === 0 ? (
        <p>{t.clientSpace.pendingEmpty}</p>
      ) : null}
      {data !== null && data.length > 0 ? (
        <ul className={styles['rows']}>
          {data.map((invitation) => (
            <li key={invitation.id} className={styles['row']}>
              <span id={`invitee-${invitation.id}`} className={styles['address']}>
                {invitation.email}
              </span>
              <Badge tone="neutral">
                {invitation.role === 'owner' ? t.clientSpace.roleOwner : t.clientSpace.roleMember}
              </Badge>
              <span className={styles['muted']}>
                {t.clientSpace.pendingValidUntil(
                  formatDateTime(invitation.expiresAt, locale) ?? invitation.expiresAt,
                )}
              </span>
              <Button
                size="sm"
                variant="primary"
                loading={approval.pending === invitation.id}
                disabled={approval.busy}
                aria-describedby={`invitee-${invitation.id}`}
                onClick={() => approve(invitation)}
              >
                {t.clientSpace.approve}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

function AuditLog({ client }: { readonly client: ClientLimitsDto }) {
  const t = useTranslations()
  const toast = useToast()
  const { locale } = useLocale()
  const api = useApi()
  // The client is always named: the server checks it against the caller's roster, so naming
  // one's own is what an account in several clients has to do and costs a solo one nothing.
  const clientId = client.id
  const load = useCallback(
    (signal: AbortSignal) => api.clientAudit({ clientId }, signal),
    [api, clientId],
  )
  const { data, loading, error, reload } = useLoader(load)
  const [older, setOlder] = useState<{
    readonly items: readonly ClientAuditEntryDto[]
    readonly next: number | null
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const items = [...(data?.items ?? []), ...(older?.items ?? [])]
  const next = older === null ? (data?.next ?? null) : older.next

  const more = () => {
    if (next === null) return
    setLoadingMore(true)
    void api
      .clientAudit({ clientId, before: next })
      .then((page) =>
        setOlder({ items: [...(older?.items ?? []), ...page.items], next: page.next }),
      )
      .catch((cause: unknown) => toast.show(errorMessage(cause, t), { tone: 'danger' }))
      .finally(() => setLoadingMore(false))
  }

  return (
    <Card as="h2" title={t.clientSpace.auditTitle} subtitle={t.clientSpace.auditHint}>
      {loading ? <Pending label={t.admin.loading} /> : null}
      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} as="h3" /> : null}
      {!loading && error === null && data !== null && items.length === 0 ? (
        <p>{t.clientSpace.auditEmpty}</p>
      ) : null}
      {items.length > 0 ? (
        <ol className={styles['rows']}>
          {items.map((entry) => (
            <li key={entry.seq} className={styles['row']}>
              <time className={styles['muted']} dateTime={entry.at}>
                {formatDateTime(entry.at, locale) ?? entry.at}
              </time>
              <span>{auditSentence(entry, t)}</span>
              <Badge tone="neutral">
                {entry.actor.label === null
                  ? auditActor(entry, t)
                  : `${auditActor(entry, t)} · ${entry.actor.label}`}
              </Badge>
            </li>
          ))}
        </ol>
      ) : null}
      {next === null ? null : (
        <Button variant="secondary" size="sm" loading={loadingMore} onClick={more}>
          {t.clientSpace.auditMore}
        </Button>
      )}
    </Card>
  )
}
