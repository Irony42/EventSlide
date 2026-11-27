import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../../lib/useApi'
import { useAbout } from '../../../lib/useAbout'
import { usePagedList } from '../../../lib/usePagedList'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { EmptyState } from '../../../design-system/components/EmptyState'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import type { ProvisionedClientDto, SiteSignupDto, SiteSignupStatus } from '../../../lib/api/dto'
import { formatDateTime, formatDay } from '../../../lib/format'
import { LOCALE_NAMES, parseLocale } from '../../../lib/i18n/locale'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { InvitationOutcome } from '../components/InvitationOutcome'
import tables from '../components/Table.module.css'
import { ApproveSignupDialog } from './ApproveSignupDialog'
import { usePendingSignups } from './pendingSignupsContext'
import { RefuseSignupDialog } from './RefuseSignupDialog'
import styles from './SignupsPage.module.css'

interface Opened {
  readonly name: string
  readonly email: string
  readonly clientId: string
  readonly result: ProvisionedClientDto
}

type Tab = 'current' | 'processed'

/** The page size asked for; the server caps it. */
const PAGE_SIZE = 50

/**
 * The operator's page of signup requests (`/admin/site/signups`, spec 31).
 *
 * Surface: the operator's laptop. In `open` the accounts open by themselves, so the first tab lists
 * those opened in the last 30 days and, only if the disk guard held any, the requests waiting; in
 * `review` the first tab is the requests waiting. The second tab is the refused ones, kept 30 days.
 * The address a person typed is shown here and nowhere else in the console: it is what the
 * operator validates.
 */
export function SignupsPage() {
  const t = useTranslations()
  const mode = useAbout().features.signup
  const { refresh } = usePendingSignups()
  const [tab, setTab] = useState<Tab>('current')
  const [version, setVersion] = useState(0)
  const [approving, setApproving] = useState<SiteSignupDto | null>(null)
  const [refusing, setRefusing] = useState<SiteSignupDto | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [refused, setRefused] = useState(false)
  const panelId = useId()
  // The banner is in the page from the start and filled when a decision lands: a region that is
  // already there is announced when its text changes, and it is where the keyboard goes once the
  // dialog that had it has closed.
  const bannerRef = useRef<HTMLDivElement>(null)
  const [decisions, setDecisions] = useState(0)
  useEffect(() => {
    if (decisions > 0) bannerRef.current?.focus()
  }, [decisions])

  /** Read every list again, and the badge with them. */
  const settled = () => {
    setVersion((current) => current + 1)
    refresh()
  }
  const decided = () => {
    settled()
    setDecisions((current) => current + 1)
  }

  const currentLabel = mode === 'open' ? t.siteSignups.tabOpened : t.siteSignups.tabPending

  const section = (status: SiteSignupStatus, extra: SectionExtra) => (
    <Section
      status={status}
      version={version}
      onApprove={setApproving}
      onRefuse={setRefusing}
      {...extra}
    />
  )

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.siteSignups.title}</h1>
      <p className={styles['hint']}>
        {mode === 'open' ? t.siteSignups.hintOpen : t.siteSignups.hintReview}
      </p>

      <div className={styles['tabs']} role="group" aria-label={t.siteSignups.tabsLabel}>
        <Button
          variant={tab === 'current' ? 'primary' : 'secondary'}
          aria-pressed={tab === 'current'}
          aria-controls={panelId}
          onClick={() => setTab('current')}
        >
          {currentLabel}
        </Button>
        <Button
          variant={tab === 'processed' ? 'primary' : 'secondary'}
          aria-pressed={tab === 'processed'}
          aria-controls={panelId}
          onClick={() => setTab('processed')}
        >
          {t.siteSignups.tabProcessed}
        </Button>
      </div>

      <div ref={bannerRef} role="status" tabIndex={-1} className={styles['banner']}>
        {opened === null ? null : t.siteSignups.approvedDone(opened.name)}
        {refused ? t.siteSignups.refusedDone : null}
      </div>
      {opened === null ? null : (
        <div className={styles['opened']}>
          <InvitationOutcome
            invitation={opened.result.invitation}
            email={opened.email}
            onDismiss={() => setOpened(null)}
          />
          <Link className={styles['link']} to={`/admin/site/clients/${opened.clientId}`}>
            {t.siteSignups.clientLink}
          </Link>
        </div>
      )}

      <div
        id={panelId}
        role="region"
        aria-label={tab === 'processed' ? t.siteSignups.tabProcessed : currentLabel}
        className={styles['panel']}
      >
        {tab === 'processed' ? (
          section('refused', {
            hint: t.siteSignups.processedHint,
            empty: t.siteSignups.emptyProcessed,
          })
        ) : mode === 'open' ? (
          <>
            {section('approved', {
              heading: t.siteSignups.openedHeading,
              empty: t.siteSignups.emptyOpened,
            })}
            {section('pending', {
              heading: t.siteSignups.heldHeading,
              hint: t.siteSignups.heldHint,
              hideWhenEmpty: true,
            })}
          </>
        ) : (
          section('pending', { empty: t.siteSignups.emptyPending })
        )}
      </div>

      {approving === null ? null : (
        <ApproveSignupDialog
          signup={approving}
          onCancel={() => setApproving(null)}
          onApproved={(signup, result) => {
            setApproving(null)
            setRefused(false)
            setOpened({
              name: signup.clientName,
              email: signup.email,
              clientId: result.clientId,
              result,
            })
            decided()
          }}
          // A refusal such as « already handled » means the list on screen is out of date.
          onFailed={settled}
        />
      )}
      {refusing === null ? null : (
        <RefuseSignupDialog
          signup={refusing}
          onCancel={() => setRefusing(null)}
          onRefused={() => {
            setRefusing(null)
            setOpened(null)
            setRefused(true)
            decided()
          }}
          onFailed={settled}
        />
      )}
    </div>
  )
}

