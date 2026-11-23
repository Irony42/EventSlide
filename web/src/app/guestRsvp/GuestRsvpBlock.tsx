import { useState, type FormEvent } from 'react'
import { Button } from '../../design-system/components/Button'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import type { GuestRsvpPageDto } from '../../lib/api/dto'
import { copyToClipboard } from '../../lib/clipboard'
import { messageForCode } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import {
  EMPTY_DRAFT,
  bump,
  draftOf,
  inputOf,
  maxPeople,
  type RsvpAnswer,
  type RsvpDraft,
} from '../../lib/rsvp/rsvpDraft'
import { ownReplyLink } from '../../lib/rsvp/rsvpDevice'
import { deadlineLabel, firstNameOf, recapLine, recapLines } from '../../lib/rsvp/rsvpTexts'
import styles from './GuestRsvpBlock.module.css'
import { useGuestRsvp } from './useGuestRsvp'

/**
 * "Serez-vous là ?": what a guest does at the invitation's link once the host asks for an answer
 * (spec 30, lot 1). Surface: the guest's phone, one thumb, bad Wi-Fi: the buttons are 44 px tall,
 * the form is the same screen as the buttons, and the page works without any memory of the device.
 *
 * **Every state of the window**, as the server says it (`state`): `open` (ask, or show the reply
 * with "Modifier"), `closed` ("Les réponses sont closes", with the reply when the device knows it),
 * `off` (nothing, unless the device holds a reply: then a banner, so the right to erase stays
 * reachable on the evening and after). The words are plain text, never a link.
 *
 * Not interactive in the host's preview (`interactive={false}`): it draws the block from the page it
 * is given and reads and sends nothing.
 */

export interface GuestRsvpBlockProps {
  readonly rsvp: GuestRsvpPageDto
  readonly token: string
  /** The invitation's language tag, for the deadline's date. */
  readonly locale: string
  readonly interactive?: boolean
}

const CHOICES: readonly RsvpAnswer[] = ['yes', 'maybe', 'no']

