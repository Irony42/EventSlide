import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import { themeSurfaceProps } from '../../design-system/eventTheme'
import { RootGroundHue } from '../../design-system/useRootGroundHue'
import { forgetGuestSession, readGuestSession } from '../../lib/guestSession'
import { photoAlt } from '../../lib/photoAlt'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { ReactionBar } from './components/ReactionBar'
import { usePhotoFeed } from './hooks/usePhotoFeed'
import type { PublicEventDto } from '../../lib/api/dto'
import styles from './GuestFeedPage.module.css'

/**
 * `/e/:slug/photos`: "Les photos de la soirée".
 *
 * What the room is looking at, on the guest's phone, with the five reactions under every
 * photograph that is somebody else's. It is a page of its own rather than a section of the
 * upload screen because the upload screen's job is to keep its controls under the thumb: a
 * list that grows all evening would push them off the bottom of the phone.
 *
 * Like the upload screen it works from the session the join wrote — there is no readable
 * "event by slug" — and a guest who arrives without one is sent to join.
 */

/** Photographs shown at a time. Twelve thumbnails is a screen and a half on a phone. */
const PAGE_SIZE = 12

export function GuestFeedPage() {
  const { slug } = useParams()
  const session = useMemo(() => (slug === undefined ? null : readGuestSession(slug)), [slug])

  if (slug === undefined || session === null) return <NotJoined />

  return <FeedScreen slug={slug} event={session.event} />
}

/** Reached by a bookmark, or after the tab was closed and reopened. */
function NotJoined() {
  const t = useTranslations()
  const { pathname } = useLocation()

  return (
    <EmptyState
      as="h1"
      title={t.upload.notJoinedTitle}
      description={t.upload.notJoinedHint}
      action={
        // Where the guest was heading, so the code entry returns here and not to the upload screen.
        <Link className={styles['rejoin']} to="/join" state={{ from: pathname }}>
          {t.upload.notJoinedAction}
        </Link>
      }
    />
  )
}

interface FeedScreenProps {
  readonly slug: string
  readonly event: PublicEventDto
}

function FeedScreen({ slug, event }: FeedScreenProps) {
  const t = useTranslations()
  const feed = usePhotoFeed(slug)
  const navigate = useNavigate()
  // The feed stays readable, but the device must stop resuming an event the server no longer
  // knows this phone for.
  const signedOut = feed.signedOut
  useEffect(() => {
    if (signedOut) forgetGuestSession(slug)
  }, [signedOut, slug])
  const [shown, setShown] = useState(PAGE_SIZE)

  const items = feed.items ?? []
  const visible = items.slice(0, shown)

  /**
   * Where focus goes when "Voir plus" is pressed: the first photograph it added.
   *
   * On the last page the button unmounts under the finger that pressed it, and focus would
   * fall to `<body>` — the top of a long page. A ref and an effect that only moves focus: no
   * state is set from the effect.
   */
  const list = useRef<HTMLUListElement | null>(null)
  const focusIndex = useRef<number | null>(null)
  useEffect(() => {
    if (focusIndex.current === null) return
    const target = list.current?.children.item(focusIndex.current)
    focusIndex.current = null
    if (target instanceof HTMLElement) target.focus()
  }, [shown])

  return (
    // The wall's answer once it has one, the join's stored copy until then: a host's later change
    // reaches a guest who joined before it on this read, which the feed makes anyway.
    <div {...themeSurfaceProps(feed.theme ?? event.theme, 'guest')} className={styles['page']}>
      <RootGroundHue theme={feed.theme ?? event.theme} />
      <header className={styles['header']}>
        <h1 className={styles['title']}>{t.feed.title}</h1>
        <p className={styles['event']}>{event.name}</p>
        <div className={styles['actions']}>
          <Link className={styles['link']} to={`/e/${slug}/upload`}>
            {t.feed.back}
          </Link>
          {feed.unavailable ? null : (
            <Button variant="ghost" size="sm" loading={feed.refreshing} onClick={feed.refresh}>
              {t.feed.refresh}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={styles['notYours']}
          onClick={() => {
            forgetGuestSession(slug)
            navigate('/join')
          }}
        >
          {t.join.notYourEvening}
        </Button>
      </header>

      {feed.unavailable ? (
        <EmptyState as="h2" title={t.feed.unavailable} description={t.feed.unavailableHint} />
      ) : null}

      {feed.items === null && feed.error !== null ? (
        <div className={styles['failure']}>
          <Notice tone="danger" variant="inline" role="alert">
            {t.feed.failed}
          </Notice>
          <Button variant="secondary" onClick={feed.refresh}>
            {t.app.retry}
          </Button>
        </div>
      ) : null}

      {/* A refresh that failed: what is on screen is older than the guest asked for, and
          they were waiting on the answer. */}
      {feed.items !== null && feed.error !== null ? (
        <Notice tone="danger" variant="inline" role="alert">
          {t.feed.failed}
        </Notice>
      ) : null}

      {feed.settling ? (
        <div className={styles['loading']}>
          <Spinner label={t.app.loading} />
        </div>
      ) : null}

      {!feed.settling && feed.items !== null && items.length === 0 ? (
        <EmptyState as="h2" title={t.feed.empty} description={t.feed.emptyHint} />
      ) : null}

      {!feed.settling && visible.length > 0 ? (
        <ul ref={list} className={styles['list']}>
          {visible.map((item, index) => (
            <li key={item.id} tabIndex={-1} className={styles['card']}>
              <img
                className={styles['photo']}
                src={item.thumbUrl}
                width={item.width}
                height={item.height}
                alt={photoAlt(item, t)}
                loading="lazy"
                decoding="async"
              />
              <div className={styles['meta']}>
                {item.kind === 'clip' ? (
                  <Badge tone="neutral">{t.upload.mineClipBadge}</Badge>
                ) : null}
                {feed.ownIds.has(item.id) ? <Badge tone="accent">{t.feed.own}</Badge> : null}
                {item.authorName === null ? null : (
                  <span className={styles['author']}>{item.authorName}</span>
                )}
              </div>
              {feed.reactionsEnabled && !feed.ownIds.has(item.id) ? (
                <ReactionBar slug={slug} photoId={item.id} position={index + 1} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!feed.settling && items.length > visible.length ? (
        <Button
          variant="secondary"
          block
          onClick={() => {
            focusIndex.current = visible.length
            setShown((count) => count + PAGE_SIZE)
          }}
        >
          {t.feed.more}
        </Button>
      ) : null}
    </div>
  )
}
