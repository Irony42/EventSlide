import { useId, useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Field } from '../../../design-system/components/Field'
import { Textarea } from '../../../design-system/components/Textarea'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './WelcomeMessageField.module.css'

/** The domain's ceiling (`WELCOME_MAX_CHARS`), shown beside the field; the server is what enforces it. */
export const WELCOME_COUNTER_MAX = 280

export interface WelcomeMessageFieldProps {
  /** The text the event holds; `null` is "no message". */
  readonly value: string | null
  /**
   * The text the host settled on: called when they leave the field (or clear it), not on every key,
   * because the page saves what it is given and a message is written a word at a time.
   */
  readonly onChange: (value: string | null) => void
  readonly disabled: boolean
  /** A heading above already names the field: its label stays for assistive technology only. */
  readonly hideLabel?: boolean
}

/**
 * The host's welcome message: a few words their guests read when they join.
 *
 * No rule lives here. Cleaning, the 280 characters and the 4 lines are the domain's, and its
 * refusals come back by code in the host's language. The counter only tells the host where they
 * stand, counted in code points as the domain counts.
 *
 * The field keeps its own copy while the host types. A new `value` from the server replaces it; a
 * refused save leaves `value` where it was, so what the host typed stays in front of them to fix.
 */
export function WelcomeMessageField({
  value,
  onChange,
  disabled,
  hideLabel = false,
}: WelcomeMessageFieldProps) {
  const t = useTranslations()
  const counterId = useId()
  const [text, setText] = useState(value ?? '')
  const [syncedFrom, setSyncedFrom] = useState(value)
  if (value !== syncedFrom) {
    setSyncedFrom(value)
    setText(value ?? '')
  }
  const count = [...text].length

  return (
    <div className={styles['field']}>
      <Field
        label={t.admin.welcomeMessage}
        hint={t.admin.welcomeMessageHint}
        optional={!hideLabel}
        hideLabel={hideLabel}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={text}
            disabled={disabled}
            placeholder={t.admin.welcomeMessagePlaceholder}
            dir="auto"
            aria-describedby={`${control['aria-describedby'] ?? ''} ${counterId}`.trim()}
            onChange={(changed) => setText(changed.target.value)}
            onBlur={() => {
              if (text !== (value ?? '')) onChange(text)
            }}
          />
        )}
      </Field>
      <p
        id={counterId}
        className={count > WELCOME_COUNTER_MAX ? styles['countOver'] : styles['count']}
      >
        {t.admin.welcomeMessageCount(count, WELCOME_COUNTER_MAX)}
      </p>
      {text.length === 0 ? null : (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setText('')
            onChange(null)
          }}
        >
          {t.admin.welcomeMessageClear}
        </Button>
      )}
    </div>
  )
}
