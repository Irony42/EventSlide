import { useCallback, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../../app/HostBreadcrumb'
import { HostEventsLink } from '../../../app/HostEventsLink'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../../design-system/components/EmptyState'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Notice } from '../../../design-system/components/Notice'
import { TextInput } from '../../../design-system/components/TextInput'
import type { RsvpDto, RsvpListResponseDto } from '../../../lib/api/dto'
import type { RsvpReplyInput } from '../../../lib/api/client/invite'
import { canManageEvent } from '../../../lib/eventLifecycle'
import { messageForError } from '../../../lib/i18n/translations'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import {
  barLegend,
  barLine,
  barOf,
  countsOf,
  latestLine,
  latestOf,
  repliesLabel,
  subline,
  tabsOf,
  visibleRsvps,
  windowAction,
  yesDetail,
  type RsvpTab,
} from '../../../lib/rsvp/rsvpList'
import { dateOf } from '../../../lib/rsvp/rsvpDates'
import { deadlineLabel, plural } from '../../../lib/rsvp/rsvpTexts'
import { ApiError } from '../../../lib/http'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useEvent } from '../hooks/useEventData'
import type { EventPageContext } from '../eventLayout/useEventPage'
import { RsvpCaterer } from './RsvpCaterer'
import { RsvpDetail } from './RsvpDetail'
import { RsvpPrintList } from './RsvpPrintList'
import { usePrintList } from './usePrintList'
import { RsvpReplyForm } from './RsvpReplyForm'
import { RsvpTable } from './RsvpTable'
import { useNow } from './useNow'
import { useRsvps } from './useRsvps'
import styles from './RsvpsPage.module.css'

/** Rows shown before "Afficher les autres": a long list is a long page on a phone. */
const FIRST_ROWS = 12
/** "Dernières réponses". */
const LATEST = 5

/**
 * The host's "Réponses" page (spec 30, lot 1), a section of the event's menu: the figures that answer
 * "how many will we be", the bar, the replies as a table (cards on a phone), what a host does to a
 * reply (change it, delete it, add one received by phone), the spreadsheet, and the button that
 * closes or reopens the replies. Updated live: a reply that lands while it is open is on screen
 * within a second, and counted as seen.
 *
 * Surface: the host, **the owner only**. Keyed by the event, so a move between two events starts afresh.
 */
export function RsvpsPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  return <EventReplies key={slug} slug={slug} />
}

function EventReplies({ slug }: { readonly slug: string }) {
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
        <OwnerReplies slug={slug} archived={event.status === 'archived'} eventName={event.name} />
      ) : (
        <>
          <h1 className={styles['title']}>{t.rsvp.list.title}</h1>
          <Notice tone="warning" role="status" variant="boxed">
            {t.guestInvite.host.ownerOnly}
          </Notice>
          <Link to={`/admin/events/${slug}`}>{t.admin.printKitBack}</Link>
        </>
      )}
    </div>
  )
}

function OwnerReplies({
  slug,
  archived,
  eventName,
}: {
  readonly slug: string
  readonly archived: boolean
  readonly eventName: string
}) {
  const t = useTranslations()
  // The layout reads the event again when told: the menu's badge counts what was not seen.
  const layout = useOutletContext<EventPageContext | undefined>()
  const state = useRsvps(slug, () => layout?.refresh())
  const { data, loading, error, reload } = state

  if (data === null && loading) return <Pending label={t.admin.eventLoading} />
  if (data === null) {
    return (
      <>
        <h1 className={styles['title']}>{t.rsvp.list.title}</h1>
        <LoadFailure message={error ?? t.rsvp.list.loadFailed} onRetry={reload} />
      </>
    )
  }
  return (
    <Replies
      slug={slug}
      data={data}
      archived={archived}
      state={state}
      error={error}
      eventName={eventName}
    />
  )
}

type Dialogs =
  | { readonly kind: 'none' }
  | { readonly kind: 'detail'; readonly id: string }
  | { readonly kind: 'form'; readonly reply: RsvpDto | null }
  | { readonly kind: 'delete'; readonly reply: RsvpDto }

