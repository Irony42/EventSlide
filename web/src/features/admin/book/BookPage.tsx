import { useCallback, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { Dialog } from '../../../design-system/components/Dialog'
import { Notice } from '../../../design-system/components/Notice'
import { useToast } from '../../../design-system/components/useToast'
import type { ThemeAmbiance } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useEvent } from '../hooks/useEventData'
import {
  useAlbumBook,
  useDeleteAlbumBook,
  useRequestAlbumBook,
  type AlbumBookRead,
} from '../hooks/useAlbumBook'
import { BookBuild } from './BookBuild'
import { BookSettings } from './BookSettings'
import { BookViewer, type BookViewerFocus } from './BookViewer'
import {
  SHEET_WANTED,
  initialChoices,
  optionsOf,
  type BookChoices,
  type BookLimits,
  type LookAt,
} from './bookOptions'
import { useBookPreview } from './useBookPreview'
import styles from './BookPage.module.css'
import { useInsideEventLayout } from '../../../app/eventChrome'

/**
 * The photo book (spec 04, spec 26) on a page of its own: the settings on one side, the book itself on
 * the other, drawn from the plan the server makes with the code that makes the PDF.
 *
 * Audience: the host and the moderators, on a laptop or on a phone. Every setting changes the book
 * at once (debounced); the preview never scrolls away (pinned beside the settings, or on top of them
 * on a phone); the button that makes the book is always in reach. States no rule: what is possible
 * (every photograph, the printer version, the guest book) comes from the server's `offer` and the
 * album's counts, and its refusals are shown as the sentence for their code.
 */
export function BookPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  // Keyed by the event: the settings are read once, when the page opens on an event.
  return <BookLoader key={slug} slug={slug} />
}

function BookLoader({ slug }: { readonly slug: string }) {
  const t = useTranslations()
  const event = useEvent(slug)
  const book = useAlbumBook(slug)

  if (event.error !== null || book.error !== null) {
    return (
      <div className={styles['page']}>
        <LoadFailure
          message={event.error ?? book.error ?? ''}
          onRetry={() => {
            event.reload()
            book.reload()
          }}
        />
      </div>
    )
  }
  if (event.data === null || book.data === null) {
    return (
      <div className={styles['page']}>
        <Pending label={t.app.loading} />
      </div>
    )
  }
  if (book.data === 'unsupported') {
    return (
      <div className={styles['page']}>
        <Notice tone="warning" variant="boxed">
          {t.bookPage.unsupported}
        </Notice>
      </div>
    )
  }
  return (
    <Workspace
      slug={slug}
      event={{ name: event.data.name, ambiance: event.data.settings.theme.ambiance }}
      book={book.data}
      reload={book.reload}
    />
  )
}

interface WorkspaceProps {
  readonly slug: string
  readonly event: { readonly name: string; readonly ambiance: ThemeAmbiance }
  readonly book: Exclude<AlbumBookRead, 'unsupported'>
  readonly reload: () => void
}

