import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Icon, type IconName } from '../../design-system/components/Icon'
import { NewTabLink } from '../../design-system/components/NewTabLink'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import type { GuestInvitePageDto } from '../../lib/api/dto'
import { useAnnounceLocale } from '../../lib/i18n/deferredLocale'
import { DEFAULT_LOCALE, parseLocale } from '../../lib/i18n/locale'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { DEFAULT_EVENT_THEME, themeSurfaceProps } from '../../design-system/eventTheme'
import { icsOf, itineraryHref, whenParts } from '../../lib/invite/inviteTexts'
import { useGuestInvite } from './hooks/useGuestInvite'
import styles from './GuestInvitePage.module.css'

/**
 * The invitation a guest opens from a link or a QR code (spec 29). `/i/:token`.
 *
 * Surface: the guest's, before the party. Nobody signs in and nothing is asked: no cookie of its
 * own, no count of visits. **One page, four screens, and the server picks** (`state`): before the
 * party, during it (a big button into the wall), after it (the date and no address, no word), and
 * "not available", one sentence for every way a link can die.
 *
 * It is read in **the invitation's language**, not the browser's: the host chose the language the
 * invitation speaks, and a guest opening it in another is the reason it has one. The host's
 * title, place and word are content, shown exactly as written, never as a link; the one outgoing
 * link, the directions, is built here with the address encoded.
 *
 * `<meta name="robots">` on every screen, hoisted to the head by React: the server already sends
 * `X-Robots-Tag`, and a crawler that reads only markup is told the same thing.
 */

const Robots = () => <meta name="robots" content="noindex,nofollow" />

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

function Footer() {
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

function Invitation({
  page,
  token,
  readAt,
}: {
  readonly page: GuestInvitePageDto
  readonly token: string
  readonly readAt: number
}) {
  const t = useTranslations().guestInvite.page
  const lang = parseLocale(page.language) ?? DEFAULT_LOCALE
  const parts = useMemo(() => whenParts(page.when, lang, viewerTimeZone()), [page.when, lang])
  const directions = itineraryHref(page.venueName, page.address ?? null)
  const hasPlace = page.venueName !== null || (page.address ?? null) !== null
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
      <Robots />
      <header className={styles['head']}>
        {page.logoUrl === undefined ? (
          <span className={styles['mark']} aria-hidden="true">
            {initialsOf(page.title)}
          </span>
        ) : (
          <img className={styles['logo']} src={page.logoUrl} alt={t.logoAlt(page.title)} />
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

      <Footer />
    </article>
  )
}

export function GuestInvitePage() {
  const t = useTranslations().guestInvite.page
  const { token = '' } = useParams()
  const state = useGuestInvite(token)
  const announce = useAnnounceLocale()
  // The language the page is in is the invitation's; until it is known, the surface's own.
  const language = state.page === null ? null : parseLocale(state.page.language)
  useEffect(() => {
    if (language !== null) announce(language)
  }, [announce, language])

  if (state.phase === 'loading') {
    return (
      <div className={styles['centered']}>
        <Robots />
        <Spinner size="lg" label={t.loading} />
      </div>
    )
  }

  if (state.phase === 'failed') {
    return (
      <div className={styles['page']}>
        <Robots />
        <Notice tone="danger" variant="boxed" role="alert">
          {t.failed}
        </Notice>
        <Button variant="secondary" size="lg" block onClick={state.retry}>
          {t.retry}
        </Button>
      </div>
    )
  }

  if (state.phase === 'unavailable' || state.page === null) {
    return (
      <div className={styles['page']}>
        <Robots />
        <EmptyState
          as="h1"
          icon={<Icon name="mail-off" />}
          title={t.gone}
          description={t.goneSub}
        />
        <div className={styles['foot']}>
          <span>{t.madeWith}</span>
        </div>
      </div>
    )
  }

  return <Invitation page={state.page} token={token} readAt={state.readAt} />
}
