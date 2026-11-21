import { useCallback, useId, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../../app/HostBreadcrumb'
import { HostEventsLink } from '../../../app/HostEventsLink'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Notice } from '../../../design-system/components/Notice'
import type { EventDto, GuestInviteDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { canManageEvent } from '../../../lib/eventLifecycle'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useEvent } from '../hooks/useEventData'
import { InvitationFormPanel } from './InvitationForm'
import { InvitationLink } from './InvitationLink'
import { EmailTab } from './tabs/EmailTab'
import { ImageTab } from './tabs/ImageTab'
import { PrintTab } from './tabs/PrintTab'
import styles from './InvitationsPage.module.css'

type TabName = 'print' | 'image' | 'email'
const TABS: readonly TabName[] = ['print', 'image', 'email']

/**
 * The host's "Invitations" page (spec 29): the invitation's text and link on the left, the three
 * formats (print, image, e-mail) on the right.
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
      <HostBreadcrumb slug={slug} page="invitations" eventName={event.name} />
      <h1 className={styles['title']}>{t.guestInvite.host.title}</h1>
      {canManageEvent(event.role) ? (
        <OwnerPanels event={event} />
      ) : (
        <div className={styles['single']}>
          <Notice tone="warning" role="status" variant="boxed">
            {t.guestInvite.host.ownerOnly}
          </Notice>
          <Link to={`/admin/events/${slug}`}>{t.admin.printKitBack}</Link>
        </div>
      )}
    </div>
  )
}

function OwnerPanels({ event }: { readonly event: EventDto }) {
  const t = useTranslations()
  const api = useApi()
  const slug = event.slug
  const load = useCallback((signal: AbortSignal) => api.guestInvite(slug, signal), [api, slug])
  const { data, loading, error, reload, replace } = useLoader(load)

  const adopt = (guestInvite: GuestInviteDto) => replace({ guestInvite })

  if (data === null && loading) return <Pending label={t.admin.eventLoading} />
  if (data === null) {
    return (
      <div className={styles['single']}>
        <LoadFailure message={error ?? t.guestInvite.host.loadFailed} onRetry={reload} />
      </div>
    )
  }

  const invite = data.guestInvite
  // An archived event is a record: the invitation cannot change any more.
  const archived = event.status === 'archived'
  // The formats need a link that works and a date to announce.
  const ready = invite.enabled && invite.startsAt !== null && invite.url !== null

  return (
    <div className={styles['layout']}>
      <div className={styles['column']}>
        <InvitationFormPanel
          // The form is its own once it is mounted: an answer to an act (a new link, a switch) does
          // not rewrite what the host is typing.
          slug={slug}
          eventName={event.name}
          invite={invite}
          readerLanguage={event.settings.wallLanguage}
          disabled={archived}
          onSaved={adopt}
        />
        <InvitationLink slug={slug} invite={invite} disabled={archived} onChanged={adopt} />
      </div>
      <FormatTabs event={event} invite={ready ? invite : null} />
    </div>
  )
}

/**
 * The three formats, as tabs (WAI-ARIA tabs: arrows move between them). Greyed out, with one
 * sentence, until the invitation is switched on and has a date: a card with a QR code that leads
 * nowhere is worse than no card.
 */
function FormatTabs({
  event,
  invite,
}: {
  readonly event: EventDto
  readonly invite: GuestInviteDto | null
}) {
  const text = useTranslations().guestInvite.host
  const [tab, setTab] = useState<TabName>('print')
  const ids = useId()
  const names: Readonly<Record<TabName, string>> = {
    print: text.tabPrint,
    image: text.tabImage,
    email: text.tabEmail,
  }

  const move = (pressed: KeyboardEvent<HTMLButtonElement>) => {
    const last = TABS.length - 1
    const index = TABS.indexOf(tab)
    const target =
      pressed.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : pressed.key === 'ArrowLeft'
          ? (index + last) % TABS.length
          : pressed.key === 'Home'
            ? 0
            : pressed.key === 'End'
              ? last
              : null
    if (target === null) return
    pressed.preventDefault()
    const next = TABS[target] ?? 'print'
    setTab(next)
    document.getElementById(`${ids}-tab-${next}`)?.focus()
  }

  const ready = invite !== null && invite.url !== null && invite.startsAt !== null
  const shown = ready ? { ...invite, url: invite.url, startsAt: invite.startsAt } : null

  return (
    <section className={styles['panel']} aria-label={text.formatsLabel}>
      <div className={styles['tabs']} role="tablist" aria-label={text.formatsLabel}>
        {TABS.map((name) => (
          <button
            key={name}
            id={`${ids}-tab-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            // Only the open tab has a panel in the page, so only it says it controls one.
            {...(tab === name ? { 'aria-controls': `${ids}-panel` } : {})}
            tabIndex={tab === name ? 0 : -1}
            className={styles['tab']}
            onClick={() => setTab(name)}
            onKeyDown={move}
          >
            {names[name]}
          </button>
        ))}
      </div>
      {/* The panel is what is locked, not the tabs: a host can look at each, and is told why it is empty. */}
      <div
        role="tabpanel"
        id={`${ids}-panel`}
        aria-labelledby={`${ids}-tab-${tab}`}
        className={styles['tabPanel']}
      >
        {shown === null ? (
          <p className={styles['locked']} role="status">
            {text.locked}
          </p>
        ) : tab === 'print' ? (
          <PrintTab event={event} invite={shown} />
        ) : tab === 'image' ? (
          <ImageTab event={event} invite={shown} />
        ) : (
          <EmailTab event={event} invite={shown} />
        )}
      </div>
    </section>
  )
}
