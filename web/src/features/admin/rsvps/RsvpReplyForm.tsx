import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { ChoiceChips } from '../../../design-system/components/ChoiceChips'
import { Dialog } from '../../../design-system/components/Dialog'
import { Field } from '../../../design-system/components/Field'
import { SelectField } from '../../../design-system/components/SelectField'
import { Notice } from '../../../design-system/components/Notice'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import type { HouseholdDto, RsvpDto, RsvpFormDto } from '../../../lib/api/dto'
import { formForReply } from '../../../lib/rsvp/households'
import type { RsvpReplyInput } from '../../../lib/api/client/invite'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  EMPTY_DRAFT,
  draftOfHostReply,
  inputOf,
  peopleOfDraft,
  personName,
  toggleMoment,
  type RsvpAnswer,
  type RsvpDraft,
} from '../../../lib/rsvp/rsvpDraft'
import styles from './RsvpReplyForm.module.css'

export interface RsvpReplyFormProps {
  /** The reply being changed, or `null` for one the host adds. */
  readonly reply: RsvpDto | null
  /** The host's own form: what it asks decides which fields are here. */
  readonly form: RsvpFormDto
  /** The guest list: a reply filed under a household is asked only that household's moments. */
  readonly households?: readonly HouseholdDto[]
  /** Sends the reply; a refusal is thrown and shown as its sentence. */
  readonly onSubmit: (input: RsvpReplyInput) => Promise<void>
  readonly onClose: () => void
}

/**
 * "Ajouter une réponse" and "Modifier" (spec 30): **the guest's own form, filled in by the host**, for
 * a reply given on the phone or in person. It asks what the host's form asks and nothing else; the
 * server judges every value with the same rules as for a guest, except the places, which do not hold
 * the host back.
 *
 * Mounted only while open, so each opening starts from the reply it is about.
 */
