import { useId } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Field } from '../../../design-system/components/Field'
import { Textarea } from '../../../design-system/components/Textarea'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './WelcomeMessageField.module.css'

/** The domain's ceiling (`WELCOME_MAX_CHARS`), shown beside the field; the server is what enforces it. */
export const WELCOME_COUNTER_MAX = 280

export interface WelcomeMessageFieldProps {
  /** The text in the form's draft; `null` is "no message". */
  readonly value: string | null
  readonly onChange: (value: string | null) => void
  readonly disabled: boolean
}

/**
 * The host's welcome message: a few words their guests read when they join.
 *
 * No rule lives here. Cleaning, the 280 characters and the 4 lines are the domain's, and its
 * refusals come back by code in the host's language. The counter only tells the host where they
 * stand, counted in code points as the domain counts.
 */
export function WelcomeMessageField({ value, onChange, disabled }: WelcomeMessageFieldProps) {
  const t = useTranslations()
  const counterId = useId()
  const text = value ?? ''
  const count = [...text].length

  return (
    <div className={styles['field']}>
      <Field label={t.admin.welcomeMessage} hint={t.admin.welcomeMessageHint} optional>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={text}
            disabled={disabled}
            placeholder={t.admin.welcomeMessagePlaceholder}
            dir="auto"
            aria-describedby={`${control['aria-describedby'] ?? ''} ${counterId}`.trim()}
            onChange={(changed) => onChange(changed.target.value)}
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
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
          {t.admin.welcomeMessageClear}
        </Button>
      )}
    </div>
  )
}
