import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { SelectField } from '../../../design-system/components/SelectField'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import type { RsvpFormInput } from '../../../lib/api/client/invite'
import type { RsvpFormDto } from '../../../lib/api/dto'
import type { RsvpSaveState } from './useRsvpSettings'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  linesOf,
  momentsInput,
  MOMENTS_MAX,
  questionsInput,
  QUESTIONS_MAX,
  type MomentDraft,
  type QuestionDraft,
} from '../../../lib/rsvp/rsvpExtras'
import styles from './RsvpPanel.module.css'

/**
 * What a wedding or a dinner asks beyond the count (spec 30, lot 2): the companions' first names,
 * a menu per person and up to three questions of the host's own; and (lot 4) up to four moments of
 * the party the guest ticks. A moment already saved keeps its id whatever its label becomes. **A text is sent when it is left**
 * (a half-typed list of menus is not a choice), and a question already saved keeps its id whatever
 * its label becomes; the server judges every value.
 */

export interface RsvpExtrasProps {
  readonly form: RsvpFormDto
  readonly locked: boolean
  readonly change: (input: RsvpFormInput) => void
  /** Where the save stands and the sentence of its last refusal: a refused text stays beside its field. */
  readonly saveState: RsvpSaveState
  readonly problem: string | null
  /** How many replies hold a moment, for the confirmation of its removal (`null`: unknown). */
  readonly momentReplies: (momentId: string) => Promise<number | null>
}

/**
 * A text kept on screen while it is typed, sent when the field is left (or when the page is, so
 * nothing typed is lost) and only if it changed. **It stays on screen until the save is settled**: a
 * refused text is still what the host typed, with the refusal beside it, not the old value silently
 * back.
 */
function CommitField({
  label,
  hint,
  value,
  multiline = false,
  disabled,
  onCommit,
  saveState,
  problem,
}: {
  readonly label: string
  readonly hint?: string
  readonly value: string
  readonly multiline?: boolean
  readonly disabled: boolean
  readonly onCommit: (value: string) => void
  readonly saveState: RsvpSaveState
  readonly problem: string | null
}) {
  const [typed, setTyped] = useState<string | null>(null)
  /** The typed text was handed to the save: it stays until the save has answered. */
  const [sent, setSent] = useState(false)
  const shown = typed ?? value
  const latest = useRef({ typed, value, sent, onCommit })
  useEffect(() => {
    latest.current = { typed, value, sent, onCommit }
  })
  // Leaving the page with a text typed and not yet left: it is sent, not lost.
  useEffect(
    () => () => {
      const now = latest.current
      if (now.typed !== null && now.typed !== now.value && !now.sent) now.onCommit(now.typed)
    },
    [],
  )
  // Settled: the save answered and nothing was refused, so the server's word is the screen again.
  // (State adjusted while rendering, the documented way to derive it from a prop.)
  if (sent && saveState === 'saved' && problem === null) {
    setTyped(null)
    setSent(false)
  }
  const leave = () => {
    if (typed !== null && typed !== value && !sent) {
      onCommit(typed)
      setSent(true)
    } else if (!sent) {
      setTyped(null)
    }
  }
  const change = (text: string) => {
    setTyped(text)
    setSent(false)
  }
  return (
    <>
      <Field label={label} {...(hint === undefined ? {} : { hint })}>
        {(control) =>
          multiline ? (
            <Textarea
              {...control}
              rows={3}
              value={shown}
              disabled={disabled}
              onChange={(event) => change(event.target.value)}
              onBlur={leave}
            />
          ) : (
            <TextInput
              {...control}
              value={shown}
              maxLength={80}
              disabled={disabled}
              onChange={(event) => change(event.target.value)}
              onBlur={leave}
            />
          )
        }
      </Field>
      {sent && problem !== null ? (
        <Notice tone="danger" variant="inline" role="alert">
          {problem}
        </Notice>
      ) : null}
    </>
  )
}

