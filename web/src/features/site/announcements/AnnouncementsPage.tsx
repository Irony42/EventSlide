import { useCallback, useState, type FormEvent } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../../design-system/components/EmptyState'
import { Field } from '../../../design-system/components/Field'
import { LoadFailure, Pending } from '../../../design-system/components/Async'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import { useToast } from '../../../design-system/components/useToast'
import { formatDateTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import { useOperatorAction } from '../hooks/useOperatorAction'
import tables from '../components/Table.module.css'
import styles from './AnnouncementsPage.module.css'

/** What the form bounds, as the server does (`parseHostAnnouncement`): this only stops typing there. */
const SUBJECT_MAX = 150
const TEXT_MAX = 5000
const LINK_MAX = 500

/**
 * The subject as the server will keep it (`parseHostAnnouncement` folds it to one line): line breaks become spaces, invisible and
 * bidirectional control characters go, runs of spaces fold. Only the preview and "is there anything to send" read it: the server
 * judges what is sent.
 */
const foldSubject = (raw: string): string =>
  raw
    .replace(/[\r\n\u2028\u2029\u0085]+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()

/**
 * The operator's page of announcements to the hosts (`/admin/site/announcements`, spec 32, A8): a change of terms, of a
 * sub-processor, the end of the service.
 *
 * Surface: the operator's laptop. **The operator writes in whatever language they choose and nothing is translated**: the
 * console's own words around the form are, what is typed is sent as typed. The form shows **a preview** of the mail (the subject, the
 * text as typed with its line breaks, the one link), **the number of accounts it will be owed to** (the active owners of at
 * least one client, read now), and asks for a confirmation that names that number, then the operator's step-up if the server
 * asks. Nothing is sent from here: the mails go out by batches, within the day's budget, and the list below says how far each
 * announcement has gone (a count of accounts, never who).
 */
export function AnnouncementsPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const list = useLoader(useCallback((signal: AbortSignal) => api.siteAnnouncements(signal), [api]))
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [link, setLink] = useState('')
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const send = useOperatorAction(
    useCallback(
      (input: { subject: string; text: string; link?: string }) => api.siteSendAnnouncement(input),
      [api],
    ),
  )

  const folded = foldSubject(subject)
  const written = folded !== '' && text.trim() !== ''
  const recipients = list.data?.recipients ?? null

  const ask = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    if (written) {
      // The audience is read again as the confirmation opens: the dialog names the size it will go to *now*.
      list.reload()
      setAsking(true)
    }
  }

  const confirm = () => {
    const trimmed = link.trim()
    void send
      .run('announcement', { subject, text, ...(trimmed === '' ? {} : { link: trimmed }) })
      .then((result) => {
        setAsking(false)
        if (!result.ok) {
          // `null` is a person who walked away from the step-up prompt: nothing to say.
          setFailure(result.message)
          return
        }
        toast.show(t.siteAnnouncements.sent(result.value.recipients), { tone: 'success' })
        setSubject('')
        setText('')
        setLink('')
        list.reload()
      })
  }

  const date = (iso: string): string => formatDateTime(iso, locale) ?? iso

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.siteAnnouncements.title}</h1>
      <p className={styles['hint']}>{t.siteAnnouncements.hint}</p>

      <form className={styles['form']} onSubmit={ask}>
        <Field label={t.siteAnnouncements.subject} hint={t.siteAnnouncements.subjectHint}>
          {(control) => (
            <TextInput
              {...control}
              name="subject"
              autoComplete="off"
              maxLength={SUBJECT_MAX}
              required
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.siteAnnouncements.text} hint={t.siteAnnouncements.textHint}>
          {(control) => (
            <Textarea
              {...control}
              name="text"
              autoComplete="off"
              maxLength={TEXT_MAX}
              rows={8}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.siteAnnouncements.link} hint={t.siteAnnouncements.linkHint}>
          {(control) => (
            <TextInput
              {...control}
              name="link"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={LINK_MAX}
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
          )}
        </Field>

        <section className={styles['preview']} aria-labelledby="announcement-preview">
          <h2 id="announcement-preview" className={styles['heading']}>
            {t.siteAnnouncements.preview}
          </h2>
          {written ? (
            <>
              <p className={styles['previewSubject']}>{folded}</p>
              <p className={styles['previewText']}>{text.trim()}</p>
              {link.trim() === '' ? null : <p className={styles['previewLink']}>{link.trim()}</p>}
            </>
          ) : (
            <p className={styles['hint']}>{t.siteAnnouncements.previewEmpty}</p>
          )}
        </section>

        <p role="status" className={styles['audience']}>
          {recipients === null ? '' : t.siteAnnouncements.audience(recipients)}
        </p>
        {failure === null ? null : <p role="alert">{failure}</p>}
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={!written || send.busy || recipients === 0}
          >
            {t.siteAnnouncements.send}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={asking}
        title={t.siteAnnouncements.confirmTitle}
        description={t.siteAnnouncements.confirmBody(recipients ?? 0)}
        confirmLabel={t.siteAnnouncements.send}
        confirmVariant="primary"
        busy={send.busy || list.loading}
        onConfirm={confirm}
        onCancel={() => setAsking(false)}
      />

      <section className={styles['past']} aria-labelledby="announcement-past">
        <div className={styles['pastHead']}>
          <h2 id="announcement-past" className={styles['heading']}>
            {t.siteAnnouncements.past}
          </h2>
          <Button variant="secondary" onClick={list.reload}>
            {t.siteAnnouncements.refresh}
          </Button>
        </div>
        {list.data === null ? (
          list.error === null ? (
            <Pending label={t.siteAnnouncements.loading} />
          ) : (
            <LoadFailure message={list.error} onRetry={list.reload} />
          )
        ) : list.data.items.length === 0 ? (
          <EmptyState title={t.siteAnnouncements.none} />
        ) : (
          <table className={tables['table']}>
            <caption className={styles['caption']}>{t.siteAnnouncements.pastCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{t.siteAnnouncements.colSubject}</th>
                <th scope="col">{t.siteAnnouncements.colWritten}</th>
                <th scope="col">{t.siteAnnouncements.colProgress}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((item) => (
                <tr key={item.id}>
                  <th scope="row" className={styles['rowSubject']}>
                    {item.subject}
                  </th>
                  <td>{date(item.createdAt)}</td>
                  <td>
                    {item.finishedAt === null ? (
                      <Badge tone="warning">
                        {t.siteAnnouncements.going(item.delivered, item.owed)}
                      </Badge>
                    ) : (
                      <Badge tone="success">
                        {t.siteAnnouncements.done(item.delivered, date(item.finishedAt))}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