export function RsvpReplyForm({
  reply,
  form: hostForm,
  households = [],
  onSubmit,
  onClose,
}: RsvpReplyFormProps) {
  const t = useTranslations()
  const form = formForReply(hostForm, reply, households)
  const momentsHintId = useId()
  const problemId = useId()
  const text = t.rsvp.list
  const [draft, setDraft] = useState<RsvpDraft>(
    reply === null ? EMPTY_DRAFT : draftOfHostReply(reply, form),
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const change = (patch: Partial<RsvpDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const number = (value: string, floor: number): number => Math.max(floor, Number(value) || floor)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (draft.answer === null) return
    setBusy(true)
    setProblem(null)
    try {
      // Showing a first name is the guest's own choice: the host's form never carries it.
      const { showName: _theirs, ...input } = inputOf({ ...draft, answer: draft.answer }, form)
      await onSubmit(input)
      onClose()
    } catch (cause) {
      setProblem(messageForError(cause, t))
      setBusy(false)
    }
  }

  const answers: readonly { readonly value: RsvpAnswer; readonly label: string }[] = [
    { value: 'yes', label: text.answerYes },
    ...(form.maybe ? [{ value: 'maybe' as const, label: text.answerMaybe }] : []),
    { value: 'no', label: text.answerNo },
  ]
  const coming = draft.answer !== null && draft.answer !== 'no'
  const people = peopleOfDraft(draft, form)
  const slot = (list: readonly string[], index: number, value: string): readonly string[] => {
    const next = [...list]
    while (next.length <= index) next.push('')
    next[index] = value
    return next
  }

  return (
    <Dialog
      open
      title={reply === null ? text.formAddTitle : text.formEditTitle}
      description={text.formHint}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.app.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="rsvp-reply-form"
            disabled={draft.answer === null || draft.name.trim() === ''}
            loading={busy}
          >
            {busy ? text.formSaving : text.formSave}
          </Button>
        </>
      }
    >
      <form id="rsvp-reply-form" className={styles['form']} onSubmit={(e) => void submit(e)}>
        <Field label={text.formName}>
          {(control) => (
            <TextInput
              {...control}
              value={draft.name}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => change({ name: event.target.value })}
            />
          )}
        </Field>
        <ChoiceChips
          legend={text.formAnswer}
          options={answers}
          value={draft.answer ?? ''}
          onChange={(answer) => change({ answer: answer as RsvpAnswer })}
        />
        {coming && form.partySize.enabled ? (
          <div className={styles['row']}>
            <Field label={text.formAdults}>
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={form.partySize.max}
                  value={draft.adults}
                  onChange={(event) => change({ adults: number(event.target.value, 1) })}
                />
              )}
            </Field>
            {form.kidsSeparate ? (
              <Field label={text.formKids}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={form.partySize.max}
                    value={draft.kids}
                    onChange={(event) => change({ kids: number(event.target.value, 0) })}
                  />
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
        {coming && form.moments.length > 0 ? (
          <fieldset
            className={styles['moments']}
            aria-describedby={`${momentsHintId}${problem === null ? '' : ` ${problemId}`}`}
          >
            <legend>{text.formMoments}</legend>
            <small id={momentsHintId}>{text.formMomentsHint}</small>
            {form.moments.map((moment) => (
              <label key={moment.id}>
                <input
                  type="checkbox"
                  aria-invalid={problem !== null && draft.moments.length === 0 ? true : undefined}
                  checked={draft.moments.includes(moment.id)}
                  onChange={() => setDraft((current) => toggleMoment(current, moment.id))}
                />{' '}
                {moment.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {coming && form.companionNames
          ? Array.from({ length: Math.max(people - 1, 0) }, (_, index) => (
              <Field key={`companion-${index}`} label={text.formCompanion(index + 1)} optional>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.companions[index] ?? ''}
                    maxLength={40}
                    onChange={(event) =>
                      change({ companions: slot(draft.companions, index, event.target.value) })
                    }
                  />
                )}
              </Field>
            ))
          : null}
        {draft.answer === 'yes' && form.meals.enabled
          ? Array.from({ length: people }, (_, index) => {
              const who = personName(draft, index, `${index + 1}`)
              return (
                <SelectField
                  key={`meal-${index}`}
                  label={text.formMeal(who)}
                  value={draft.meals[index] ?? ''}
                  options={[
                    { value: '', label: text.none },
                    ...form.meals.options.map((option) => ({ value: option, label: option })),
                  ]}
                  onChange={(value) => change({ meals: slot(draft.meals, index, value) })}
                />
              )
            })
          : null}
        {coming && form.diet ? (
          <Field label={text.formDiet} optional>
            {(control) => (
              <TextInput
                {...control}
                value={draft.diet}
                maxLength={200}
                onChange={(event) => change({ diet: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        {coming
          ? form.questions.map((question) =>
              question.kind === 'choice' ? (
                <SelectField
                  key={question.id}
                  label={question.label}
                  value={draft.answers[question.id] ?? ''}
                  options={[
                    { value: '', label: text.none },
                    ...(question.options ?? []).map((option) => ({ value: option, label: option })),
                  ]}
                  onChange={(value) =>
                    change({ answers: { ...draft.answers, [question.id]: value } })
                  }
                />
              ) : (
                <Field key={question.id} label={question.label} optional>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={draft.answers[question.id] ?? ''}
                      maxLength={120}
                      onChange={(event) =>
                        change({ answers: { ...draft.answers, [question.id]: event.target.value } })
                      }
                    />
                  )}
                </Field>
              ),
            )
          : null}
        <Field label={text.formMessage} optional>
          {(control) => (
            <Textarea
              {...control}
              value={draft.message}
              maxLength={500}
              onChange={(event) => change({ message: event.target.value })}
            />
          )}
        </Field>
        {problem === null ? null : (
          <Notice tone="danger" variant="boxed" role="alert" id={problemId}>
            {problem}
          </Notice>
        )}
      </form>
    </Dialog>
  )
}
