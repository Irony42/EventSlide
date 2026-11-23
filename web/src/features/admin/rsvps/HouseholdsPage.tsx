import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../../app/HostBreadcrumb'
import { HostEventsLink } from '../../../app/HostEventsLink'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../../design-system/components/EmptyState'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Notice } from '../../../design-system/components/Notice'
import { TextInput } from '../../../design-system/components/TextInput'
import { useToast } from '../../../design-system/components/useToast'
import type { HouseholdDto } from '../../../lib/api/dto'
import type { HouseholdInput } from '../../../lib/api/client/invite'
import { copyToClipboard } from '../../../lib/clipboard'
import { canManageEvent } from '../../../lib/eventLifecycle'
import { messageForError } from '../../../lib/i18n/translations'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { ApiError } from '../../../lib/http'
import {
  HOUSEHOLD_FILTERS,
  householdCounts,
  householdLink,
  pendingOf,
  placesOf,
  visibleHouseholds,
  type HouseholdFilter,
} from '../../../lib/rsvp/households'
import { dateOf } from '../../../lib/rsvp/rsvpDates'
import { deadlineLabel } from '../../../lib/rsvp/rsvpTexts'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useEvent } from '../hooks/useEventData'
import { HouseholdForm } from './HouseholdForm'
import { HouseholdImport } from './HouseholdImport'
import { HouseholdReminder, type ReminderInvite } from './HouseholdReminder'
import { useHouseholds } from './useHouseholds'
import styles from './HouseholdsPage.module.css'

/**
 * The host's guest list (spec 30, lot 3), a sub-page of "Réponses": the households the host listed
 * (a name and the places kept for it, **never a contact**), each one's personal link to copy or change,
 * who has not answered, and the guided reminder that prepares a message the host sends from their own
 * applications. Optional: an event with no list works as before.
 *
 * Surface: the host, **the owner only**. Keyed by the event, so a move between two events starts afresh.
 */
export function HouseholdsPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  return <EventHouseholds key={slug} slug={slug} />
}

function EventHouseholds({ slug }: { readonly slug: string }) {
  const t = useTranslations()
  const { data: event, loading, error, reload } = useEvent(slug)

  if (event === null && loading) return <Pending label={t.admin.eventLoading} />
  if (event === null) {
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="rsvps" eventName={null} />
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }
  return (
    <div className={styles['page']}>
      <HostBreadcrumb slug={slug} page="rsvps" eventName={event.name} />
      {canManageEvent(event.role) ? (
        <OwnerHouseholds slug={slug} archived={event.status === 'archived'} />
      ) : (
        <>
          <h1 className={styles['title']}>{t.rsvp.households.title}</h1>
          <Notice tone="warning" role="status" variant="boxed">
            {t.guestInvite.host.ownerOnly}
          </Notice>
          <Link to={`/admin/events/${slug}`}>{t.admin.printKitBack}</Link>
        </>
      )}
    </div>
  )
}

type Dialogs =
  | { readonly kind: 'none' }
  | { readonly kind: 'form'; readonly household: HouseholdDto | null }
  | { readonly kind: 'import' }
  | { readonly kind: 'delete'; readonly household: HouseholdDto }
  | { readonly kind: 'rotate'; readonly household: HouseholdDto }

