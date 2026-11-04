import { useId } from 'react'
import { Icon } from '../../../../design-system/components/Icon'
import { THEME_AMBIANCES, isThemeAmbiance } from '../../../../design-system/eventTheme'
import type { EventSettingsDto } from '../../../../lib/api/dto'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import styles from './controls.module.css'

type Ambiance = EventSettingsDto['theme']['ambiance']

export interface AmbianceSwatchesProps {
  readonly value: Ambiance
  /** Never called with `custom`: that one is made on its own page. */
  readonly onChange: (ambiance: Exclude<Ambiance, 'custom'>) => void
}

/**
 * The drawn ambiances as swatches: a "Aa" on the ambiance's own ground with its accent. The swatch
 * wears the ambiance through `data-event-ambiance`, the way a template preview does, so its colours
 * are the real tokens and `data-template-preview` keeps the page around it on the event's own look.
 * « Sur mesure » is listed only while it is the current one.
 */
export function AmbianceSwatches({ value, onChange }: AmbianceSwatchesProps) {
  const t = useTranslations()
  const name = useId()
  const shown = THEME_AMBIANCES.filter((ambiance) => ambiance !== 'custom' || value === 'custom')

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t.admin.themeAmbiance}</legend>
      <div className={styles['swatches']}>
        {shown.map((ambiance) => (
          <label key={ambiance} className={styles['tile']}>
            <input
              type="radio"
              className={styles['input']}
              name={name}
              checked={value === ambiance}
              disabled={ambiance === 'custom'}
              onChange={() => {
                if (isThemeAmbiance(ambiance) && ambiance !== 'custom') onChange(ambiance)
              }}
            />
            {ambiance === 'custom' ? (
              <span className={styles['swatch']}>
                <Icon name="palette" />
              </span>
            ) : (
              <span
                className={styles['swatch']}
                aria-hidden="true"
                data-event-ambiance={ambiance}
                data-template-preview="swatch"
              >
                <b>Aa</b>
                <i />
              </span>
            )}
            <span>{t.admin.themeAmbianceNames[ambiance]}</span>
            <Icon name="check" size="sm" className={styles['check']} />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
