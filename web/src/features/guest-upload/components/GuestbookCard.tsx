import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Notice } from '../../../design-system/components/Notice'
import { Textarea } from '../../../design-system/components/Textarea'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { characterCount } from '../../../lib/characters'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { NoticePublication } from '../../../lib/api/dto'
import { sentenceForCode } from '../hooks/useMyMessages'
import { canRecordVoice, currentVoiceEnvironment, isInAppBrowser } from '../voiceRecording'
import { VoiceComposer } from './VoiceComposer'
import type { GuestbookWriter } from '../hooks/useGuestbook'
import type { VoiceOutbox, VoiceSendResult } from '../hooks/useVoiceOutbox'
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
 * The text is kept when a send fails, and is only ever a text node: never injected as markup.
 */

/** Said aloud once the guest is at four fifths of the limit, and again at the limit. */
const NEAR_NUMERATOR = 4
const NEAR_DENOMINATOR = 5

/**
 * The voice message (spec 25), when the event has any: what the server said (`offered`) and the phone's
 * own queue. The button is shown only when **both** the server offers it and this browser can record.
 */
export interface GuestbookCardVoice {
  readonly offered: boolean
  /** The longest message the box takes (`voiceMaxSeconds` of `mine`), so the recorder stops before a refusal. */
  readonly maxSeconds?: number | undefined
  readonly outbox: VoiceOutbox
  /** Counts up when the guest asks for the recorder from elsewhere ("Réessayer" on a failed recording). */
  readonly openRequest: number
}

/** What the card says once the composer has closed: the thanks, or the reason a recording is not on its way. */
interface VoiceNote {
  readonly tone: 'success' | 'warning' | 'danger'
  readonly text: string
  /** The sentence about keeping the page open, said after a recording that is waiting for a network. */
  readonly hint?: string
}

export interface GuestbookCardProps {
  readonly writer: GuestbookWriter
  /** The limit, in characters, as the server stated it; `undefined` shows no counter. */
  readonly maxLength: number | undefined
  /** From the notice: only what makes the help sentence true. */
  readonly publication: NoticePublication
  /** Absent on an event without voice messages: the card is exactly what it was. */
  readonly voice?: GuestbookCardVoice
}

type Level = 'ok' | 'near' | 'full'

const levelOf = (length: number, max: number | undefined): Level => {
  if (max === undefined) return 'ok'
  if (length >= max) return 'full'
  return length * NEAR_DENOMINATOR >= max * NEAR_NUMERATOR ? 'near' : 'ok'
}

export function GuestbookCard({ writer, maxLength, publication, voice }: GuestbookCardProps) {
  const t = useTranslations()
  const copy = t.guestbookVoice
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null)
  const voiceButton = useRef<HTMLButtonElement | null>(null)
  // Read once: a browser does not gain a microphone while the page is open.
  const canRecord = useMemo(() => canRecordVoice(currentVoiceEnvironment()), [])
  const voiceOffered = voice?.offered === true
  const showVoiceButton = voiceOffered && canRecord
  // The only behaviour the user agent decides: one sentence, for a link opened inside another app.
  const showInAppLine = voiceOffered && !canRecord && isInAppBrowser(navigator.userAgent)
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [thanks, setThanks] = useState<'pending' | 'published' | null>(null)
  const openButton = useRef<HTMLButtonElement | null>(null)

  const length = characterCount(text)
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

  // "Réessayer" elsewhere on the screen asks for the recorder: adjusted during render, which is how React
  // wants a value derived from a change of another one.
  const [seenRequest, setSeenRequest] = useState(voice?.openRequest ?? 0)
  if (voice !== undefined && voice.openRequest !== seenRequest) {
    setSeenRequest(voice.openRequest)
    if (voice.offered && !voice.outbox.atLimit) {
      setOpen(false)
      setVoiceNote(null)
      setVoiceOpen(true)
    }
  }

  const openVoice = () => {
    if (voice === undefined) return
    setThanks(null)
    setVoiceNote(null)
    // The server will refuse a fourth message of any kind: the guest is told before they record one.
    if (voice.outbox.atLimit) {
      setVoiceNote({ tone: 'danger', text: sentenceForCode('guestbook.limitReached', t) })
      return
    }
    setOpen(false)
    setVoiceOpen(true)
  }

  const closeVoice = () => {
    setVoiceOpen(false)
    requestAnimationFrame(() => voiceButton.current?.focus())
  }

  const onVoiceResult = (result: Exclude<VoiceSendResult, { kind: 'failed' }>) => {
    setVoiceOpen(false)
    switch (result.kind) {
      case 'sent':
        setVoiceNote({
          tone: 'success',
          text: publication === 'immediate' ? copy.thanksAuto : copy.thanksManual,
        })
        break
      case 'waiting':
        setVoiceNote({
          tone: 'warning',
          text: copy.waitingNetwork,
          hint: copy.offlineHintKeepOpen,
        })
        break
      case 'blocked':
        // Kept on the phone, not retried: the reason, and what the guest may do with the file.
        setVoiceNote({
          tone: 'warning',
          text: `${sentenceForCode(result.code, t)} ${copy.keptOnPhone}`,
        })
        break
      case 'rejected':
        setVoiceNote({ tone: 'danger', text: sentenceForCode(result.code, t) })
        break
    }
    requestAnimationFrame(() => voiceButton.current?.focus())
  }

  return (
    <Card as="h2" title={t.guestbook.title} className={styles['card']}>
      <p className={styles['help']}>
        {publication === 'immediate' ? t.guestbook.helpAuto : t.guestbook.helpManual}
      </p>
      {showVoiceButton ? (
        <p className={styles['help']}>
          {publication === 'immediate' ? copy.helpAuto : copy.helpManual}
        </p>
      ) : null}

      {thanks === null ? null : (
        <Notice tone="success" variant="boxed" role="status">
          {thanks === 'published' ? t.guestbook.thanksAuto : t.guestbook.thanksManual}
        </Notice>
      )}

      {voiceNote === null ? null : (
        <Notice
          tone={voiceNote.tone}
          variant="boxed"
          role={voiceNote.tone === 'danger' ? 'alert' : 'status'}
        >
          {voiceNote.text}
          {voiceNote.hint === undefined ? null : <span> {voiceNote.hint}</span>}
        </Notice>
      )}

      {voiceOpen ? (
        <VoiceComposer
          maxSeconds={voice?.maxSeconds}
          onSend={(recording, caption) =>
            voice?.outbox.send(recording, caption) ?? Promise.resolve({ kind: 'failed' })
          }
          onResult={onVoiceResult}
          onClose={closeVoice}
          onWriteInstead={() => {
            setVoiceOpen(false)
            setThanks(null)
            setOpen(true)
          }}
        />
      ) : open ? (
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
        <>
          <Button
            ref={openButton}
            variant="secondary"
            size="lg"
            block
            onClick={() => {
              setThanks(null)
              setVoiceNote(null)
              setOpen(true)
            }}
          >
            {t.guestbook.open}
          </Button>
          {/* Stacked under the text button, full width: two buttons side by side do not fit 375 px at the thumb. */}
          {showVoiceButton ? (
            <Button ref={voiceButton} variant="secondary" size="lg" block onClick={openVoice}>
              {copy.open}
            </Button>
          ) : null}
          {showInAppLine ? <p className={styles['help']}>{copy.openInBrowser}</p> : null}
        </>
      )}
    </Card>
  )
}
