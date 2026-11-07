import { useState, type FormEvent } from 'react'
import { Async } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useApi } from '../../app/useApi'
import { formatBytes, formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { CheckboxField } from '../../design-system/components/CheckboxField'
import { SelectField } from '../../design-system/components/SelectField'
import {
  useAlbumBook,
  useDeleteAlbumBook,
  useRequestAlbumBook,
  type AlbumBookRead,
} from './hooks/useAlbumBook'
import styles from './AlbumBookPanel.module.css'

export interface AlbumBookPanelProps {
  readonly slug: string
  /** The event's name: what the cover says until the host writes something else. */
  readonly defaultTitle: string
}

/**
 * The host's photo book (spec 04): a PDF of the published album, made in the background.
 *
 * Renders nothing for a server that does not know the routes. States no rule: the server decides
 * what is allowed (the daily ceiling, an empty album, a suspended client) and its refusal is
 * shown as the sentence for its code. The form is always there when no book is being made, so a
 * stale or failed book is one press from a new one. The status is announced politely, without
 * moving focus; the progress is a sentence, not a bar, because the server counts no photographs.
 */
export function AlbumBookPanel({ slug, defaultTitle }: AlbumBookPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const state = useAlbumBook(slug)
  const request = useRequestAlbumBook()
  const remove = useDeleteAlbumBook()

  const [title, setTitle] = useState(defaultTitle)
  const [subtitle, setSubtitle] = useState('')
  const [layout, setLayout] = useState<'one' | 'four'>('one')
  const [showAuthors, setShowAuthors] = useState(true)
  const [showCaptions, setShowCaptions] = useState(true)
  const [deleting, setDeleting] = useState(false)

  if (state.data === 'unsupported') return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void request
      .run('request', slug, { title, subtitle, layout, showAuthors, showCaptions })
      .then((result) => {
        if (!result.ok) {
          toast.show(result.message, { tone: 'danger' })
          return
        }
        state.reload()
      })
  }

  const confirmDelete = () => {
    void remove.run('delete', slug).then((result) => {
      setDeleting(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      state.reload()
    })
  }

  const render = (book: Exclude<AlbumBookRead, 'unsupported'>) => {
    const working = book.status === 'queued' || book.status === 'running'

    let message = ''
    if (book.status === 'queued' || book.status === 'running') message = t.admin.bookWorking
    else if (book.status === 'stale') message = t.admin.bookStale
    else if (book.status === 'failed') {
      message = book.failureCode === 'tooLarge' ? t.admin.bookFailedTooLarge : t.admin.bookFailed
    } else if (book.status === 'done') {
      const expires = book.expiresAt === null ? null : formatDateTime(book.expiresAt, locale)
      message = t.admin.bookDone(
        book.photoCount ?? 0,
        book.pageCount ?? 0,
        formatBytes(book.byteSize ?? 0, locale),
        expires,
      )
    }

    return (
      <>
        {/* Announced without moving focus: the book finishes while the host is elsewhere. */}
        <p className={styles['status']} role="status" aria-live="polite">
          {message}
        </p>

        {book.status === 'done' ? (
          <div className={styles['actions']}>
            <a className={styles['download']} href={api.albumBookUrl(slug)} download>
              {t.admin.bookDownload}
            </a>
            <Button variant="secondary" onClick={() => setDeleting(true)}>
              {t.admin.bookDelete}
            </Button>
          </div>
        ) : null}

        {working ? null : (
          <form className={styles['form']} onSubmit={submit} noValidate>
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
            <Field label={t.admin.bookSubtitle} optional>
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
            <SelectField
              label={t.admin.bookLayout}
              value={layout}
              options={[
                { value: 'one', label: t.admin.bookLayoutOne },
                { value: 'four', label: t.admin.bookLayoutFour },
              ]}
              onChange={(value) => setLayout(value === 'four' ? 'four' : 'one')}
            />
            <CheckboxField
              label={t.admin.bookShowAuthors}
              checked={showAuthors}
              onChange={setShowAuthors}
            />
            <CheckboxField
              label={t.admin.bookShowCaptions}
              checked={showCaptions}
              onChange={setShowCaptions}
            />
            <div className={styles['actions']}>
              <Button type="submit" variant="primary" loading={request.busy}>
                {book.status === 'none' || book.status === 'failed'
                  ? t.admin.bookCreate
                  : t.admin.bookRebuild}
              </Button>
            </div>
          </form>
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