function Replies({
  slug,
  data,
  archived,
  state,
  error,
  eventName,
}: {
  readonly slug: string
  readonly eventName: string
  readonly data: RsvpListResponseDto
  readonly archived: boolean
  readonly state: ReturnType<typeof useRsvps>
  /** The last refresh failed: the figures below are the previous ones. */
  readonly error: string | null
}) {
  const t = useTranslations()
  const text = t.rsvp.list
  const host = t.rsvp.host
  const api = useApi()
  const { locale } = useLocale()
  const { rsvpForm: settings, rsvps, stats } = data
  const form = settings.form

  const [tab, setTab] = useState<RsvpTab>('all')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [dialog, setDialog] = useState<Dialogs>({ kind: 'none' })
  const [problem, setProblem] = useState<string | null>(null)
  const printing = usePrintList()
  const [acting, setActing] = useState(false)
  // Judged against a clock that moves: a page left open past the deadline says so.
  const now = useNow(60_000)
  const [dialogProblem, setDialogProblem] = useState<string | null>(null)
  // The day the replies are erased is the party's: read in its zone, once the invitation says it.
  const loadInvite = useCallback(
    (signal: AbortSignal) => api.guestInvite(slug, signal),
    [api, slug],
  )
  const zone = useLoader(loadInvite).data?.guestInvite.timeZone ?? null

  // A tab that stops existing (the "peut-être" is no longer offered) is "Toutes".
  const tabs = tabsOf(form.maybe)
  const current = tabs.includes(tab) ? tab : 'all'
  const counts = countsOf(rsvps)
  const matching = visibleRsvps(rsvps, current, query)
  const searching = query.trim() !== ''
  const rows = showAll || searching ? matching : matching.slice(0, FIRST_ROWS)
  const locked = archived
  const bar = barOf(stats, form.maybe)
  const legend = barLegend(stats, form.maybe, text)
  const detail = dialog.kind === 'detail' ? (rsvps.find((r) => r.id === dialog.id) ?? null) : null

  const action = windowAction(settings, now)
  const deadline = settings.deadline === null ? null : deadlineLabel(settings.deadline, locale)
  const answerNames = {
    yes: text.tabYes,
    maybe: text.tabMaybe,
    no: text.tabNo,
    all: text.tabAll,
  } as const

  const act = async (run: () => Promise<unknown>) => {
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
  const toggleWindow = () =>
    act(async () => {
      const answer = await (action === 'close' ? api.closeRsvps(slug) : api.reopenRsvps(slug))
      state.adoptSettings(answer.rsvpForm)
    })
  /** A reply that is already gone (the guest erased it, another tab) is a deletion done, not a failure. */
  const isGone = (cause: unknown): boolean =>
    cause instanceof ApiError && cause.code === 'rsvp.notFound'
  const remove = async (reply: RsvpDto) => {
    setActing(true)
    setDialogProblem(null)
    try {
      await api.deleteRsvp(slug, reply.id)
      setDialog({ kind: 'none' })
      state.reload()
    } catch (cause) {
      if (isGone(cause)) {
        setDialog({ kind: 'none' })
        state.reload()
      } else {
        // The confirmation is a modal: the sentence goes where the host is looking, in the detail.
        setDialogProblem(messageForError(cause, t))
        setDialog({ kind: 'detail', id: reply.id })
      }
    } finally {
      setActing(false)
    }
  }
  const save = async (input: RsvpReplyInput, reply: RsvpDto | null) => {
    try {
      if (reply === null) await api.addRsvp(slug, input)
      else await api.updateRsvp(slug, reply.id, input)
    } catch (cause) {
      // The form shows the sentence; the list learns that the reply is gone.
      if (isGone(cause)) state.reload()
      throw cause
    }
    state.reload()
  }

  const empty = rsvps.length === 0
  const tiles: readonly {
    readonly kind: 'yes' | 'maybe' | 'no'
    readonly label: string
    readonly value: number
    readonly detail: string
  }[] = [
    {
      kind: 'yes',
      label: text.tileYes,
      value: stats.yes.people,
      detail: yesDetail(stats, form.partySize.enabled && form.kidsSeparate, text),
    },
    ...(form.maybe
      ? [
          {
            kind: 'maybe' as const,
            label: text.tileMaybe,
            value: stats.maybe.people,
            detail: text.tileMaybeDetail(
              repliesLabel(stats.maybe.responses, text),
              `${stats.maybe.people} ${plural(stats.maybe.people, text.person)}`,
            ),
          },
        ]
      : []),
    {
      kind: 'no',
      label: text.tileNo,
      value: stats.no.responses,
      detail: repliesLabel(stats.no.responses, text),
    },
  ]

  return (
    <>
      <header className={styles['head']}>
        <div>
          <h1 className={styles['title']}>{text.title}</h1>
          <p className={styles['sub']}>
            {subline(rsvps.length, deadline, settings.state === 'closed', text)}
          </p>
        </div>
        <div className={styles['actions']}>
          {settings.enabled && settings.invited && (action === 'close' || action === 'reopen') ? (
            <Button size="sm" disabled={locked || acting} onClick={() => void toggleWindow()}>
              {action === 'close' ? host.closeAction : host.reopenAction}
            </Button>
          ) : null}
          <Link className={styles['settings']} to={`/admin/events/${slug}/invitations`}>
            {text.settings}
          </Link>
        </div>
      </header>
      {settings.enabled && action === 'closedByDate' ? (
        <Notice tone="warning" variant="inline">
          {host.closedByDate}
        </Notice>
      ) : null}
      {settings.enabled && action === 'moveDate' ? (
        <Notice tone="warning" variant="inline">
          {host.reopenNeedsDate}
        </Notice>
      ) : null}
      {error === null ? null : (
        <Notice tone="warning" variant="boxed" role="status">
          {error}
          <Button size="sm" onClick={state.reload}>
            {text.retry}
          </Button>
        </Notice>
      )}
      {problem === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {problem}
        </Notice>
      )}

      {empty && !settings.enabled ? (
        <EmptyState
          title={text.emptyTitle}
          description={text.emptyOff}
          action={<Link to={`/admin/events/${slug}/invitations`}>{text.settings}</Link>}
        />
      ) : (
        <div className={styles['layout']}>
          <div className={styles['main']}>
            <div className={styles['tiles']} role="group" aria-label={text.tilesLabel}>
              {tiles.map((tile) => (
                <button
                  key={tile.kind}
                  type="button"
                  className={styles['tile']}
                  data-kind={tile.kind}
                  onClick={() => setTab(tile.kind)}
                >
                  <span className={styles['tileKey']}>{tile.label}</span>
                  <span className={styles['tileValue']}>{tile.value}</span>
                  <span className={styles['tileDetail']}>{tile.detail}</span>
                </button>
              ))}
            </div>

            <div className={styles['bar']}>
              <b>{barLine(stats, form.maybe, text)}</b>
              <div
                className={styles['track']}
                role="img"
                aria-label={text.barSummary(legend.map((item) => item.text).join(', '))}
              >
                {bar.map((segment) => (
                  <span
                    key={segment.kind}
                    data-kind={segment.kind}
                    style={{ inlineSize: `${segment.percent}%` }}
                  />
                ))}
              </div>
              <ul className={styles['legend']}>
                {legend.map((item) => (
                  <li key={item.kind} data-kind={item.kind}>
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>

            {empty ? (
              <EmptyState title={text.emptyTitle} description={text.emptyBody} />
            ) : (
              <>
                <div className={styles['tabs']} role="group" aria-label={text.tabsLabel}>
                  {tabs.map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={current === name}
                      onClick={() => setTab(name)}
                    >
                      {answerNames[name]}
                      <i>{counts[name]}</i>
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
                  <Button
                    size="sm"
                    disabled={locked}
                    onClick={() => setDialog({ kind: 'form', reply: null })}
                  >
                    {text.add}
                  </Button>
                  <a className={styles['export']} href={api.rsvpExportUrl(slug)} download>
                    {text.export}
                  </a>
                </div>
                {matching.length === 0 ? (
                  <p className={styles['note']}>{text.noneHere}</p>
                ) : (
                  <RsvpTable
                    rows={rows}
                    form={form}
                    onOpen={(reply) => {
                      setDialogProblem(null)
                      setDialog({ kind: 'detail', id: reply.id })
                    }}
                  />
                )}
                <p className={styles['note']}>
                  {matching.length > rows.length ? (
                    <>
                      {text.rowsOf(rows.length, matching.length)}{' '}
                      <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                        {text.showMore(matching.length - rows.length)}
                      </Button>
                    </>
                  ) : matching.length === 0 ? null : (
                    text.rowsAll(matching.length, plural(matching.length, text.line))
                  )}
                </p>
              </>
            )}
            {settings.erasedAt === null ? null : (
              <p className={styles['note']}>
                {host.erasedOn(dateOf(settings.erasedAt, locale, zone))}
              </p>
            )}
          </div>

          <aside className={styles['side']}>
            {empty ? null : (
              <section className={styles['panel']}>
                <h2>{text.latestTitle}</h2>
                <ul className={styles['feed']}>
                  {latestOf(rsvps, LATEST).map((reply) => (
                    <li key={reply.id} data-kind={reply.answer}>
                      <span>{latestLine(reply, text)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {empty ? null : (
              <RsvpCaterer
                stats={stats}
                form={form}
                exportHref={api.rsvpExportUrl(slug, 'caterer')}
                onPrint={printing.print}
              />
            )}
            <section className={styles['panel']}>
              <h2>{text.notifyTitle}</h2>
              <ul className={styles['notify']}>
                <li>
                  <b>{text.notifyApp}</b>
                  <span>{text.notifyAppHint}</span>
                </li>
                <li>
                  <b>{text.notifyLive}</b>
                  <span>{text.notifyLiveHint}</span>
                </li>
              </ul>
              <p className={styles['note']}>{text.notifyNoEmail}</p>
            </section>
          </aside>
        </div>
      )}

      {printing.printing ? (
        <RsvpPrintList eventName={eventName} rsvps={rsvps} stats={stats} form={form} />
      ) : null}

      <RsvpDetail
        reply={detail}
        form={form}
        locked={locked}
        problem={dialogProblem}
        onEdit={(reply) => setDialog({ kind: 'form', reply })}
        onDelete={(reply) => setDialog({ kind: 'delete', reply })}
        onClose={() => setDialog({ kind: 'none' })}
      />
      {dialog.kind === 'form' ? (
        <RsvpReplyForm
          reply={dialog.reply}
          form={form}
          onSubmit={(input) => save(input, dialog.reply)}
          onClose={() => setDialog({ kind: 'none' })}
        />
      ) : null}
      <ConfirmDialog
        open={dialog.kind === 'delete'}
        title={dialog.kind === 'delete' ? text.deleteTitle(dialog.reply.name) : ''}
        description={text.deleteBody}
        confirmLabel={text.deleteYes}
        busy={acting}
        onConfirm={() => {
          if (dialog.kind === 'delete') void remove(dialog.reply)
        }}
        onCancel={() => setDialog({ kind: 'none' })}
      />
    </>
  )
}