function Stepper({
  label,
  hint,
  value,
  onLess,
  onMore,
  less,
  more,
}: {
  readonly label: string
  readonly hint?: string
  readonly value: number
  readonly onLess: () => void
  readonly onMore: () => void
  readonly less: string
  readonly more: string
}) {
  return (
    <div className={styles['stepper']}>
      <div>
        <span>{label}</span>
        {hint === undefined ? null : <small>{hint}</small>}
      </div>
      <div className={styles['count']}>
        <button type="button" onClick={onLess} aria-label={`${less} · ${label}`}>
          −
        </button>
        <output aria-label={label}>{value}</output>
        <button type="button" onClick={onMore} aria-label={`${more} · ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}

export function GuestRsvpBlock({ rsvp, token, locale, interactive = true }: GuestRsvpBlockProps) {
  const all = useTranslations()
  const t = all.rsvp.guest
  const state = useGuestRsvp(token, interactive)
  const [draft, setDraft] = useState<RsvpDraft>(EMPTY_DRAFT)
  const [website, setWebsite] = useState('')
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleted, setDeleted] = useState(false)

  const { form } = rsvp
  const open = rsvp.state === 'open' || rsvp.state === 'full'
  const reply = state.reply

  if (state.phase === 'reading') {
    return (
      <section className={styles['block']} aria-busy="true">
        <Spinner size="sm" label={t.title} />
      </section>
    )
  }

  // Nothing is asked, and nothing is held: the page is the invitation alone.
  if (rsvp.state === 'off' && reply === null && !deleted) return null

  const failureText = (code: string | null): string | null =>
    code === null
      ? null
      : code === 'network'
        ? t.failed
        : code === 'busy'
          ? t.busy
          : messageForCode(code, all)

  const failure = failureText(state.failure)
  const set = (patch: Partial<RsvpDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const choose = (answer: RsvpAnswer) => {
    state.clearFailure()
    set({ answer })
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const input = inputOf(draft, form)
    if (input === null) return
    const ok = editing ? await state.update(input) : await state.submit(input, website)
    if (ok) {
      setEditing(false)
      setDraft(EMPTY_DRAFT)
    }
  }

  const startEditing = () => {
    if (reply === null) return
    state.clearFailure()
    setDraft(draftOf(reply))
    setEditing(true)
    setAsking(false)
  }

  const erase = async () => {
    if (await state.remove()) {
      setAsking(false)
      setEditing(false)
      setDeleted(true)
    }
  }

  const copy = async () => {
    if (state.editToken === null) return
    const link = ownReplyLink(window.location.origin, token, state.editToken)
    setCopied(await copyToClipboard(link))
  }

  const deadline =
    rsvp.deadline === null ? null : (
      <p className={styles['deadline']}>{t.deadline(deadlineLabel(rsvp.deadline, locale))}</p>
    )

  const proof =
    rsvp.proof === undefined ? null : (
      <p className={styles['proof']}>
        {rsvp.proof.names.length === 0
          ? t.proofCount(rsvp.proof.count)
          : t.proofNames(rsvp.proof.names, Math.max(rsvp.proof.count - rsvp.proof.names.length, 0))}
      </p>
    )

  // --- the form, to answer or to change ------------------------------------------------------
  const choices = (
    <div className={styles['choices']} role="group" aria-label={t.title}>
      {CHOICES.filter((answer) => answer !== 'maybe' || form.maybe).map((answer) => (
        <button
          key={answer}
          type="button"
          className={styles['choice']}
          aria-pressed={draft.answer === answer}
          onClick={() => choose(answer)}
        >
          {t[answer]}
        </button>
      ))}
    </div>
  )

  const formFields =
    draft.answer === null ? null : (
      <form className={styles['form']} onSubmit={send} noValidate>
        <label className={styles['field']}>
          <span>{t.nameLabel}</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            maxLength={60}
            placeholder={t.namePlaceholder}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        {draft.answer !== 'no' && form.partySize.enabled ? (
          <div className={styles['field']}>
            <span>
              {t.howManyLabel} <small>{t.howManyHint(maxPeople(form))}</small>
            </span>
            <Stepper
              label={form.kidsSeparate ? t.adults : t.people}
              value={draft.adults}
              less={t.less}
              more={t.more}
              onLess={() => setDraft((d) => bump(d, form, 'adults', -1))}
              onMore={() => setDraft((d) => bump(d, form, 'adults', 1))}
            />
            {form.kidsSeparate ? (
              <Stepper
                label={t.kids}
                hint={t.kidsHint}
                value={draft.kids}
                less={t.less}
                more={t.more}
                onLess={() => setDraft((d) => bump(d, form, 'kids', -1))}
                onMore={() => setDraft((d) => bump(d, form, 'kids', 1))}
              />
            ) : null}
          </div>
        ) : null}
        {draft.answer !== 'no' && form.diet ? (
          <label className={styles['field']}>
            <span>
              {t.dietLabel} <small>{t.dietHint}</small>
            </span>
            <input
              type="text"
              name="diet"
              maxLength={120}
              placeholder={t.dietPlaceholder}
              value={draft.diet}
              onChange={(event) => set({ diet: event.target.value })}
            />
          </label>
        ) : null}
        <label className={styles['field']}>
          <span>
            {t.messageLabel} <small>{t.optional}</small>
          </span>
          <textarea
            name="message"
            rows={2}
            maxLength={280}
            value={draft.message}
            onChange={(event) => set({ message: event.target.value })}
          />
        </label>
        {/* The honeypot: a person never sees it, a script fills every field it finds. */}
        {editing ? null : (
          <label className={styles['trap']} aria-hidden="true">
            {t.trap}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </label>
        )}
        {failure === null ? null : (
          <Notice tone="danger" variant="boxed" role="alert">
            {failure}
          </Notice>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={state.sending}>
          {editing ? t.save : t.send}
        </Button>
        {editing ? (
          <Button variant="ghost" size="lg" block onClick={() => setEditing(false)}>
            {t.cancel}
          </Button>
        ) : null}
        <p className={styles['notice']}>{t.notice}</p>
      </form>
    )

  const deleteControl = (() => {
    if (asking) {
      return (
        <div className={styles['delete']} role="alertdialog" aria-label={t.deleteAsk}>
          <strong>{t.deleteAsk}</strong>
          <p>{t.deleteSub}</p>
          {failure === null ? null : (
            <Notice tone="danger" variant="boxed" role="alert">
              {failure}
            </Notice>
          )}
          <Button variant="danger" size="lg" block loading={state.sending} onClick={erase}>
            {t.deleteYes}
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setAsking(false)}>
            {t.cancel}
          </Button>
        </div>
      )
    }
    return (
      <Button variant="ghost" size="md" block onClick={() => setAsking(true)}>
        {t.delete}
      </Button>
    )
  })()

  // --- the reply the device knows ------------------------------------------------------------
  if (reply !== null && !editing) {
    const first = firstNameOf(reply.name)
    const heading =
      reply.answer === 'no'
        ? t.doneNo(first)
        : reply.answer === 'maybe'
          ? t.doneMaybe
          : t.doneYes(first)
    const sub = reply.answer === 'no' ? t.noSub : reply.answer === 'maybe' ? t.maybeSub : null
    // Not asked any more (the party is on, or over) or closed: the line is a banner, not a form.
    if (!open && rsvp.state !== 'closed') {
      return (
        <section className={styles['block']}>
          <p className={styles['banner']}>{t.earlier(recapLine(reply, form, t))}</p>
          {deleteControl}
        </section>
      )
    }
    return (
      <section className={styles['block']} aria-live="polite">
        {rsvp.state === 'closed' ? (
          <div className={styles['done']}>
            <h2>{t.closedTitle}</h2>
            <p>{t.closedSub}</p>
          </div>
        ) : (
          <div className={styles['done']}>
            <h2>{heading}</h2>
            {sub === null ? null : <p>{sub}</p>}
          </div>
        )}
        <ul className={styles['recap']}>
          {recapLines(reply, form, t).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {open ? (
          <Button variant="secondary" size="lg" block onClick={startEditing}>
            {t.edit}
          </Button>
        ) : null}
        {state.editToken === null ? null : (
          <div className={styles['link']}>
            <span className={styles['linkTitle']}>{t.linkTitle}</span>
            <small>{t.linkHint}</small>
            <Button variant="secondary" size="md" onClick={copy}>
              {copied ? t.copied : t.copy}
            </Button>
          </div>
        )}
        {deleteControl}
        {proof}
      </section>
    )
  }

  // --- editing, or nothing sent yet ----------------------------------------------------------
  if (editing) {
    return (
      <section className={styles['block']}>
        <h2>{t.title}</h2>
        {choices}
        {formFields}
        {deleteControl}
      </section>
    )
  }

  if (deleted && !open) {
    return (
      <section className={styles['block']}>
        <p className={styles['deleted']}>{t.deleted}</p>
      </section>
    )
  }

  // Replies are closed and this device holds nothing: say so, and who to ask.
  if (rsvp.state === 'closed') {
    return (
      <section className={styles['block']}>
        <div className={styles['done']}>
          <h2>{t.closedTitle}</h2>
          <p>{t.closedSub}</p>
        </div>
      </section>
    )
  }

  return (
    <section className={styles['block']}>
      {deleted ? <p className={styles['deleted']}>{t.deleted}</p> : null}
      {state.forgotten && !deleted ? <p className={styles['deleted']}>{t.forgotten}</p> : null}
      <h2>{t.title}</h2>
      {deadline}
      {choices}
      {formFields}
      {draft.answer === null ? proof : null}
    </section>
  )
}