function OwnerHouseholds({
  slug,
  archived,
}: {
  readonly slug: string
  readonly archived: boolean
}) {
  const t = useTranslations()
  const text = t.rsvp.households
  const api = useApi()
  const toast = useToast()
  const { locale } = useLocale()
  const state = useHouseholds(slug)
  const { data, loading, error, reload } = state

  // The invitation gives the address of every link and the title of the reminder; the settings, the deadline.
  const loadInvite = useCallback(
    (signal: AbortSignal) => api.guestInvite(slug, signal),
    [api, slug],
  )
  const inviteState = useLoader(loadInvite)
  const invite = inviteState.data?.guestInvite ?? null
  const loadSettings = useCallback((signal: AbortSignal) => api.rsvpForm(slug, signal), [api, slug])
  const settings = useLoader(loadSettings).data?.rsvpForm ?? null

  const [filter, setFilter] = useState<HouseholdFilter>('all')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialogs>({ kind: 'none' })
  const [problem, setProblem] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [startSignal, setStartSignal] = useState(0)
  const reminderRef = useRef<HTMLDivElement>(null)

  if (data === null && loading) return <Pending label={t.admin.eventLoading} />
  if (data === null) {
    return (
      <>
        <h1 className={styles['title']}>{text.title}</h1>
        <LoadFailure message={error ?? text.loadFailed} onRetry={reload} />
      </>
    )
  }

  const households = data.households
  const counts = householdCounts(households)
  const pending = pendingOf(households)
  const shown = visibleHouseholds(households, filter, query)
  const inviteUrl = invite?.url ?? null
  const invited = settings === null ? invite?.configured === true : settings.invited
  const deadline =
    settings === null || settings.deadline === null
      ? null
      : deadlineLabel(settings.deadline, locale)
  // Three different things hide behind "no address": still loading, failed to read, nothing saved.
  const reminderInvite: ReminderInvite =
    inviteUrl !== null
      ? { kind: 'ready', url: inviteUrl, title: invite?.title ?? invite?.defaultTitle ?? '' }
      : invite === null && inviteState.loading
        ? { kind: 'loading' }
        : invite === null
          ? { kind: 'error', retry: inviteState.reload }
          : { kind: 'none' }
  const filterNames = {
    all: text.filterAll,
    pending: text.filterPending,
    answered: text.filterAnswered,
  } as const

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setActing(true)
    setProblem(null)
    try {
      await run()
    } catch (cause) {
      setProblem(messageForError(cause, t))
    } finally {
      setActing(false)
    }
  }
  const save = async (input: HouseholdInput, household: HouseholdDto | null) => {
    try {
      if (household === null) await api.addHousehold(slug, input)
      else await api.updateHousehold(slug, household.id, input)
    } catch (cause) {
      // The form shows the sentence; the list learns that the household is gone.
      if (cause instanceof ApiError && cause.code === 'household.notFound') reload()
      throw cause
    }
    reload()
  }
  // A dialog that asks is closed before the act runs: a refusal is then said by the page's own notice,
  // in front of the host, not behind a modal that is still open.
  const remove = (household: HouseholdDto) => {
    setDialog({ kind: 'none' })
    return act(async () => {
      try {
        await api.deleteHousehold(slug, household.id)
      } catch (cause) {
        // Already gone (another tab): a deletion done, not a failure.
        if (!(cause instanceof ApiError && cause.code === 'household.notFound')) throw cause
      }
      reload()
    })
  }
  const rotate = (household: HouseholdDto) => {
    setDialog({ kind: 'none' })
    return act(async () => {
      try {
        await api.rotateHousehold(slug, household.id)
      } catch (cause) {
        // Already gone (another tab): there is no link left to change, the list learns it.
        if (!(cause instanceof ApiError && cause.code === 'household.notFound')) throw cause
      }
      reload()
    })
  }
  const copy = async (household: HouseholdDto) => {
    const link = householdLink(inviteUrl, household)
    if (link === null) return
    const copied = await copyToClipboard(link)
    toast.show(copied ? text.linkCopied : text.copyFailed(link), {
      tone: copied ? 'success' : 'warning',
    })
  }
  const reminded = async (household: HouseholdDto): Promise<void> => {
    try {
      await api.remindHousehold(slug, household.id)
      reload()
    } catch {
      toast.show(text.reminderNoteFailed, { tone: 'warning' })
    }
  }
  const startReminders = () => {
    setStartSignal((signal) => signal + 1)
    reminderRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  const statusOf = (household: HouseholdDto) => {
    const reply = household.reply
    if (reply !== null) {
      const label =
        reply.answer === 'yes'
          ? text.statusYes(reply.people)
          : reply.answer === 'maybe'
            ? text.statusMaybe(reply.people)
            : reply.answer === 'no'
              ? text.statusNo
              : text.statusWaitlist
      return (
        <Badge
          tone={reply.answer === 'yes' ? 'success' : reply.answer === 'no' ? 'danger' : 'warning'}
        >
          {label}
        </Badge>
      )
    }
    return household.remindedAt === null ? (
      <Badge tone="neutral">{text.statusPending}</Badge>
    ) : (
      <Badge tone="warning">
        {text.statusReminded(dateOf(household.remindedAt, locale, null))}
      </Badge>
    )
  }

  return (
    <>
      <header className={styles['head']}>
        <div>
          <p className={styles['back']}>
            <Link to={`/admin/events/${slug}/rsvps`}>{text.backToReplies}</Link>
          </p>
          <h1 className={styles['title']}>{text.title}</h1>
          <p className={styles['sub']}>{text.summary(counts.all, placesOf(households))}</p>
        </div>
        <div className={styles['actions']}>
          <Button
            size="sm"
            variant="primary"
            disabled={archived || !invited}
            onClick={() => setDialog({ kind: 'form', household: null })}
          >
            {text.add}
          </Button>
          <Button
            size="sm"
            disabled={archived || !invited}
            onClick={() => setDialog({ kind: 'import' })}
          >
            {text.importList}
          </Button>
        </div>
      </header>
      <p className={styles['note']}>{text.intro}</p>
      {invited ? null : (
        <Notice tone="warning" variant="boxed" role="status">
          {text.noInvite} <Link to={`/admin/events/${slug}/invitations`}>{text.noInviteLink}</Link>
        </Notice>
      )}
      {error === null ? null : (
        <Notice tone="warning" variant="boxed" role="status">
          {error}
          <Button size="sm" onClick={reload}>
            {text.retry}
          </Button>
        </Notice>
      )}
      {problem === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {problem}
        </Notice>
      )}

      {households.length === 0 ? (
        <EmptyState title={text.emptyTitle} description={text.emptyBody} />
      ) : (
        <div className={styles['layout']}>
          <div className={styles['main']}>
            <div className={styles['tabs']} role="group" aria-label={text.filtersLabel}>
              {HOUSEHOLD_FILTERS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={filter === name}
                  aria-label={`${filterNames[name]}, ${counts[name]}`}
                  onClick={() => setFilter(name)}
                >
                  {filterNames[name]}
                  <i aria-hidden="true">{counts[name]}</i>
                </button>
              ))}
            </div>
            <div className={styles['toolbar']}>
              <TextInput
                type="search"
                aria-label={text.searchLabel}
                placeholder={text.searchLabel}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className={styles['spacer']} />
              {pending.length === 0 ? null : (
                <Button size="sm" onClick={startReminders}>
                  {text.remindAll(pending.length)}
                </Button>
              )}
            </div>
            {shown.length === 0 ? (
              <p className={styles['note']}>{text.noneHere}</p>
            ) : (
              <div className={styles['wrap']}>
                <table className={styles['table']}>
                  <thead>
                    <tr>
                      <th scope="col">{text.colHousehold}</th>
                      <th scope="col">{text.colPlaces}</th>
                      <th scope="col">{text.colStatus}</th>
                      <th scope="col">{text.colLink}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((household) => (
                      <tr key={household.id}>
                        <th scope="row" className={styles['name']}>
                          {household.name}
                        </th>
                        <td>{household.places}</td>
                        <td>
                          {statusOf(household)}
                          {household.reply === null ? null : (
                            <>
                              {' '}
                              <Link to={`/admin/events/${slug}/rsvps?reply=${household.reply.id}`}>
                                {text.viewReply}
                              </Link>
                            </>
                          )}
                        </td>
                        <td>
                          <div className={styles['rowActions']}>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={inviteUrl === null}
                              aria-label={`${text.copyLink} · ${household.name}`}
                              onClick={() => void copy(household)}
                            >
                              {text.copyLink}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={archived}
                              aria-label={`${text.edit} · ${household.name}`}
                              onClick={() => setDialog({ kind: 'form', household })}
                            >
                              {text.edit}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={archived}
                              aria-label={`${text.rotate} · ${household.name}`}
                              onClick={() => setDialog({ kind: 'rotate', household })}
                            >
                              {text.rotate}
                            </Button>
                            {/* Removing names stays possible on an archived event. */}
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${text.remove} · ${household.name}`}
                              onClick={() => setDialog({ kind: 'delete', household })}
                            >
                              {text.remove}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <aside className={styles['side']} ref={reminderRef}>
            <HouseholdReminder
              pending={pending}
              invite={reminderInvite}
              deadline={deadline}
              onReminded={reminded}
              archived={archived}
              startSignal={startSignal}
            />
          </aside>
        </div>
      )}

      {dialog.kind === 'form' ? (
        <HouseholdForm
          household={dialog.household}
          onSubmit={(input) => save(input, dialog.household)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      ) : null}
      {dialog.kind === 'import' ? (
        <HouseholdImport
          onSubmit={async (pasted) => {
            const imported = await api.importHouseholds(slug, pasted)
            reload()
            return imported
          }}
          onClose={() => setDialog({ kind: 'none' })}
        />
      ) : null}
      <ConfirmDialog
        open={dialog.kind === 'delete'}
        title={dialog.kind === 'delete' ? text.deleteTitle(dialog.household.name) : ''}
        description={text.deleteBody}
        confirmLabel={text.deleteYes}
        busy={acting}
        onConfirm={() => {
          if (dialog.kind === 'delete') void remove(dialog.household)
        }}
        onCancel={() => setDialog({ kind: 'none' })}
      />
      <ConfirmDialog
        open={dialog.kind === 'rotate'}
        title={dialog.kind === 'rotate' ? text.rotateTitle(dialog.household.name) : ''}
        description={text.rotateBody}
        confirmLabel={text.rotateYes}
        busy={acting}
        onConfirm={() => {
          if (dialog.kind === 'rotate') void rotate(dialog.household)
        }}
        onCancel={() => setDialog({ kind: 'none' })}
      />
    </>
  )
}