interface SectionExtra {
  readonly heading?: string
  readonly hint?: string
  readonly empty?: string
  readonly hideWhenEmpty?: boolean
}

interface SectionProps extends SectionExtra {
  readonly status: SiteSignupStatus
  readonly version: number
  readonly onApprove: (signup: SiteSignupDto) => void
  readonly onRefuse: (signup: SiteSignupDto) => void
}

/** One list of requests, with the four states every read owes (a wait, a refusal, nothing, rows). */
function Section({
  status,
  version,
  onApprove,
  onRefuse,
  heading,
  hint,
  empty,
  hideWhenEmpty = false,
}: SectionProps) {
  const t = useTranslations()
  const api = useApi()
  const headingId = useId()
  // `version` is part of the request's identity: a decision changes it, and the list starts over.
  const fetchPage = useCallback(
    (before: string | undefined, signal?: AbortSignal) => {
      void version
      return api.siteSignups(
        status,
        { limit: PAGE_SIZE, ...(before === undefined ? {} : { before }) },
        signal,
      )
    },
    [api, status, version],
  )
  const list = usePagedList(fetchPage)

  if (hideWhenEmpty && !list.loading && list.error === null && list.items.length === 0) {
    return null
  }

  const body = (
    <>
      {heading === undefined ? null : (
        <h2 id={headingId} className={styles['heading']}>
          {heading}
        </h2>
      )}
      {hint === undefined ? null : <p className={styles['hint']}>{hint}</p>}
      {list.loading && list.items.length === 0 ? <Pending label={t.app.loading} /> : null}
      {!list.loading && list.error !== null ? (
        <LoadFailure message={list.error} onRetry={list.reload} as="h3" />
      ) : null}
      {!list.loading && list.error === null && list.items.length === 0 && empty !== undefined ? (
        <EmptyState as="h3" title={empty} />
      ) : null}
      {list.items.length > 0 ? (
        <SignupsTable status={status} rows={list.items} onApprove={onApprove} onRefuse={onRefuse} />
      ) : null}
      {list.moreError === null ? null : <p role="alert">{list.moreError}</p>}
      {list.hasMore ? (
        <Button variant="secondary" loading={list.loadingMore} onClick={list.more}>
          {t.site.more}
        </Button>
      ) : null}
    </>
  )

  // A section is a landmark only when it has a name of its own (its heading); the table's caption
  // names the table, so a second label on the wrapper would only say it twice.
  return heading === undefined ? (
    <div className={styles['section']}>{body}</div>
  ) : (
    <section className={styles['section']} aria-labelledby={headingId}>
      {body}
    </section>
  )
}

function SignupsTable({
  status,
  rows,
  onApprove,
  onRefuse,
}: {
  readonly status: SiteSignupStatus
  readonly rows: readonly SiteSignupDto[]
  readonly onApprove: (signup: SiteSignupDto) => void
  readonly onRefuse: (signup: SiteSignupDto) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const text = t.siteSignups
  const when = (iso: string | null) =>
    iso === null ? text.none : (formatDateTime(iso, locale) ?? iso)
  const dateColumn =
    status === 'approved'
      ? text.openedColumn
      : status === 'refused'
        ? text.decidedColumn
        : text.confirmedColumn

  return (
    <div className={tables['wrap']}>
      <table className={tables['table']}>
        <caption className="visually-hidden">{text.tableLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{text.emailColumn}</th>
            <th scope="col">{text.spaceColumn}</th>
            <th scope="col">{text.occasionColumn}</th>
            <th scope="col">{text.eventDateColumn}</th>
            <th scope="col">{text.languageColumn}</th>
            <th scope="col">{dateColumn}</th>
            {status === 'refused' ? null : <th scope="col">{text.actionsColumn}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const language = parseLocale(row.locale)
            const day =
              row.eventDate === null ? null : formatDay(`${row.eventDate}T12:00:00.000Z`, locale)
            const decided =
              status === 'pending'
                ? row.confirmedAt
                : status === 'approved'
                  ? (row.decidedAt ?? row.confirmedAt)
                  : row.decidedAt
            return (
              <tr key={row.id}>
                <th scope="row" className={tables['name']}>
                  {row.email}
                </th>
                <td>
                  {row.clientName}
                  {status === 'pending' && row.existingAccount ? (
                    <Badge tone="accent" className={styles['badge']}>
                      {text.existingAccount}
                    </Badge>
                  ) : null}
                </td>
                <td className={styles['note']}>{row.note ?? text.none}</td>
                <td>{day ?? row.eventDate ?? text.none}</td>
                <td>{language === null ? row.locale : LOCALE_NAMES[language]}</td>
                <td className={tables['muted']}>{when(decided)}</td>
                {status === 'refused' ? null : (
                  <td>
                    {status === 'approved' ? (
                      row.clientId === null ? (
                        text.none
                      ) : (
                        <Link className={styles['link']} to={`/admin/site/clients/${row.clientId}`}>
                          {text.clientLink}
                        </Link>
                      )
                    ) : (
                      <div className={styles['actions']}>
                        <Button variant="primary" onClick={() => onApprove(row)}>
                          {text.approve}
                        </Button>
                        <Button variant="secondary" onClick={() => onRefuse(row)}>
                          {text.refuse}
                        </Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
