import { useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Notice } from '../../../design-system/components/Notice'
import { Textarea } from '../../../design-system/components/Textarea'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { NoticePublication } from '../../../lib/api/dto'
import type { GuestbookWriter } from '../hooks/useGuestbook'
import styles from './GuestbookCard.module.css'

/**
 * The guestbook card of the guest screen (spec 01): a few written words, no photograph.
 *
 * Folded until the guest asks to write, so it costs one line of the phone. **No rule lives
 * here**: the limit, the three-message ceiling and the event's state are the server's answers
 * (`guestbook.tooLong { max }`, `guestbook.limitReached`, `accepting`), and the only thing
 * checked locally is that the box is not empty, so the button is not pressed on nothing. The
 * counter is a courtesy and states the limit the server owns (`maxLength`, from the event).
 *
 * The text is kept when a send fails, and is only ever a text node: never `dangerouslySetInnerHTML`.
 */

/** Said aloud once the guest is at four fifths of the limit, and again at the limit. */
const NEAR_NUMERATOR = 4
const NEAR_DENOMINATOR = 5

export interface GuestbookCardProps {
  readonly writer: GuestbookWriter
  /** The limit, in characters, as the server stated it; `undefined` shows no counter. */
  readonly maxLength: number | undefined
  /** From the notice: only what makes the help sentence true. */
  readonly publication: NoticePublication
}

type Level = 'ok' | 'near' | 'full'

const levelOf = (length: number, max: number | undefined): Level => {
  if (max === undefined) return 'ok'
  if (length >= max) return 'full'
  return length * NEAR_DENOMINATOR >= max * NEAR_NUMERATOR ? 'near' : 'ok'
}

/** Characters as a guest counts them (an emoji is one), which is also how the server counts. */
const lengthOf = (text: string): number => Array.from(text).length

export function GuestbookCard({ writer, maxLength, publication }: GuestbookCardProps) {
  const t = useTranslations()
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [thanks, setThanks] = useState<'pending' | 'published' | null>(null)
  const openButton = useRef<HTMLButtonElement | null>(null)

  const length = lengthOf(text)
  const level = levelOf(length, maxLength)
  // Announced when the level changes, not on every key: the state is adjusted during render, which
  // is how React wants a value derived from a change of another one.
  const [seen, setSeen] = useState<Level>('ok')
  const [announcement, setAnnouncement] = useState('')
  if (level !== seen) {
    setSeen(level)
    setAnnouncement(
      level === 'ok' || maxLength === undefined
        ? ''
        : level === 'full'
          ? t.guestbook.counterFull
          : t.guestbook.counterNear(maxLength - length),
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() === '' || writer.sending) return
    const written = await writer.send(text)
    if (written === null) return
    setThanks(written.status === 'published' ? 'published' : 'pending')
    setText('')
    setOpen(false)
    // The button the guest pressed is gone: hand focus to the one that re-opens the form.
    requestAnimationFrame(() => openButton.current?.focus())
  }

  return (
    <Card as="h2" title={t.guestbook.title} className={styles['card']}>
      <p className={styles['help']}>
        {publication === 'immediate' ? t.guestbook.helpAuto : t.guestbook.helpManual}
      </p>

      {thanks === null ? null : (
        <Notice tone="success" variant="boxed" role="status">
          {thanks === 'published' ? t.guestbook.thanksAuto : t.guestbook.thanksManual}
        </Notice>
      )}

      {open ? (
        <form className={styles['form']} onSubmit={(event) => void submit(event)}>
          <label className={styles['label']} htmlFor={inputId}>
            {t.guestbook.label}
          </label>
          <Textarea
            id={inputId}
            className={styles['input']}
            rows={5}
            value={text}
            placeholder={t.guestbook.placeholder}
            autoFocus
            onChange={(event) => {
              setText(event.target.value)
              writer.clearError()
            }}
            aria-invalid={writer.error === null ? undefined : true}
          />
          <div className={styles['meta']}>
            {maxLength === undefined ? null : (
              <span className={styles['counter']} data-level={level}>
                {t.guestbook.counter(length, maxLength)}
              </span>
            )}
            {/* Mounted from the start, filled at the thresholds only. */}
            <VisuallyHidden>
              <span aria-live="polite" data-testid="guestbook-announcement">
                {announcement}
              </span>
            </VisuallyHidden>
          </div>
          {writer.error === null ? null : (
            <Notice tone="danger" variant="boxed" role="alert">
              {writer.error}
            </Notice>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={writer.sending}
            disabled={text.trim() === ''}
          >
            {t.guestbook.send}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false)
              writer.clearError()
            }}
          >
            {t.guestbook.cancel}
          </Button>
        </form>
      ) : (
        <Button
          ref={openButton}
          variant="secondary"
          size="lg"
          block
          onClick={() => {
            setThanks(null)
            setOpen(true)
          }}
        >
          {t.guestbook.open}
        </Button>
      )}
    </Card>
  )
}
