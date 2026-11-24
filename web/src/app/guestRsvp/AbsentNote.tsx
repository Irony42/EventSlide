import { useState, type FormEvent } from 'react'
import { Button } from '../../design-system/components/Button'
import { Notice } from '../../design-system/components/Notice'
import { messageForCode } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import styles from './GuestRsvpBlock.module.css'

/**
 * "Laisser un mot au livre d'or" (spec 30, lot 4): the word of a guest who answered "no".
 *
 * Offered only on the guest's own "no", while the host allows it and the guestbook takes entries
 * (`absentNoteAvailable`), and until one word was left with this reply. The text is the guestbook's: its
 * own rules and its own sentences when it is refused; a honeypot field a person never sees.
 */

/** The guestbook's own ceiling for a message. */
const NOTE_MAX_CHARS = 500

export interface AbsentNoteProps {
  /** The page says a word can be left now, and this reply has none yet. */
  readonly sent: boolean
  /** Sends it; resolves to whether it went. The refusal is `failure`. */
  readonly onSend: (text: string, website: string) => Promise<boolean>
  readonly sending: boolean
  /** The write's refusal, as the server's code (or `network` / `busy`). */
  readonly failure: string | null
  readonly onClearFailure: () => void
}

export function AbsentNote({ sent, onSend, sending, failure, onClearFailure }: AbsentNoteProps) {
  const all = useTranslations()
  const t = all.rsvp.absent
  const guest = all.rsvp.guest
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [website, setWebsite] = useState('')
  // The word went in this visit: thanked here, with no form to open again.
  const [thanked, setThanked] = useState(false)

  if (thanked) {
    return (
      <div className={styles['absent']} role="status">
        <strong>{t.sent}</strong>
        <p>{t.sentSub}</p>
      </div>
    )
  }
  if (sent) {
    return (
      <p className={styles['absent']} role="status">
        {t.already}
      </p>
    )
  }
  if (!open) {
    return (
      <Button
        variant="secondary"
        size="lg"
        block
        onClick={() => {
          onClearFailure()
          setOpen(true)
        }}
      >
        {t.offer}
      </Button>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await onSend(text, website)) setThanked(true)
  }
  /** The refusal in the guest's language: the page's own, then the guestbook's sentences for its text. */
  const sentenceFor = (code: string): string => {
    if (code === 'network') return guest.failed
    if (code === 'busy') return guest.busy
    if (code === 'guestbook.tooLong') return all.guestbook.tooLong(NOTE_MAX_CHARS)
    if (code === 'rsvp.absentNoteUnavailable') return t.unavailable
    if (code === 'rsvp.absentNoteSent') return t.already
    const guestbook: Record<string, string | undefined> = all.guestbook.errors
    return (
      (Object.hasOwn(guestbook, code) ? guestbook[code] : undefined) ?? messageForCode(code, all)
    )
  }
  const refusal = failure === null ? null : sentenceFor(failure)

  return (
    <form className={styles['absent']} onSubmit={(event) => void submit(event)}>
      <h3>{t.title}</h3>
      <p>{t.hint}</p>
      <label className={styles['absentLabel']}>
        <span>{t.label}</span>
        <textarea
          value={text}
          rows={4}
          maxLength={NOTE_MAX_CHARS}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {/* The honeypot: a person never sees it, a script fills every field it finds. */}
      <label className={styles['trap']} aria-hidden="true">
        {guest.trap}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>
      {refusal === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {refusal}
        </Notice>
      )}
      <Button type="submit" size="lg" block loading={sending} disabled={text.trim() === ''}>
        {t.send}
      </Button>
      <Button variant="ghost" size="lg" block onClick={() => setOpen(false)}>
        {guest.cancel}
      </Button>
    </form>
  )
}
