import { useId } from 'react'
import { RHYTHM_STEPS_SECONDS } from '../../../admin/wallDisplayOptions'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import styles from './controls.module.css'

export interface RhythmStepsProps {
  /** `null`: the default rhythm. */
  readonly valueMs: number | null
  readonly onChange: (valueMs: number | null) => void
}

/**
 * How long a photo stays, as circles that grow with the time: the default, then the steps of the
 * settings page. A rhythm the server holds that is not a step is shown as it is, never rewritten.
 */
export function RhythmSteps({ valueMs, onChange }: RhythmStepsProps) {
  const t = useTranslations()
  const name = useId()
  const seconds = valueMs === null ? null : valueMs / 1_000
  const extra = seconds !== null && !RHYTHM_STEPS_SECONDS.includes(seconds) ? [seconds] : []
  const steps = [...RHYTHM_STEPS_SECONDS, ...extra].sort((a, b) => a - b)

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t.admin.wallDisplay.interval}</legend>
      <div className={styles['steps']}>
        <label className={styles['step']} data-auto="true">
          <input
            type="radio"
            className={styles['input']}
            name={name}
            checked={valueMs === null}
            onChange={() => onChange(null)}
          />
          <i />
          <span>{t.wall.panel.rhythmAuto}</span>
        </label>
        {steps.map((step) => (
          <label key={step} className={styles['step']} data-seconds={step}>
            <input
              type="radio"
              className={styles['input']}
              name={name}
              checked={seconds === step}
              onChange={() => onChange(step * 1_000)}
            />
            <i />
            <span>{t.wall.panel.summaryRhythm(step)}</span>
          </label>
        ))}
      </div>
      <p className={styles['hint']}>{t.admin.wallDisplay.intervalHint}</p>
    </fieldset>
  )
}
