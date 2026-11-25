import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type ReactNode,
} from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../../app/HostBreadcrumb'
import { HostEventsLink } from '../../../app/HostEventsLink'
import { Button } from '../../../design-system/components/Button'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Notice } from '../../../design-system/components/Notice'
import type { EventDto, GuestInviteDto } from '../../../lib/api/dto'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { canManageEvent } from '../../../lib/eventLifecycle'
import { previewPage } from '../../../lib/rsvp/rsvpSettings'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useLeaveWarning } from '../hooks/useLeaveWarning'
import { useEvent } from '../hooks/useEventData'
import { AppearancePanel } from './AppearancePanel'
import { draftInvite } from './invitationDraft'
import { InvitationLink } from './InvitationLink'
import { InvitationSaveStatus, InvitationText } from './InvitationText'
import { KeptStateProvider, OpenGroupsProvider, useKeptStore, useOpenGroups } from './openGroups'
import { optionCount, shortDay } from './panelSummaries'
import { PanelEntry } from './PanelEntry'
import { RsvpPanel } from './RsvpPanel'
import { SidePanel } from './SidePanel'
import { EmailTab } from './tabs/EmailTab'
import { GuestTab } from './tabs/GuestTab'
import { ImageTab } from './tabs/ImageTab'
import { PrintTab } from './tabs/PrintTab'
import type { OutputProps, OutputSlots } from './tabs/tabProps'
import { useInvitationAutosave } from './useInvitationAutosave'
import { useRsvpSettings } from './useRsvpSettings'
import { useInviteLook } from './useInvitePreferences'
import styles from './InvitationsPage.module.css'

/** The two panels that take the place of the card's column. */
type PanelName = 'reponses' | 'partage'
const SHARE_PANEL_ID = 'invite-panel-share'

type OutputName = 'print' | 'image' | 'email' | 'guest'
const OUTPUTS: readonly OutputName[] = ['print', 'image', 'email', 'guest']
const OUTPUT_TABS = {
  print: PrintTab,
  image: ImageTab,
  email: EmailTab,
  guest: GuestTab,
} as const satisfies Record<OutputName, (props: OutputProps) => ReactNode>

/**
 * The host's "Invitations" page (spec 29), in three columns: **the text** (and the look) on the
 * left, common to every format and saved as it is typed; **the preview** of the chosen format in
 * the middle, which follows every keystroke and never scrolls away; **the options** of that format
 * and its action on the right. The link's status is a bar under the title.
 *
 * Surface: the host, and **only the owner writes it**: a moderator of the event is told so rather
 * than shown a form every save of which would be refused. Keyed by the event, so the form's state
 * is the event's own when the router keeps the element across two slugs.
 */
export function InvitationsPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  return <EventInvitations key={slug} slug={slug} />
}

function EventInvitations({ slug }: { readonly slug: string }) {
  const t = useTranslations()
  const { data: event, loading, error, reload } = useEvent(slug)

  if (event === null && loading) return <Pending label={t.admin.eventLoading} />
  if (event === null) {
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="invitations" eventName={null} />
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
      <div className={styles['screenOnly']}>
        <HostBreadcrumb slug={slug} page="invitations" eventName={event.name} />
      </div>
      {canManageEvent(event.role) ? (
        <OwnerPage event={event} />
      ) : (
        <>
          <h1 className={styles['title']}>{t.guestInvite.host.title}</h1>
          <div className={styles['single']}>
            <Notice tone="warning" role="status" variant="boxed">
              {t.guestInvite.host.ownerOnly}
            </Notice>
            <Link to={`/admin/events/${slug}`}>{t.admin.printKitBack}</Link>
          </div>
        </>
      )}
    </div>
  )
}

function OwnerPage({ event }: { readonly event: EventDto }) {
  const t = useTranslations()
  const api = useApi()
  const slug = event.slug
  const load = useCallback((signal: AbortSignal) => api.guestInvite(slug, signal), [api, slug])
  const { data, loading, error, reload, replace } = useLoader(load)

  const adopt = (guestInvite: GuestInviteDto) => replace({ guestInvite })

  if (data === null && loading) return <Pending label={t.admin.eventLoading} />
  if (data === null) {
    return (
      <>
        <h1 className={styles['title']}>{t.guestInvite.host.title}</h1>
        <div className={styles['single']}>
          <LoadFailure message={error ?? t.guestInvite.host.loadFailed} onRetry={reload} />
        </div>
      </>
    )
  }

  return <Workspace event={event} invite={data.guestInvite} onChanged={adopt} />
}

