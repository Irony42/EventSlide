import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../design-system/components/Badge'
import { Button } from '../design-system/components/Button'
import { Icon, type IconName } from '../design-system/components/Icon'
import { NewTabLink } from '../design-system/components/NewTabLink'
import { DEFAULT_EVENT_THEME, themeSurfaceProps } from '../design-system/eventTheme'
import type { GuestInvitePageDto } from '../lib/api/dto'
import { DEFAULT_LOCALE, parseLocale } from '../lib/i18n/locale'
import { useTranslations } from '../lib/i18n/useTranslations'
import { icsOf, itineraryHref, whenParts } from '../lib/invite/inviteTexts'
import { GuestRsvpBlock } from './guestRsvp/GuestRsvpBlock'
import styles from './GuestInvitation.module.css'

/**
 * What a guest reads at the invitation's link (spec 29), as a component of its own: the guest's
 * page (`/i/:token`) shows it, and so does the host's "Invitations" page, in a phone frame, from
 * what the host is typing. It lives in `app/` because a feature may not import another feature.
 *
 * It only draws a `GuestInvitePageDto`: where the page comes from (the server's answer, or the
 * host's draft) is the caller's business. The server's `state` is shown, never recomputed.
 */

/** Where the person who sees something wrong is sent: the operator's contact on the About page. */
const REPORT_TO = '/about#about-operator-title'

/** "Léa fête ses 40 ans" is `LF`: the first letters of the first two words, upper case. */
const initialsOf = (title: string): string =>
  title
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toLocaleUpperCase()

const viewerTimeZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone

/** A file of the browser's own making: nothing is sent anywhere. */
const downloadCalendar = (ics: string): void => {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'invitation.ics' })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function Item({
  icon,
  label,
  children,
}: {
  readonly icon: IconName
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div className={styles['item']}>
      <Icon name={icon} />
      <div>
        <p className={styles['label']}>{label}</p>
        {children}
      </div>
    </div>
  )
}

/** The line under the invitation: where to report it, and who made it. */
function GuestInvitationFooter() {
  const t = useTranslations().guestInvite.page
  return (
    <div className={styles['foot']}>
      <Link to={REPORT_TO} className={styles['footLink']}>
        {t.report}
      </Link>
      <span>{t.madeWith}</span>
    </div>
  )
}

export interface GuestInvitationProps {
  readonly page: GuestInvitePageDto
  readonly token: string
  /** The instant the page is read at, for "the hour has come and the wall is not open". */
  readonly readAt: number
  /**
   * Whether the answering block reads and sends (spec 30). `false` in the host's preview, which
   * draws it and does nothing more.
   */
  readonly interactive?: boolean
  /** A name to fill the form with in the host's preview, which shows it open on a "yes" (spec 30). */
  readonly previewName?: string
}

export function GuestInvitation({
  page,
  token,
  readAt,
  interactive = true,
  previewName,
}: GuestInvitationProps) {
  const t = useTranslations().guestInvite.page
  const lang = parseLocale(page.language) ?? DEFAULT_LOCALE
  const parts = useMemo(() => whenParts(page.when, lang, viewerTimeZone()), [page.when, lang])
  const directions = itineraryHref(page.venueName, page.address ?? null)
  const hasPlace = page.venueName !== null || (page.address ?? null) !== null
  // A logo that does not load (the file is gone) leaves the initials, not a broken image.
  const [logoBroken, setLogoBroken] = useState(false)
  const opened = page.state === 'joinable'
  // A party whose hour has come and that its host has not opened: say so rather than "tonight".
  const hourPassed = Date.parse(page.when.startsAt) <= readAt

  const addToCalendar = () =>
    downloadCalendar(
      icsOf(
        {
          token,
          title: page.title,
          when: page.when,
          venueName: page.venueName,
          address: page.address ?? null,
          message: page.message ?? null,
        },
        window.location.href.split('#')[0] ?? window.location.href,
        new Date(),
      ),
    )

  return (
    <article
      className={styles['page']}
      // The event's colour, as every guest surface wears it: nothing when it is the product's own.
      {...themeSurfaceProps({ ...DEFAULT_EVENT_THEME, accentHue: page.accentHue }, 'guest')}
    >
      <header className={styles['head']}>
        {page.logoUrl === undefined || logoBroken ? (
          <span className={styles['mark']} aria-hidden="true">
            {initialsOf(page.title)}
          </span>
        ) : (
          <img
            className={styles['logo']}
            src={page.logoUrl}
            alt={t.logoAlt(page.title)}
            onError={() => setLogoBroken(true)}
          />
        )}
        <p className={styles['eyebrow']}>{t.eyebrow}</p>
        <h1 className={styles['title']}>{page.title}</h1>
      </header>

      {opened ? (
        <>
          <Badge tone="success">{t.live}</Badge>
          {page.joinUrl === undefined ? null : (
            <Link to={page.joinUrl} className={styles['join']}>
              {t.join}
            </Link>
          )}
        </>
      ) : null}

      <section className={styles['card']}>
        <Item icon="calendar" label={t.when}>
          <p className={styles['day']}>{parts.day}</p>
          <p className={styles['sub']}>{parts.hours}</p>
          {parts.viewer === null ? null : (
            <p className={styles['otherZone']}>
              {t.otherTz(parts.viewer.when, parts.viewer.place)}
            </p>
          )}
        </Item>
        {hasPlace ? (
          <Item icon="pin" label={t.where}>
            {page.venueName === null ? null : <p className={styles['main']}>{page.venueName}</p>}
            {(page.address ?? null) === null ? null : (
              <p className={styles['sub']}>{page.address}</p>
            )}
            {directions === null || page.state === 'over' ? null : (
              <NewTabLink href={directions} className={styles['directions']}>
                {t.itinerary}
              </NewTabLink>
            )}
          </Item>
        ) : null}
      </section>

      {(page.message ?? null) === null ? null : <p className={styles['message']}>{page.message}</p>}

      {/* Serez-vous là ? Asked while the host asks it, and kept reachable (the reply, its deletion) after. */}
      <GuestRsvpBlock
        rsvp={page.rsvp}
        token={token}
        locale={lang}
        interactive={interactive}
        {...(previewName === undefined ? {} : { previewName })}
      />

      {page.state === 'upcoming' ? (
        <>
          <Button variant="secondary" size="lg" block onClick={addToCalendar}>
            {t.agenda}
          </Button>
          <p className={styles['hint']}>
            <Icon name="camera" />
            <span>{hourPassed ? t.notOpen : t.tonight}</span>
          </p>
        </>
      ) : null}

      {page.state === 'over' ? (
        <p className={styles['hint']}>
          <Icon name="camera" />
          <span>{t.over}</span>
        </p>
      ) : null}

      <GuestInvitationFooter />
    </article>
  )
}
