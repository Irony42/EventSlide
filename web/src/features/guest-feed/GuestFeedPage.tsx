import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import { themeSurfaceProps } from '../../design-system/eventTheme'
import { readGuestSession } from '../../lib/guestSession'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { ReactionBar } from './components/ReactionBar'
import { usePhotoFeed } from './hooks/usePhotoFeed'
import type { PublicEventDto, WallItemDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'
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

  return (
    <EmptyState
      as="h1"
      title={t.upload.notJoinedTitle}
      description={t.upload.notJoinedHint}
      action={
        <Link className={styles['rejoin']} to="/join">
          {t.upload.notJoinedAction}
        </Link>
      }
    />
  )
}

/**
 * The caption and the sender, said for a screen reader: the caption is what a guest wrote and
 * is passed through untouched, and the frame around the sender is the product's.
 */
const altFor = (item: WallItemDto, t: UiText): string =>
  item.caption ??
  (item.authorName === null ? t.wall.photoByAnonymous : t.wall.photoBy(item.authorName))

interface FeedScreenProps {
  readonly slug: string
  readonly event: PublicEventDto
}

function FeedScreen({ slug, event }: FeedScreenProps) {
  const t = useTranslations()
  const feed = usePhotoFeed(slug)
  const [shown, setShown] = useState(PAGE_SIZE)

  const items = feed.items ?? []
  const visible = items.slice(0, shown)

  return (
    <div {...themeSurfaceProps(event.theme, 'guest')} className={styles['page']}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>{t.feed.title}</h1>
        <p className={styles['event']}>{event.name}</p>
        <div className={styles['actions']}>
          <Link className={styles['link']} to={`/e/${slug}/upload`}>
            {t.feed.back}
          </Link>
          <Button variant="ghost" size="sm" onClick={feed.refresh}>
            {t.feed.refresh}
          </Button>
        </div>
      </header>

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

      {feed.settling ? (
        <div className={styles['loading']}>
          <Spinner label={t.app.loading} />
        </div>
      ) : null}

      {!feed.settling && feed.items !== null && items.length === 0 ? (
        <EmptyState as="h2" title={t.feed.empty} description={t.feed.emptyHint} />
      ) : null}

      {!feed.settling && visible.length > 0 ? (
        <ul className={styles['list']}>
          {visible.map((item, index) => (
            <li key={item.id} className={styles['card']}>
              <img
                className={styles['photo']}
                src={item.thumbUrl}
                width={item.width}
                height={item.height}
                alt={altFor(item, t)}
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
        <Button variant="secondary" block onClick={() => setShown((count) => count + PAGE_SIZE)}>
          {t.feed.more}
        </Button>
      ) : null}
    </div>
  )
}
