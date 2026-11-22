import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import type { AlbumBookDto } from '../../../lib/api/dto'
import { BOOK_PRINT_MAX_PAGES } from '../../../lib/bookStyle'
import { formatDateTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { Downloads } from '../AlbumBookPanel'
import type { StoredBook } from './bookOptions'
import styles from './BookBuild.module.css'

export interface BookBuildProps {
  readonly slug: string
  /** The server's last word on the book, `none` when none was ever asked for. */
  readonly book: AlbumBookDto
  /** Whether the settings describe a book that can be made (a title, something published). */
  readonly ready: boolean
  readonly busy: boolean
  readonly onDelete: () => void
}

/**
 * What the server says about the book, and the button that asks for one: one block under the
 * settings. It says what the server knows and no more: queued, running, done, failed, stale. The
 * server counts no pages while it works, so there is no bar and no percentage, only a sentence and
 * the promise that the page can be left.
 */
export function BookBuild({ slug, book, ready, busy, onDelete }: BookBuildProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const asked: StoredBook | null = book.status === 'none' ? null : book
  const working = asked !== null && (asked.status === 'queued' || asked.status === 'running')
  const done = asked !== null && asked.status === 'done'

  let title = ''
  let detail = ''
  if (asked !== null && working) {
    title = asked.status === 'queued' ? t.bookPage.queued : t.bookPage.running
    detail = t.bookPage.workingNote
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

  let label = t.admin.bookCreate
  if (asked !== null && asked.status === 'stale') label = t.admin.bookRecreate
  else if (asked !== null && done) label = t.admin.bookRebuild

  return (
    <div className={styles['build']}>
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

      <div className={styles['actions']}>
        <Button type="submit" variant="primary" loading={busy} disabled={working || !ready}>
          {label}
        </Button>
        {done ? (
          <Button variant="secondary" onClick={onDelete}>
            {t.admin.bookDelete}
          </Button>
        ) : null}
      </div>
      {working || !ready ? null : <p className={styles['hint']}>{t.admin.bookFormNote}</p>}
    </div>
  )
}
