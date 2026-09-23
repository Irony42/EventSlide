import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Field } from '../../design-system/components/Field'
import { Spinner } from '../../design-system/components/Spinner'
import { StatusIcon } from '../../design-system/components/StatusIcon'
import { TextInput } from '../../design-system/components/TextInput'
import { themeSurfaceProps } from '../../design-system/eventTheme'
import { formatDateTime } from '../../lib/format'
import { ApiError } from '../../lib/http'
import { messageForCode, type UiText } from '../../lib/i18n/translations'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { GalleryViewer } from './components/GalleryViewer'
import { useGallery } from './hooks/useGallery'
import styles from './GalleryPage.module.css'

/**
 * The shared gallery, on whatever the link was opened on (roadmap §4.1). `/g/:token`.
 *
 * Surface: the guest's — or the aunt's who was not there, since links get forwarded. It
 * is read in the **reader's** language, like the rest of the guest surface, and it wears
 * the event's accent and material, like the upload screen; the event's name and every
 * caption are content and are shown exactly as written.
 *
 * Four screens, one per answer the server can give: the album, a password form, "this
 * link is not available" — one sentence for every way a link can die, because the server
 * gives one answer for all of them — and a failure with a retry.
 *
 * `<meta name="robots">` on every one of them, hoisted to the document head by React:
 * the server already sends `X-Robots-Tag`, and a crawler that reads only markup is told
 * the same thing.
 */

const Robots = () => <meta name="robots" content="noindex,nofollow" />

const sentenceFor = (cause: unknown, text: UiText): string =>
  cause instanceof ApiError ? messageForCode(cause.code, text) : text.errors.unknown

export function GalleryPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { token = '' } = useParams()
  const state = useGallery(token)
  const [password, setPassword] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  if (state.phase === 'loading') {
    return (
      <div className={styles['centered']}>
        <Robots />
        <Spinner size="lg" label={t.gallery.opening} />
      </div>
    )
  }

  if (state.phase === 'unavailable') {
    return (
      <Card as="h1" title={t.gallery.unavailableTitle} className={styles['card']}>
        <Robots />
        <p className={styles['hint']}>{t.gallery.unavailableHint}</p>
      </Card>
    )
  }

  if (state.phase === 'locked') {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      // Not trimmed: spaces are legitimate characters in a passphrase, as the host's
      // own password field already treats them.
      if (password.length > 0) void state.unlock(password)
    }
    const failure = state.unlockFailure === null ? null : sentenceFor(state.unlockFailure, t)
    return (
      <Card as="h1" title={t.gallery.lockedTitle} className={styles['card']}>
        <Robots />
        <form className={styles['form']} onSubmit={submit} noValidate>
          <p className={styles['hint']}>{t.gallery.lockedHint}</p>
          <Field label={t.gallery.passwordLabel} {...(failure === null ? {} : { error: failure })}>
            {(control) => (
              <TextInput
                {...control}
                type="password"
                name="galleryPassword"
                autoComplete="current-password"
                enterKeyHint="go"
                required
                value={password}
                onChange={(changed) => setPassword(changed.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={state.unlocking}
            disabled={password.length === 0}
          >
            {t.gallery.unlock}
          </Button>
        </form>
      </Card>
    )
  }

  if (state.phase === 'failed' || state.gallery === null) {
    return (
      <Card as="h1" title={t.gallery.title} className={styles['card']}>
        <Robots />
        <p className={styles['error']} role="alert">
          <StatusIcon tone="danger" />
          {sentenceFor(state.failure, t)}
        </p>
        <Button variant="secondary" onClick={state.retry}>
          {t.app.retry}
        </Button>
      </Card>
    )
  }

  const { gallery, items } = state
  const until = formatDateTime(gallery.expiresAt, locale)
  const viewing = open === null ? null : (items[open] ?? null)

  return (
    <div {...themeSurfaceProps(gallery.theme, 'guest')} className={styles['page']}>
      <Robots />
      <header className={styles['header']}>
        {/* Content: the host's own name for their evening. */}
        <h1 className={styles['title']}>{gallery.eventName}</h1>
        <p className={styles['facts']}>
          <span>{t.gallery.photoCount(gallery.photoCount)}</span>
          {until === null ? null : <span>{t.gallery.availableUntil(until)}</span>}
        </p>
        <p className={styles['hint']}>{t.gallery.privacyNote}</p>
      </header>

      {items.length === 0 ? (
        <EmptyState as="h2" title={t.gallery.empty} />
      ) : (
        <ul className={styles['grid']}>
          {items.map((photo, index) => (
            <li key={photo.id} className={styles['tile']}>
              <button
                type="button"
                className={styles['open']}
                aria-label={t.gallery.openPhoto(index + 1)}
                aria-haspopup="dialog"
                onClick={() => setOpen(index)}
              >
                {/* Decorative inside a labelled button: the viewer carries the caption. */}
                <img
                  className={styles['thumb']}
                  src={photo.previewUrl}
                  alt=""
                  loading="lazy"
                  width={photo.width}
                  height={photo.height}
                />
                {photo.kind === 'clip' ? (
                  <span className={styles['badge']}>
                    <Badge tone="neutral">{t.gallery.clipBadge}</Badge>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {state.failure === null ? null : (
        <p className={styles['error']} role="alert">
          <StatusIcon tone="danger" />
          {sentenceFor(state.failure, t)}
        </p>
      )}

      {state.hasMore ? (
        <div className={styles['more']}>
          <Button
            variant="secondary"
            loading={state.loadingMore}
            onClick={() => void state.loadMore()}
          >
            {t.gallery.loadMore}
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? null : (
        <div className={styles['bar']}>
          {/* A link, not a fetch: the archive is streamed and can be gigabytes. */}
          <a className={styles['downloadAll']} href={gallery.archiveUrl} download>
            {t.gallery.downloadAll}
          </a>
        </div>
      )}

      <GalleryViewer
        photo={viewing}
        position={(open ?? 0) + 1}
        total={gallery.photoCount}
        onClose={() => setOpen(null)}
      />
    </div>
  )
}
