import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '../../design-system/components/Button'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import type { GuestOwnRsvpDto, GuestRsvpPageDto } from '../../lib/api/dto'
import { copyToClipboard } from '../../lib/clipboard'
import { messageForCode } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import {
  EMPTY_DRAFT,
  bump,
  draftOf,
  householdForm,
  inputOf,
  maxPeople,
  peopleOfDraft,
  personName,
  toggleMoment,
  type RsvpAnswer,
  type RsvpDraft,
} from '../../lib/rsvp/rsvpDraft'
import { ownReplyLink } from '../../lib/rsvp/rsvpDevice'
import {
  deadlineLabel,
  firstNameOf,
  momentLabels,
  proofLine,
  recapLine,
  recapLines,
} from '../../lib/rsvp/rsvpTexts'
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
  /** The host's preview shows the form open on a "yes", this name typed in. */
  readonly previewName?: string
  /**
   * Asks the page to read the invitation again: the host changed the form while this one was open
   * (a menu or a choice is gone), so what the guest typed is kept and the form is read anew.
   */
  readonly onStale?: () => void
  /** Tells the page the name this device's reply was given under (or `null`), for the join screen. */
  readonly onKnownName?: (name: string | null) => void
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

export function GuestRsvpBlock({
  rsvp,
  token,
  locale,
  interactive = true,
  previewName,
  onStale,
  onKnownName,
}: GuestRsvpBlockProps) {
  const all = useTranslations()
  const t = all.rsvp.guest
  const state = useGuestRsvp(token, interactive)
  const [draft, setDraft] = useState<RsvpDraft>(
    interactive ? EMPTY_DRAFT : { ...EMPTY_DRAFT, answer: 'yes', name: previewName ?? '' },
  )
  const [website, setWebsite] = useState('')
  const [editingRequested, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleted, setDeleted] = useState(false)

  // A household answers with the host's form, its own places as the ceiling and the counter always asked.
  const household = state.household
  const form = household === null ? rsvp.form : householdForm(rsvp.form, household)
  // The household's name is what the form starts from: the link tells the page who is answering.
  const householdName = household?.name ?? null
  const [nameSeeded, setNameSeeded] = useState(false)
  if (householdName !== null && !nameSeeded) {
    setNameSeeded(true)
    setDraft((current) => (current.name === '' ? { ...current, name: householdName } : current))
  }
  // What an empty form is: the household's name stays in it after a send or an erasure.
  const emptyDraft: RsvpDraft =
    household === null ? EMPTY_DRAFT : { ...EMPTY_DRAFT, name: household.name }
  const knownName = state.own?.reply.name ?? null
  useEffect(() => {
    onKnownName?.(knownName)
  }, [knownName, onKnownName])
  const failureCode = state.failure
  // The server ignores a moment the form (or the household) no longer has, so "none chosen" after
  // something was ticked means the page is stale; the plain "forgot to tick" case is not.
  const momentsStale = failureCode === 'rsvp.momentsRequired' && draft.moments.length > 0
  const refreshHousehold = state.refreshHousehold
  const hasHousehold = household !== null
  useEffect(() => {
    if (failureCode === 'rsvp.mealNotOffered' || failureCode === 'rsvp.answerNotAnOption') {
      onStale?.()
    }
  }, [failureCode, onStale])
  useEffect(() => {
    if (!momentsStale) return
    onStale?.()
    if (hasHousehold) refreshHousehold()
  }, [momentsStale, onStale, hasHousehold, refreshHousehold])
  const momentsHintId = useId()
  const momentsErrorId = useId()
  const momentsGoneId = useId()
  const open = rsvp.state === 'open' || rsvp.state === 'full'
  const own = state.own
  // A reply that vanished while it was being changed (a deletion elsewhere) ends the change.
  const editing = editingRequested && own !== null

  if (state.phase === 'reading') {
    return (
      <section className={styles['block']} aria-busy="true">
        <Spinner size="sm" label={t.title} />
      </section>
    )
  }

  // The household's link could not be read (the network, not a refusal): say so, and let the guest ask again.
  if (state.householdUnread) {
    return (
      <section className={styles['block']}>
        <Notice tone="warning" variant="boxed" role="alert">
          {t.householdFailed}
        </Notice>
        <Button variant="secondary" size="lg" block onClick={state.retryHousehold}>
          {t.householdRetry}
        </Button>
      </section>
    )
  }

  // What a link that opens nothing says, whatever state the replies are in: a household that follows a
  // dead or cut-off link must know why it is asked as a stranger.
  const deadText = state.householdGone
    ? t.householdGone
    : state.householdIncomplete
      ? t.householdIncomplete
      : null
  const deadNotice =
    deadText === null || deleted ? null : (
      <p className={styles['deleted']} role="status">
        {deadText}
      </p>
    )

  // Nothing is asked, and nothing is held: the page is the invitation alone.
  if (rsvp.state === 'off' && own === null && !deleted) {
    return deadNotice === null ? null : <section className={styles['block']}>{deadNotice}</section>
  }

  const failureText = (code: string | null): string | null =>
    code === null
      ? null
      : code === 'network'
        ? t.failed
        : code === 'busy'
          ? t.busy
          : code === 'request.tooLarge'
            ? t.tooLarge
            : messageForCode(code, all)

  const failure = failureText(state.failure)
  const set = (patch: Partial<RsvpDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const choose = (answer: RsvpAnswer) => {
    state.clearFailure()
    set({ answer })
  }

  /** The form only exists once an answer is chosen, so the answer is the one it is built for. */
  const send = (answer: RsvpAnswer) => async (event: FormEvent) => {
    event.preventDefault()
    const input = inputOf({ ...draft, answer }, form)
    const ok =
      editing && own !== null ? await state.update(own, input) : await state.submit(input, website)
    if (ok) {
      setEditing(false)
      setDraft(emptyDraft)
    }
  }

  const startEditing = (current: GuestOwnRsvpDto) => {
    state.clearFailure()
    setDraft(draftOf(current, form, { clamp: true }))
    setEditing(true)
    setAsking(false)
  }

  const erase = async () => {
    if (own !== null && (await state.remove(own))) {
      setAsking(false)
      setEditing(false)
      setDeleted(true)
      setDraft(emptyDraft)
    }
  }

  const copy = async (editToken: string) => {
    const link = ownReplyLink(window.location.origin, token, editToken)
    setCopied(await copyToClipboard(link))
  }

  /** Who is answering, when the link is a household's: "Bonjour Famille Martin · 4 places prévues pour vous". */
  const greeting =
    household === null ? null : (
      <div className={styles['household']}>
        <p>
          <strong>{t.householdGreeting(household.name)}</strong> <span aria-hidden="true">·</span>{' '}
          <span>{t.householdPlaces(household.places)}</span>
        </p>
        {/* A shared phone: whoever holds it can drop the household from this device. */}
        <Button variant="ghost" size="sm" onClick={state.forgetDevice}>
          {t.householdNotYours}
        </Button>
        {state.older === null ? null : (
          <Notice tone="neutral" variant="boxed" role="status">
            {t.olderReply(state.older.reply.name)}
            <Button
              variant="secondary"
              size="sm"
              loading={state.sending}
              onClick={() => void state.removeOlder()}
            >
              {t.olderReplyDelete}
            </Button>
          </Notice>
        )}
      </div>
    )

  const deadline =
    rsvp.deadline === null ? null : (
      <p className={styles['deadline']}>{t.deadline(deadlineLabel(rsvp.deadline, locale))}</p>
    )

  const proof =
    rsvp.proof === undefined ? null : <p className={styles['proof']}>{proofLine(rsvp.proof, t)}</p>

  // --- the form, to answer or to change ------------------------------------------------------
  /** Places are all taken and this guest has none: a yes is an entry on the waiting list. */
  const full = rsvp.state === 'full' && own?.reply.answer !== 'yes'
  /** A reply on the waiting list stays there when its guest says yes: "Oui" is no way out of it. */
  const waiting = editing && own?.reply.answer === 'waitlist'
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
          {answer === 'yes'
            ? waiting
              ? t.stayWaitlistChoice
              : full
                ? t.waitlistJoin
                : t.yes
            : t[answer]}
        </button>
      ))}
    </div>
  )

  const people = peopleOfDraft(draft, form)
  /** Nothing ticked after the server asked for one. */
  const momentsMissing = failureCode === 'rsvp.momentsRequired' && draft.moments.length === 0
  /** Changing a reply whose own moments no longer exist (removed, or the household was narrowed). */
  const momentsGone =
    editing &&
    own !== null &&
    own.reply.answer !== 'no' &&
    form.moments.length > 0 &&
    momentLabels(own.reply.moments, form).length === 0
  const formFields =
    draft.answer === null ? null : (
      <form className={styles['form']} onSubmit={send(draft.answer)} noValidate>
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
        {draft.answer !== 'no' && form.moments.length > 0 ? (
          <fieldset
            className={styles['field']}
            aria-describedby={`${momentsHintId}${momentsGone ? ` ${momentsGoneId}` : ''}${momentsMissing ? ` ${momentsErrorId}` : ''}`}
          >
            <legend>{t.momentsLabel}</legend>
            <small id={momentsHintId}>{t.momentsHint}</small>
            {momentsGone ? (
              <small id={momentsGoneId} role="status">
                {t.momentsGone}
              </small>
            ) : null}
            {form.moments.map((moment) => (
              <label key={moment.id} className={styles['check']}>
                <input
                  type="checkbox"
                  aria-invalid={momentsMissing ? true : undefined}
                  name={`moment-${moment.id}`}
                  checked={draft.moments.includes(moment.id)}
                  onChange={() => setDraft((current) => toggleMoment(current, moment.id))}
                />
                <span>{moment.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {draft.answer !== 'no' && form.companionNames && people > 1 ? (
          <fieldset className={styles['field']}>
            <legend>{t.companionsLabel}</legend>
            {Array.from({ length: people - 1 }, (_, index) => (
              <input
                key={index}
                type="text"
                name={`companion-${index + 1}`}
                autoComplete="off"
                maxLength={40}
                aria-label={t.companionLabel(index + 1)}
                placeholder={t.companionPlaceholder}
                value={draft.companions[index] ?? ''}
                onChange={(event) => {
                  const next = [...draft.companions]
                  while (next.length <= index) next.push('')
                  next[index] = event.target.value
                  set({ companions: next })
                }}
              />
            ))}
          </fieldset>
        ) : null}
        {draft.answer === 'yes' && form.meals.enabled ? (
          <fieldset className={styles['field']}>
            <legend>{t.mealsLabel}</legend>
            {Array.from({ length: people }, (_, index) => {
              const who = personName(draft, index, t.personFallback(index + 1))
              return (
                <select
                  key={index}
                  name={`meal-${index + 1}`}
                  aria-label={t.mealFor(who)}
                  value={draft.meals[index] ?? ''}
                  onChange={(event) => {
                    const next = [...draft.meals]
                    while (next.length <= index) next.push('')
                    next[index] = event.target.value
                    set({ meals: next })
                  }}
                >
                  <option value="">{t.mealFor(who)}</option>
                  {form.meals.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )
            })}
          </fieldset>
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
        {draft.answer !== 'no'
          ? form.questions.map((question) => (
              <label key={question.id} className={styles['field']}>
                <span>
                  {question.label} <small>{t.optional}</small>
                </span>
                {question.kind === 'choice' ? (
                  <select
                    name={`question-${question.id}`}
                    value={draft.answers[question.id] ?? ''}
                    onChange={(event) =>
                      set({ answers: { ...draft.answers, [question.id]: event.target.value } })
                    }
                  >
                    <option value="">{t.answerPick}</option>
                    {(question.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    name={`question-${question.id}`}
                    maxLength={120}
                    value={draft.answers[question.id] ?? ''}
                    onChange={(event) =>
                      set({ answers: { ...draft.answers, [question.id]: event.target.value } })
                    }
                  />
                )}
              </label>
            ))
          : null}
        {draft.answer === 'yes' && form.visibility === 'names' ? (
          <div className={styles['shown']}>
            <label className={styles['check']}>
              <input
                type="checkbox"
                name="showName"
                checked={draft.showName}
                onChange={(event) => set({ showName: event.target.checked })}
              />
              <span>{t.showNameLabel}</span>
            </label>
            {/* Exactly what would be published: the first word of the name typed above. */}
            {firstNameOf(draft.name) === '' ? null : (
              <small className={styles['shownLine']} aria-live="polite">
                {t.showNameShown(firstNameOf(draft.name))}
              </small>
            )}
          </div>
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
          <Notice tone="danger" variant="boxed" role="alert" id={momentsErrorId}>
            {failure}
          </Notice>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={state.sending}>
          {editing ? t.save : draft.answer === 'yes' && full ? t.waitlistJoin : t.send}
        </Button>
        {editing ? (
          <Button variant="ghost" size="lg" block onClick={() => setEditing(false)}>
            {t.cancel}
          </Button>
        ) : null}
        <p className={styles['notice']}>
          {form.visibility === 'names'
            ? t.noticeNames
            : form.visibility === 'count'
              ? t.noticeCount
              : t.notice}
        </p>
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
  if (own !== null && !editing) {
    const { reply } = own
    const first = firstNameOf(reply.name)
    const heading =
      reply.answer === 'no'
        ? t.doneNo(first)
        : reply.answer === 'maybe'
          ? t.doneMaybe
          : reply.answer === 'waitlist'
            ? t.doneWaitlist
            : t.doneYes(first)
    const sub =
      reply.answer === 'no'
        ? t.noSub
        : reply.answer === 'maybe'
          ? t.maybeSub
          : reply.answer === 'waitlist'
            ? t.waitlistSub
            : null
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
        {greeting}
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
          <Button variant="secondary" size="lg" block onClick={() => startEditing(reply)}>
            {t.edit}
          </Button>
        ) : null}
        {/* A household's link is its key: nothing to copy, every device of the household has it. */}
        {own.editToken === null ? null : (
          <div className={styles['link']}>
            <span className={styles['linkTitle']}>{t.linkTitle}</span>
            <small>{t.linkHint}</small>
            <Button variant="secondary" size="md" onClick={() => copy(own.editToken as string)}>
              {copied ? t.copied : t.copy}
            </Button>
          </div>
        )}
        {/* A shared phone: the device can let go of a reply that is not its owner's. */}
        {own.editToken === null ? null : (
          <Button variant="ghost" size="sm" onClick={state.forgetDevice}>
            {t.replyNotYours}
          </Button>
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
        {greeting}
        <h2>{t.title}</h2>
        {waiting ? (
          <p className={styles['full']} role="status">
            {t.stayWaitlist}
          </p>
        ) : null}
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
        {deadNotice}
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
      {deadNotice}
      {greeting}
      <h2>{t.title}</h2>
      {deadline}
      {rsvp.form.limited && rsvp.state === 'open' ? (
        <p className={styles['deadline']}>{t.limitedPlaces}</p>
      ) : null}
      {full ? (
        <div className={styles['full']} role="status">
          <strong>{t.fullTitle}</strong>
          <p>{t.fullSub}</p>
        </div>
      ) : null}
      {choices}
      {formFields}
      {draft.answer === null ? proof : null}
    </section>
  )
}