/**
 * Gives the workspace the rest of the window: its top is measured (the link's bar may wrap on a
 * narrow page, the event's name may take two lines) instead of guessed, and the page's CSS takes it
 * from `--invite-top`.
 */
function useWorkspaceTop(head: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const bar = head.current
    const page = bar?.parentElement
    if (bar == null || page == null) return
    const measure = () => {
      const bottom = bar.getBoundingClientRect().bottom + window.scrollY
      page.style.setProperty('--invite-top', `${Math.round(bottom)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(bar)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
      page.style.removeProperty('--invite-top')
    }
  }, [head])
}

function Workspace({
  event,
  invite,
  onChanged,
}: {
  readonly event: EventDto
  /** The invitation as the server holds it. */
  readonly invite: GuestInviteDto
  readonly onChanged: (invite: GuestInviteDto) => void
}) {
  const text = useTranslations().guestInvite.host
  const all = useTranslations()
  const { locale } = useLocale()
  const slug = event.slug
  // An archived event is a record: the invitation cannot change any more.
  const archived = event.status === 'archived'
  const autosave = useInvitationAutosave({
    // The form is its own once it is mounted: an answer to an act (a new link, a switch) does
    // not rewrite what the host is typing.
    slug,
    invite,
    readerLanguage: event.settings.wallLanguage,
    onSaved: onChanged,
  })
  const look = useInviteLook(slug)
  // The replies' settings hang on the invitation: read again once it exists.
  const rsvp = useRsvpSettings(slug, `${invite.configured}|${invite.startsAt}|${invite.timeZone}`)
  const activateRef = useRef<HTMLButtonElement>(null)
  const ids = useId()
  const [big, setBig] = useState(false)
  const openGroups = useOpenGroups()
  const kept = useKeptStore()
  const head = useRef<HTMLDivElement>(null)
  useWorkspaceTop(head)
  const navigate = useNavigate()

  // Which panel is open, and which format the share panel shows, live in the address: a reload
  // or Back returns to the same screen.
  const [params, setParams] = useSearchParams()
  const panelParam = params.get('panel')
  const panel: PanelName | null =
    panelParam === 'reponses' || panelParam === 'partage' ? panelParam : null
  const formatParam = params.get('format')
  const output: OutputName = OUTPUTS.find((name) => name === formatParam) ?? 'print'
  /** What the preview shows: the card, the guest's page while the replies are set, the chosen format while sharing. */
  const previewOf: OutputName =
    panel === 'reponses' ? 'guest' : panel === 'partage' ? output : 'print'

  /** The panel was opened by the host in this visit: its title takes the focus, once. */
  const [openedHere, setOpenedHere] = useState(false)
  const stopFocusing = useCallback(() => setOpenedHere(false), [])
  /** The panel's address was pushed by a door in this visit, so closing it is one step back. */
  const pushed = useRef(false)
  const openPanel = (name: PanelName) => {
    setOpenedHere(true)
    pushed.current = true
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('panel', name)
      return next
    })
  }
  const closePanel = () => {
    // A panel the host opened is closed by going back, so Back does not reopen it; one that a
    // reload or a link brought is replaced. (A save waiting holds Back and would ask: replace then.)
    const waiting = autosave.state === 'pending' || autosave.state === 'saving'
    if (pushed.current && !waiting) {
      pushed.current = false
      void navigate(-1)
      return
    }
    pushed.current = false
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('panel')
        next.delete('format')
        return next
      },
      { replace: true },
    )
  }

  // The format's own component draws the switcher too, so changing format remounts it: the focus
  // is given back to the tab that was chosen once the new one is in the page.
  const refocus = useRef<OutputName | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    document.getElementById(`${ids}-tab-${refocus.current}`)?.focus()
    refocus.current = null
  }, [output, ids])
  const choose = (name: OutputName) => {
    // The tab that is already chosen: nothing is drawn again, so nothing is to be focused afterwards.
    if (name === output) return
    refocus.current = name
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('format', name)
        return next
      },
      { replace: true },
    )
  }

  // A panel that closes gives the focus back to the entry that opened it.
  const lastPanel = useRef<PanelName | null>(panel)
  useEffect(() => {
    const before = lastPanel.current
    lastPanel.current = panel
    if (before !== null && panel === null) {
      document.getElementById(`${ids}-entry-${before}`)?.focus()
    }
  }, [panel, ids])

  // What was typed and is not on the server yet exists nowhere else.
  useLeaveWarning(
    autosave.state === 'pending' ||
      autosave.state === 'saving' ||
      autosave.state === 'failed' ||
      autosave.state === 'invalid',
    text.leaveWarning,
  )

  // The formats need a link that works and a date to announce.
  const dated = invite.startsAt !== null
  const ready = invite.enabled && dated && invite.url !== null
  const draft = draftInvite(invite, autosave.form)
  const shown =
    ready && draft.url !== null && draft.startsAt !== null
      ? { ...draft, url: draft.url, startsAt: draft.startsAt }
      : null

  const names: Readonly<Record<OutputName, string>> = {
    print: text.tabPrint,
    image: text.tabImage,
    email: text.tabEmail,
    guest: text.tabGuest,
  }

  const move = (pressed: KeyboardEvent<HTMLButtonElement>) => {
    const last = OUTPUTS.length - 1
    const index = OUTPUTS.indexOf(output)
    const target =
      pressed.key === 'ArrowRight'
        ? (index + 1) % OUTPUTS.length
        : pressed.key === 'ArrowLeft'
          ? (index + last) % OUTPUTS.length
          : pressed.key === 'Home'
            ? 0
            : pressed.key === 'End'
              ? last
              : null
    if (target === null) return
    pressed.preventDefault()
    const next = OUTPUTS[target] ?? 'print'
    choose(next)
  }

  const focusStart = () =>
    document.querySelector<HTMLElement>('[data-field="start"] input')?.focus()

  const switcher = (
    <div className={styles['switcher']} role="tablist" aria-label={text.formatsLabel}>
      {OUTPUTS.map((name) => (
        <button
          key={name}
          id={`${ids}-tab-${name}`}
          type="button"
          role="tab"
          aria-selected={output === name}
          // Only the open one has a panel in the page, so only it says it controls one.
          {...(output === name ? { 'aria-controls': `${ids}-panel` } : {})}
          tabIndex={output === name ? 0 : -1}
          className={styles['tab']}
          onClick={() => choose(name)}
          onKeyDown={move}
        >
          {names[name]}
        </button>
      ))}
    </div>
  )

  const saveStatus = (named: boolean) => (
    <InvitationSaveStatus
      state={autosave.state}
      problem={autosave.problem}
      onRetry={autosave.saveNow}
      named={named}
    />
  )

  // The two entries' one-line summaries: what they hold now, readable without opening them.
  const settings = rsvp.settings
  const repliesSummary =
    settings === null
      ? rsvp.loadFailure === null
        ? '…'
        : text.repliesUnavailable
      : !settings.enabled
        ? all.rsvp.host.stateOff
        : text.repliesSummary(
            settings.deadline === null ? null : shortDay(settings.deadline, locale),
            optionCount(settings),
          )

  /** The left column on the card's own screen: the text, the look, and the two doors. */
  const cardColumn = (
    <div className={styles['cardColumn']}>
      <div className={styles['cardScroll']}>
        <InvitationText
          eventName={event.name}
          form={autosave.form}
          onChange={autosave.change}
          problem={autosave.problem}
          disabled={archived}
        />
        <section className={styles['look']} aria-labelledby={`${ids}-look`}>
          <h2 id={`${ids}-look`} className={styles['panelTitle']}>
            {text.lookTitle}
          </h2>
          {shown === null ? (
            <p className={styles['note']}>{text.lookLocked}</p>
          ) : (
            <AppearancePanel event={event} invite={shown} look={look} />
          )}
        </section>
      </div>
      <div className={styles['entries']}>
        <PanelEntry
          id={`${ids}-entry-reponses`}
          icon="mail"
          title={all.rsvp.host.title}
          summary={repliesSummary}
          onOpen={() => openPanel('reponses')}
        />
        <PanelEntry
          id={`${ids}-entry-partage`}
          icon="printer"
          title={text.sharePanelTitle}
          summary={text.entryShareSummary}
          onOpen={() => openPanel('partage')}
        />
      </div>
      <div className={styles['cardFooter']}>{saveStatus(false)}</div>
    </div>
  )

  const arrange =
    ({ side }: { readonly side: (slots: OutputSlots) => ReactNode }) =>
    (slots: OutputSlots) => (
      <div className={styles['workspace']} data-panel={panel ?? 'card'}>
        <div className={styles['side']}>{side(slots)}</div>
        <div className={styles['stage']}>
          {/* The panel is what is locked, not the tabs: a host can look at each, and is told why it is empty. */}
          <div
            className={styles['previewPane']}
            data-testid="invite-preview"
            data-big={big}
            data-locked={shown === null}
          >
            {slots.preview}
            {shown === null ? null : (
              <button
                type="button"
                className={styles['enlarge']}
                onClick={() => setBig((open) => !open)}
              >
                {big ? text.previewClose : text.previewEnlarge}
              </button>
            )}
          </div>
        </div>
      </div>
    )

  /** What stands where the card's column does, for the panel that is open (or the column itself). */
  const side = ({ options, actions }: OutputSlots): ReactNode => {
    if (panel === null) return cardColumn
    if (panel === 'reponses') {
      return (
        <RsvpPanel
          rsvp={rsvp}
          archived={archived}
          timeZone={invite.timeZone}
          onClose={closePanel}
          focusOnMount={openedHere}
          onFocused={stopFocusing}
          invitationStatus={saveStatus(true)}
        />
      )
    }
    return (
      <SidePanel
        id={SHARE_PANEL_ID}
        title={text.sharePanelTitle}
        onClose={closePanel}
        focusOnMount={openedHere}
        onFocused={stopFocusing}
        footer={
          <>
            {actions}
            {saveStatus(true)}
          </>
        }
      >
        {switcher}
        {/* The panel is what is locked, not the tabs: a host can look at each, and is told why it is empty. */}
        <div
          role="tabpanel"
          id={`${ids}-panel`}
          aria-labelledby={`${ids}-tab-${output}`}
          className={styles['options']}
        >
          {options ?? <p className={styles['note']}>{text.shareLocked}</p>}
        </div>
      </SidePanel>
    )
  }

  const Output = OUTPUT_TABS[previewOf]
  const layout = arrange({ side })

  return (
    <OpenGroupsProvider value={openGroups}>
      <KeptStateProvider value={kept}>
        <div ref={head} className={styles['head']}>
          <h1 className={styles['title']}>{text.title}</h1>
          <InvitationLink
            slug={slug}
            invite={invite}
            disabled={archived}
            onChanged={onChanged}
            activateRef={activateRef}
          />
        </div>

        {shown === null ? (
          layout({
            preview: (
              <LockedState
                dated={dated}
                typedStart={autosave.form.start !== ''}
                disabled={archived}
                onFocusStart={focusStart}
                onSaveStart={autosave.saveNow}
                onActivate={() => activateRef.current?.click()}
              />
            ),
            options: null,
            actions: null,
          })
        ) : (
          <Output
            event={event}
            invite={shown}
            preferences={look.preferences}
            onPreferences={look.update}
            photoUrl={look.photoUrl}
            cardOnly={panel === null}
            {...(rsvp.settings === null ? {} : { rsvp: previewPage(rsvp.settings) })}
          >
            {layout}
          </Output>
        )}
      </KeptStateProvider>
    </OpenGroupsProvider>
  )
}

/**
 * The middle column while the formats cannot be made: **two steps, and the action of the next
 * one**. A card with a QR code that leads nowhere is worse than no card, so nothing is drawn
 * before the invitation has a date and is switched on.
 */
function LockedState({
  dated,
  typedStart,
  disabled,
  onFocusStart,
  onSaveStart,
  onActivate,
}: {
  readonly dated: boolean
  /** The form holds a start that the server does not (yet). */
  readonly typedStart: boolean
  readonly disabled: boolean
  readonly onFocusStart: () => void
  readonly onSaveStart: () => void
  readonly onActivate: () => void
}) {
  const text = useTranslations().guestInvite.host
  return (
    <div className={styles['locked']} role="status">
      <h2 className={styles['lockedTitle']}>{text.lockedTitle}</h2>
      <p>{text.locked}</p>
      <ol className={styles['steps']}>
        <li data-done={dated}>{text.lockedStepDate}</li>
        <li data-done={false} data-current={dated}>
          {text.lockedStepActivate}
        </li>
      </ol>
      {dated ? (
        <Button key="activate" variant="primary" disabled={disabled} onClick={onActivate}>
          {text.activate}
        </Button>
      ) : typedStart ? (
        <Button key="save" variant="primary" disabled={disabled} onClick={onSaveStart}>
          {text.lockedDateSave}
        </Button>
      ) : (
        <Button key="focus" variant="primary" disabled={disabled} onClick={onFocusStart}>
          {text.lockedDateFocus}
        </Button>
      )}
    </div>
  )
}