function Workspace({ slug, event, book, reload }: WorkspaceProps) {
  const t = useTranslations()
  const inside = useInsideEventLayout()
  const toast = useToast()
  const request = useRequestAlbumBook()
  const remove = useDeleteAlbumBook()

  const limits: BookLimits = {
    photos: book.albumCounts.photos,
    messages: book.albumCounts.messages,
    maxPhotos: book.offer.maxPhotos,
    maxMessages: book.offer.maxMessages,
    printOffered: book.offer.printVersion,
  }
  const [choices, setChoices] = useState<BookChoices>(() =>
    initialChoices(book.status === 'none' ? null : book, event, limits.photos, limits.maxPhotos),
  )
  const [face, setFace] = useState(0)
  const [focus, setFocus] = useState<BookViewerFocus | undefined>(undefined)
  const [big, setBig] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { printVersion, ...asked } = optionsOf(choices, limits)
  const preview = useBookPreview(slug, asked)

  const change = useCallback((patch: Partial<BookChoices>, look?: LookAt) => {
    setChoices((current) => ({ ...current, ...patch }))
    if (look !== undefined) {
      setFocus((current) => ({ nonce: (current?.nonce ?? 0) + 1, wanted: SHEET_WANTED[look] }))
    }
  }, [])

  const empty = preview.code === 'book.empty'
  const ready = !empty && choices.title.trim() !== ''

  const submit = (submitted: FormEvent) => {
    submitted.preventDefault()
    if (!ready) return
    void request.run('request', slug, { ...asked, printVersion }).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      reload()
    })
  }

  const confirmDelete = () => {
    void remove.run('delete', slug).then((result) => {
      setDeleting(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      reload()
    })
  }

  const viewer = preview.preview
  const style = viewer === null ? '' : t.admin.bookStyleNames[viewer.style]

  return (
    <div className={styles['page']}>
      <header className={styles['head']}>
        {/* Under the event's menu the way back is the menu's. */}
        {inside ? null : (
          <Link to={`/admin/events/${encodeURIComponent(slug)}`} className={styles['back']}>
            {t.bookPage.back}
          </Link>
        )}
        <h1 className={styles['title']}>{t.admin.book}</h1>
      </header>

      <div className={styles['grid']}>
        <form className={styles['settings']} onSubmit={submit} noValidate>
          <div className={styles['fields']}>
            <BookSettings
              choices={choices}
              limits={limits}
              fromWall={book.status === 'none'}
              onChange={change}
            />
          </div>
          <div className={styles['action']}>
            <BookBuild
              slug={slug}
              book={book}
              ready={ready}
              busy={request.busy}
              onDelete={() => setDeleting(true)}
            />
          </div>
        </form>

        <section
          className={styles['preview']}
          aria-label={t.bookPage.previewLabel}
          aria-busy={preview.pending}
        >
          <div className={styles['summary']}>
            <span className={styles['count']}>
              {viewer === null
                ? ''
                : t.bookPage.summary(viewer.pageCount, viewer.photoCount, style)}
            </span>
            <span className={styles['busy']} role="status" aria-live="polite">
              {preview.pending && viewer !== null ? t.bookPage.refreshing : ''}
            </span>
            {viewer === null ? null : (
              <Button
                variant="secondary"
                size="sm"
                className={styles['bigButton']}
                onClick={() => setBig(true)}
              >
                {t.bookPage.big}
              </Button>
            )}
          </div>

          <div className={styles['stage']}>
            {viewer !== null && !empty ? (
              <BookViewer
                preview={viewer}
                face={face}
                onFace={setFace}
                focus={focus}
                settled={!preview.pending}
                strip
              />
            ) : (
              <div className={styles['placeholder']}>
                {empty ? (
                  <p>{t.bookPage.empty}</p>
                ) : preview.error !== null ? (
                  <>
                    <Notice tone="danger" variant="boxed" role="alert">
                      {t.bookPage.failed} {preview.error}
                    </Notice>
                    <Button variant="secondary" onClick={preview.retry}>
                      {t.bookPage.retry}
                    </Button>
                  </>
                ) : (
                  <p role="status">{t.bookPage.refreshing}</p>
                )}
              </div>
            )}
          </div>

          {viewer !== null && !empty && preview.error !== null ? (
            <Notice tone="warning" variant="inline" role="alert">
              {t.bookPage.failed}{' '}
              <button type="button" className={styles['link']} onClick={preview.retry}>
                {t.bookPage.retry}
              </button>
            </Notice>
          ) : null}
          <p className={styles['note']}>{t.bookPage.previewNote}</p>
        </section>
      </div>

      <Dialog
        open={big}
        title={t.bookPage.previewLabel}
        onClose={() => setBig(false)}
        className={styles['bigDialog']}
      >
        {viewer === null ? null : (
          <div className={styles['bigViewer']}>
            <BookViewer
              preview={viewer}
              face={face}
              onFace={setFace}
              focus={focus}
              settled={!preview.pending}
              strip={false}
            />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting}
        title={t.admin.bookDeleteTitle}
        description={t.admin.bookDeleteHint}
        confirmLabel={t.admin.bookDelete}
        busy={remove.busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </div>
  )
}
