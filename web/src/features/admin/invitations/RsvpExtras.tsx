import { useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { SelectField } from '../../../design-system/components/SelectField'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import type { RsvpFormInput } from '../../../lib/api/client/invite'
import type { RsvpFormDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  linesOf,
  questionsInput,
  QUESTIONS_MAX,
  type QuestionDraft,
} from '../../../lib/rsvp/rsvpExtras'
import styles from './RsvpPanel.module.css'

/**
 * What a wedding or a dinner asks beyond the count (spec 30, lot 2): the companions' first names,
 * a menu per person and up to three questions of the host's own. **A text is sent when it is left**
 * (a half-typed list of menus is not a choice), and a question already saved keeps its id whatever
 * its label becomes; the server judges every value.
 */

export interface RsvpExtrasProps {
  readonly form: RsvpFormDto
  readonly locked: boolean
  readonly change: (input: RsvpFormInput) => void
}

/** A text kept on screen while it is typed, sent when the field is left and only if it changed. */
function CommitField({
  label,
  hint,
  value,
  multiline = false,
  disabled,
  onCommit,
}: {
  readonly label: string
  readonly hint?: string
  readonly value: string
  readonly multiline?: boolean
  readonly disabled: boolean
  readonly onCommit: (value: string) => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const shown = typed ?? value
  const leave = () => {
    if (typed !== null && typed !== value) onCommit(typed)
    setTyped(null)
  }
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) =>
        multiline ? (
          <Textarea
            {...control}
            rows={3}
            value={shown}
            disabled={disabled}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={leave}
          />
        ) : (
          <TextInput
            {...control}
            value={shown}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={leave}
          />
        )
      }
    </Field>
  )
}

export function RsvpExtras({ form, locked, change }: RsvpExtrasProps) {
  const all = useTranslations()
  const text = all.rsvp.host
  /** The menus are being written: the switch is on screen before it can be sent (it needs 2 menus). */
  const [mealsOpen, setMealsOpen] = useState(false)
  const [draft, setDraft] = useState<QuestionDraft | null>(null)
  const mealsOn = form.meals.enabled || mealsOpen

  const save = (questions: readonly QuestionDraft[]) =>
    change({ form: { questions: questionsInput(questions) } })

  return (
    <>
      <CheckboxField
        label={text.companionsLabel}
        hint={text.companionsHint}
        checked={form.companionNames}
        disabled={locked}
        onChange={(companionNames) => change({ form: { companionNames } })}
      />
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
              disabled={locked || question.id === ''}
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
                disabled={locked || question.id === ''}
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
              disabled={locked || question.id === ''}
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
            disabled={locked}
            onClick={() => setDraft({ id: '', label: '', kind: 'text', options: [] })}
          >
            {text.questionAdd}
          </Button>
        ) : (
          <p className={styles['note']}>{text.questionsFull}</p>
        )}
      </div>
    </>
  )
}
