import { useId, useState, type FormEvent } from 'react'
import { Async } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { CheckboxField } from '../../design-system/components/CheckboxField'
import { ChoiceChips } from '../../design-system/components/ChoiceChips'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Field } from '../../design-system/components/Field'
import { Notice } from '../../design-system/components/Notice'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import type {
  AlbumBookDto,
  AlbumBookSelection,
  AlbumBookStyle,
  ThemeAmbiance,
} from '../../lib/api/dto'
import {
  BOOK_LENGTH_TARGET,
  BOOK_LENGTHS,
  BOOK_PRINT_MAX_PAGES,
  BOOK_STYLES,
  defaultBookStyle,
  type BookLength,
} from '../../lib/bookStyle'
import { formatBytes, formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { useApi } from '../../lib/useApi'
import {
  useAlbumBook,
  useDeleteAlbumBook,
  useRequestAlbumBook,
  type AlbumBookRead,
} from './hooks/useAlbumBook'
import classique from './bookStyles/classique.svg'
import magazine from './bookStyles/magazine.svg'
import souvenir from './bookStyles/souvenir.svg'
import styles from './AlbumBookPanel.module.css'

export interface AlbumBookPanelProps {
  readonly slug: string
  /** The event's name: what the cover says until the host writes something else. */
  readonly defaultTitle: string
  /** The wall's ambiance: the form opens on the style that looks like it. */
  readonly ambiance: ThemeAmbiance
}

/** The fixed thumbnails of the three styles: drawings, not a render of the host's own photographs. */
const THUMBNAILS: Readonly<Record<AlbumBookStyle, string>> = { classique, magazine, souvenir }

type Book = Exclude<AlbumBookDto, { status: 'none' }>
type Loaded = Exclude<AlbumBookRead, 'unsupported'>

/** The length a stored selection stands for, `medium` when it is not a selection. */
const lengthOf = (selection: AlbumBookSelection | undefined): BookLength =>
  BOOK_LENGTHS.find(
    (length) => selection?.kind === 'best' && BOOK_LENGTH_TARGET[length] === selection.target,
  ) ?? 'medium'

/** The browser's own zone, which the book writes its dates in. `UTC` where it cannot be read. */
const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The host's photo book (spec 04, spec 26): a PDF of the published album, made in the background.
 *
 * Renders nothing for a server that does not know the routes. States no rule: the server decides
 * what is allowed (the daily ceiling, an empty album, a suspended client, how many photographs a
 * book holds) and its refusal is shown as the sentence for its code; the form only offers what the
 * server says it offers (`offer`, `albumCounts`). The form comes back with the last book's choices,
 * so a stale or failed book is one press from a new one. The status is announced politely, without
 * moving focus; the progress is a sentence, not a bar, because the server counts no photographs.
 */
export function AlbumBookPanel({ slug, defaultTitle, ambiance }: AlbumBookPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const toast = useToast()
  const state = useAlbumBook(slug)
  const remove = useDeleteAlbumBook()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (state.data === 'unsupported') return null

  const confirmDelete = () => {
    void remove.run('delete', slug).then((result) => {
      setDeleting(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      setEditing(false)
      state.reload()
    })
  }

  const render = (book: Loaded) => {
    const working = book.status === 'queued' || book.status === 'running'
    const done = book.status === 'done'
    const asked = book.status === 'none' ? null : book

    let title = ''
    let detail = ''
    if (asked !== null && working) {
      title = t.admin.bookWorking
      detail = t.admin.bookWorkingDetail(
        t.admin.bookStyleNames[asked.options.style],
        asked.options.selection.kind === 'best' ? asked.options.selection.target : null,
      )
    } else if (asked !== null && asked.status === 'stale') {
      title = t.admin.bookStale
    } else if (asked !== null && asked.status === 'failed') {
      title = asked.failureCode === 'tooLarge' ? t.admin.bookFailedTooLarge : t.admin.bookFailed
    } else if (asked !== null && done) {
      const until = asked.expiresAt === null ? null : formatDateTime(asked.expiresAt, locale)
      const photos = asked.photoCount ?? 0
      title = t.admin.bookDone(
        photos,
        asked.options.selection.kind === 'best' && asked.albumCounts.photos > photos
          ? asked.albumCounts.photos
          : null,
        asked.pageCount ?? 0,
        until,
      )
    }

    return (
      <>
        {/* Announced without moving focus: the book finishes while the host is elsewhere. */}
        <div className={styles['status']} role="status" aria-live="polite">
          {title === '' ? null : <span className={styles['statusTitle']}>{title}</span>}
          {detail === '' ? null : <span>{detail}</span>}
        </div>

        {asked !== null && done ? <Downloads book={asked} slug={slug} /> : null}

        {asked !== null && done && asked.printSkipped !== null ? (
          <Notice tone="warning" variant="boxed">
            {asked.printSkipped === 'tooManyPages'
              ? t.admin.bookPrintSkippedTooManyPages(asked.pageCount ?? 0, BOOK_PRINT_MAX_PAGES)
              : t.admin.bookPrintSkippedTooLarge}
          </Notice>
        ) : null}

        {asked !== null && done && asked.options.printVersion && asked.files?.printInterior ? (
          <details className={styles['help']}>
            <summary>{t.admin.bookHelpLink}</summary>
            <p>{t.admin.bookHelpIntro}</p>
            <ol>
              <li>{t.admin.bookHelpStep1}</li>
              <li>{t.admin.bookHelpStep2}</li>
              <li>{t.admin.bookHelpStep3}</li>
            </ol>
          </details>
        ) : null}

        {done ? (
          <div className={styles['actions']}>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t.admin.bookRebuild}
            </Button>
            <Button variant="secondary" onClick={() => setDeleting(true)}>
              {t.admin.bookDelete}
            </Button>
          </div>
        ) : null}

        {working || (done && !editing) ? null : (
          <BookForm
            key={asked === null ? 'none' : asked.requestedAt}
            slug={slug}
            book={book}
            defaultTitle={defaultTitle}
            ambiance={ambiance}
            onRequested={() => {
              setEditing(false)
              state.reload()
            }}
          />
        )}
      </>
    )
  }

  return (
    <Card as="h2" title={t.admin.book} subtitle={t.admin.bookHint}>
      <Async state={state} as="h3">
        {(book) => (book === 'unsupported' ? null : render(book))}
      </Async>

      <ConfirmDialog
        open={deleting}
        title={t.admin.bookDeleteTitle}
        description={t.admin.bookDeleteHint}
        confirmLabel={t.admin.bookDelete}
        busy={remove.busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </Card>
  )
}

/** The finished files: the book, and the printer version's interior and cover when it was made. */
function Downloads({ book, slug }: { readonly book: Book; readonly slug: string }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const screen = book.files?.screen.byteSize ?? book.byteSize ?? 0
  return (
    <div className={styles['downloads']}>
      <a className={styles['download']} href={api.albumBookUrl(slug)} download>
        <span>{t.admin.bookDownload}</span>
        <span className={styles['meta']}>
          {t.admin.bookDownloadMeta(formatBytes(screen, locale))}
        </span>
      </a>
      {book.files?.printInterior === undefined ? null : (
        <a className={styles['download']} href={api.albumBookPrintUrl(slug)} download>
          <span>{t.admin.bookDownloadPrintInterior}</span>
          <span className={styles['meta']}>
            {t.admin.bookDownloadMeta(formatBytes(book.files.printInterior.byteSize, locale))}
          </span>
        </a>
      )}
      {book.files?.printCover === undefined ? null : (
        <a className={styles['download']} href={api.albumBookCoverUrl(slug)} download>
          <span>{t.admin.bookDownloadPrintCover}</span>
          <span className={styles['meta']}>
            {t.admin.bookDownloadMeta(formatBytes(book.files.printCover.byteSize, locale))}
          </span>
        </a>
      )}
    </div>
  )
}

interface BookFormProps {
  readonly slug: string
  readonly book: Loaded
  readonly defaultTitle: string
  readonly ambiance: ThemeAmbiance
  readonly onRequested: () => void
}

/**
 * The choices, opened on the last book's own when there is one and otherwise on what the event
 * suggests: the style of its ambiance, every photograph when the book holds them, a medium
 * selection when it does not.
 */
function BookForm({ slug, book, defaultTitle, ambiance, onRequested }: BookFormProps) {
  const t = useTranslations()
  const toast = useToast()
  const request = useRequestAlbumBook()
  const group = useId()
  const last = book.status === 'none' ? null : book.options
  const { photos, messages } = book.albumCounts
  const { maxPhotos, printVersion: printOffered } = book.offer
  const allFits = photos <= maxPhotos

  const [title, setTitle] = useState(last?.title ?? defaultTitle)
  const [subtitle, setSubtitle] = useState(last?.subtitle ?? '')
  const [style, setStyle] = useState<AlbumBookStyle>(last?.style ?? defaultBookStyle(ambiance))
  const [all, setAll] = useState(allFits && (last === null || last.selection.kind === 'all'))
  const [length, setLength] = useState<BookLength>(lengthOf(last?.selection))
  const [showAuthors, setShowAuthors] = useState(last?.showAuthors ?? true)
  const [showCaptions, setShowCaptions] = useState(last?.showCaptions ?? true)
  const [guestbook, setGuestbook] = useState(last?.includeGuestbook ?? true)
  const [print, setPrint] = useState(last?.printVersion ?? false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void request
      .run('request', slug, {
        title,
        subtitle,
        style,
        selection: all ? { kind: 'all' } : { kind: 'best', target: BOOK_LENGTH_TARGET[length] },
        showAuthors,
        showCaptions,
        includeGuestbook: messages > 0 && guestbook,
        printVersion: printOffered && print,
        timeZone: browserTimeZone(),
      })
      .then((result) => {
        if (!result.ok) {
          toast.show(result.message, { tone: 'danger' })
          return
        }
        onRequested()
      })
  }

  const stale = book.status === 'stale'
  const submitLabel = stale
    ? t.admin.bookRecreate
    : book.status === 'none' || book.status === 'failed'
      ? t.admin.bookCreate
      : t.admin.bookRebuild

  return (
    <form className={styles['form']} onSubmit={submit} noValidate>
      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.bookStyleLegend}</legend>
        <div className={styles['styles']}>
          {BOOK_STYLES.map((option) => (
            <label key={option} className={styles['style']}>
              <input
                type="radio"
                className={styles['radio']}
                name={`${group}-style`}
                value={option}
                checked={style === option}
                onChange={() => setStyle(option)}
              />
              <img className={styles['thumb']} src={THUMBNAILS[option]} alt="" />
              <span className={styles['styleName']}>{t.admin.bookStyleNames[option]}</span>
              <span className={styles['styleHint']}>{t.admin.bookStyleHints[option]}</span>
            </label>
          ))}
        </div>
        {last === null ? <p className={styles['hint']}>{t.admin.bookStyleFromWall}</p> : null}
      </fieldset>

      <Field label={t.admin.bookTitle}>
        {(control) => (
          <TextInput
            {...control}
            name="bookTitle"
            autoComplete="off"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      </Field>
      <Field label={t.admin.bookSubtitle} optional hint={t.admin.bookSubtitleHint}>
        {(control) => (
          <TextInput
            {...control}
            name="bookSubtitle"
            autoComplete="off"
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
          />
        )}
      </Field>

      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.bookPhotosLegend}</legend>
        <div className={styles['choices']}>
          <label className={styles['choice']}>
            <input
              type="radio"
              className={styles['choiceInput']}
              name={`${group}-selection`}
              checked={all}
              disabled={!allFits}
              onChange={() => setAll(true)}
            />
            <span className={styles['choiceText']}>
              <span>{t.admin.bookSelectionAll(photos)}</span>
              {allFits ? null : (
                <span className={styles['hint']}>{t.admin.bookSelectionAllTooMany(maxPhotos)}</span>
              )}
            </span>
          </label>
          <label className={styles['choice']}>
            <input
              type="radio"
              className={styles['choiceInput']}
              name={`${group}-selection`}
              checked={!all}
              onChange={() => setAll(false)}
            />
            <span className={styles['choiceText']}>
              <span>{t.admin.bookSelectionBest}</span>
              <span className={styles['hint']}>{t.admin.bookSelectionBestHint}</span>
            </span>
          </label>
        </div>
        {all ? null : (
          <div className={styles['lengths']}>
            <ChoiceChips
              legend={t.admin.bookLengthLegend}
              value={length}
              options={BOOK_LENGTHS.map((option) => ({
                value: option,
                label: t.admin.bookLengthChip(
                  t.admin.bookLengthNames[option],
                  BOOK_LENGTH_TARGET[option],
                ),
              }))}
              onChange={(value) => setLength(BOOK_LENGTHS.find((l) => l === value) ?? 'medium')}
            />
          </div>
        )}
      </fieldset>

      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.bookOptionsLegend}</legend>
        <CheckboxField
          label={t.admin.bookShowAuthors}
          hint={t.admin.bookShowAuthorsHint}
          checked={showAuthors}
          onChange={setShowAuthors}
        />
        <CheckboxField
          label={t.admin.bookShowCaptions}
          checked={showCaptions}
          onChange={setShowCaptions}
        />
        {messages > 0 ? (
          <CheckboxField
            label={t.admin.bookGuestbook}
            hint={t.admin.bookGuestbookHint(messages)}
            checked={guestbook}
            onChange={setGuestbook}
          />
        ) : null}
        {printOffered ? (
          <CheckboxField
            label={t.admin.bookPrintVersion}
            hint={t.admin.bookPrintVersionHint}
            checked={print}
            onChange={setPrint}
          />
        ) : null}
      </fieldset>

      <p className={styles['hint']}>{t.admin.bookFormNote}</p>
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" loading={request.busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