export function RsvpExtras({
  form,
  locked,
  change,
  saveState,
  problem,
  momentReplies,
}: RsvpExtrasProps) {
  const all = useTranslations()
  const text = all.rsvp.host
  /** The menus are being written: the switch is on screen before it can be sent (it needs 2 menus). */
  const [mealsOpen, setMealsOpen] = useState(false)
  const [draft, setDraft] = useState<QuestionDraft | null>(null)
  /** The label of a moment being added: it is sent with the button, not while it is typed. */
  const [momentDraft, setMomentDraft] = useState<string | null>(null)
  /** The moment the host asked to remove, and how many replies hold it once known. */
  const [removing, setRemoving] = useState<{
    readonly index: number
    readonly count: number | null | 'reading'
  } | null>(null)
  const mealsOn = form.meals.enabled || mealsOpen
  /** A question the server has not named yet: nothing about the questions changes until it has, or a
   * second request would give the same question a second id. */
  const naming = form.questions.some((question) => question.id === '')

  const save = (questions: readonly QuestionDraft[]) =>
    change({ form: { questions: questionsInput(questions) } })
  /** A moment the server has not named yet: nothing about the moments changes until it has. */
  const momentNaming = form.moments.some((moment) => moment.id === '')
  const saveMoments = (moments: readonly MomentDraft[]) =>
    change({ form: { moments: momentsInput(moments) } })

  return (
    <>
      <CheckboxField
        label={text.companionsLabel}
        hint={text.companionsHint}
        checked={form.companionNames}
        disabled={locked}
        onChange={(companionNames) => change({ form: { companionNames } })}
      />
      {form.companionNames && !form.partySize.enabled ? (
        <p className={styles['note']}>{text.companionsNeedSize}</p>
      ) : null}
      <CheckboxField
        label={text.mealsLabel}
        hint={text.mealsHint}
        checked={mealsOn}
        disabled={locked}
        onChange={(on) => {
          if (!on) {
            setMealsOpen(false)
            if (form.meals.enabled) change({ form: { meals: { enabled: false } } })
          } else if (form.meals.options.length >= 2) {
            change({ form: { meals: { enabled: true } } })
          } else {
            setMealsOpen(true)
          }
        }}
      />
      {mealsOn ? (
        <div className={styles['sub']}>
          <CommitField
            label={text.mealsOptionsLabel}
            hint={text.mealsOptionsHint}
            value={form.meals.options.join('\n')}
            multiline
            disabled={locked}
            saveState={saveState}
            problem={problem}
            onCommit={(raw) => {
              const options = linesOf(raw)
              change({
                form: { meals: { options, ...(options.length >= 2 ? { enabled: true } : {}) } },
              })
            }}
          />
        </div>
      ) : null}

      <div className={styles['questions']}>
        <h3 className={styles['legend']}>{text.questionsTitle}</h3>
        <p className={styles['note']}>{text.questionsHint}</p>
        {form.questions.map((question, index) => (
          <div key={question.id === '' ? `new-${index}` : question.id} className={styles['sub']}>
            <CommitField
              label={text.questionLabelLabel}
              value={question.label}
              saveState={saveState}
              problem={problem}
              disabled={locked || naming}
              onCommit={(label) =>
                save(
                  form.questions.map((other, at) =>
                    at === index ? { ...other, label: label.trim() } : other,
                  ),
                )
              }
            />
            {question.kind === 'choice' ? (
              <CommitField
                label={text.questionOptionsLabel}
                hint={text.questionOptionsHint}
                value={(question.options ?? []).join('\n')}
                multiline
                saveState={saveState}
                problem={problem}
                disabled={locked || naming}
                onCommit={(raw) =>
                  save(
                    form.questions.map((other, at) =>
                      at === index ? { ...other, options: linesOf(raw) } : other,
                    ),
                  )
                }
              />
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={locked || naming}
              aria-label={text.questionRemove(question.label)}
              onClick={() => save(form.questions.filter((_, at) => at !== index))}
            >
              {text.questionRemove(question.label)}
            </Button>
          </div>
        ))}
        {draft !== null ? (
          <div className={styles['sub']}>
            <Field label={text.questionLabelLabel}>
              {(control) => (
                <TextInput
                  {...control}
                  value={draft.label}
                  maxLength={80}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
              )}
            </Field>
            <SelectField
              label={text.questionKindLabel}
              value={draft.kind}
              options={[
                { value: 'text', label: text.questionKindText },
                { value: 'choice', label: text.questionKindChoice },
              ]}
              onChange={(kind) =>
                setDraft({ ...draft, kind: kind === 'choice' ? 'choice' : 'text' })
              }
            />
            {draft.kind === 'choice' ? (
              <Field label={text.questionOptionsLabel} hint={text.questionOptionsHint}>
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    value={(draft.options ?? []).join('\n')}
                    onChange={(event) =>
                      setDraft({ ...draft, options: event.target.value.split('\n') })
                    }
                  />
                )}
              </Field>
            ) : null}
            <div className={styles['row']}>
              <Button
                size="sm"
                disabled={draft.label.trim() === ''}
                onClick={() => {
                  save([
                    ...form.questions,
                    { ...draft, options: linesOf((draft.options ?? []).join('\n')) },
                  ])
                  setDraft(null)
                }}
              >
                {text.questionConfirm}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                {all.app.cancel}
              </Button>
            </div>
          </div>
        ) : form.questions.length < QUESTIONS_MAX ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={locked || naming}
            onClick={() => setDraft({ id: '', label: '', kind: 'text', options: [] })}
          >
            {text.questionAdd}
          </Button>
        ) : (
          <p className={styles['note']}>{text.questionsFull}</p>
        )}
      </div>

      <div className={styles['questions']}>
        <h3 className={styles['legend']}>{text.momentsTitle}</h3>
        <p className={styles['note']}>{text.momentsHint}</p>
        {form.moments.map((moment, index) => (
          <div key={moment.id === '' ? `new-${index}` : moment.id} className={styles['sub']}>
            <CommitField
              label={text.momentLabelLabel(index + 1)}
              value={moment.label}
              saveState={saveState}
              problem={problem}
              disabled={locked || momentNaming}
              onCommit={(label) =>
                saveMoments(
                  form.moments.map((other, at) =>
                    at === index ? { ...other, label: label.trim() } : other,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={locked || momentNaming}
              aria-label={text.momentRemove(moment.label)}
              onClick={() => {
                setRemoving({ index, count: 'reading' })
                void momentReplies(moment.id).then((count) =>
                  setRemoving((current) => (current?.index === index ? { index, count } : current)),
                )
              }}
            >
              {text.momentRemove(moment.label)}
            </Button>
          </div>
        ))}
        {momentDraft !== null ? (
          <div className={styles['sub']}>
            <Field label={text.momentLabelLabel(form.moments.length + 1)}>
              {(control) => (
                <TextInput
                  {...control}
                  value={momentDraft}
                  maxLength={40}
                  placeholder={text.momentPlaceholder}
                  onChange={(event) => setMomentDraft(event.target.value)}
                />
              )}
            </Field>
            <div className={styles['row']}>
              <Button
                size="sm"
                disabled={momentDraft.trim() === ''}
                onClick={() => {
                  saveMoments([...form.moments, { id: '', label: momentDraft.trim() }])
                  setMomentDraft(null)
                }}
              >
                {text.momentAdd}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMomentDraft(null)}>
                {all.app.cancel}
              </Button>
            </div>
          </div>
        ) : form.moments.length < MOMENTS_MAX ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={locked || momentNaming}
            onClick={() => setMomentDraft('')}
          >
            {text.momentAdd}
          </Button>
        ) : (
          <p className={styles['note']}>{text.momentsFull}</p>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        title={text.momentRemoveTitle(form.moments[removing?.index ?? 0]?.label ?? '')}
        description={
          removing === null || removing.count === 'reading'
            ? ''
            : removing.count === null
              ? text.momentRemoveUnknown
              : text.momentRemoveBody(removing.count)
        }
        confirmLabel={text.momentRemoveYes}
        busy={removing?.count === 'reading'}
        onConfirm={() => {
          if (removing !== null) {
            saveMoments(form.moments.filter((_, at) => at !== removing.index))
          }
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
