import { useId } from 'react'
import type { EventSettingsDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  QR_CORNERS as CORNERS,
  QR_SCALE_MARKS,
  QR_SCALE_MAX,
  QR_SCALE_MIN,
  QR_SCALE_STEP,
} from '../../../lib/wallDisplayOptions'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import styles from './WallQrControls.module.css'

type WallSettings = EventSettingsDto['wall']

export interface WallQrControlsProps {
  readonly wall: Pick<WallSettings, 'qrVisible' | 'qrScale' | 'qrPlacement'>
  readonly onChange: (
    patch: Partial<Pick<WallSettings, 'qrVisible' | 'qrScale' | 'qrPlacement'>>,
  ) => void
  readonly disabled?: boolean
}

/**
 * The invitation card's three settings, one control set for the settings page and the wall's
 * panel (spec 14): a vocabulary, not two. The size is a slider with marks, never three sizes only.
 */
export function WallQrControls({ wall, onChange, disabled = false }: WallQrControlsProps) {
  const t = useTranslations()
  const text = t.admin.wallDisplay
  const id = useId()
  const shown = wall.qrScale
  const marks: readonly (readonly [string, number])[] = [
    [text.qrSizeSmall, QR_SCALE_MARKS.small],
    [text.qrSizeMedium, QR_SCALE_MARKS.medium],
    [text.qrSizeLarge, QR_SCALE_MARKS.large],
  ]

  return (
    <div className={styles['root']}>
      <CheckboxField
        label={text.qrVisible}
        hint={text.qrVisibleHint}
        checked={wall.qrVisible}
        disabled={disabled}
        onChange={(qrVisible) => onChange({ qrVisible })}
      />
      <div className={styles['group']}>
        <label htmlFor={`${id}-scale`} className={styles['legend']}>
          {text.qrSize} <span>{text.qrSizeValue(shown)}</span>
        </label>
        <input
          id={`${id}-scale`}
          type="range"
          className={styles['slider']}
          min={QR_SCALE_MIN}
          max={QR_SCALE_MAX}
          step={QR_SCALE_STEP}
          value={shown}
          list={`${id}-marks`}
          disabled={disabled || !wall.qrVisible}
          aria-describedby={`${id}-scale-hint`}
          onChange={(event) => onChange({ qrScale: Number(event.target.value) })}
        />
        <datalist id={`${id}-marks`}>
          {marks.map(([, value]) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className={styles['marks']}>
          {marks.map(([label, value]) => (
            <button
              key={value}
              type="button"
              className={styles['mark']}
              aria-pressed={shown === value}
              disabled={disabled || !wall.qrVisible}
              onClick={() => onChange({ qrScale: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p id={`${id}-scale-hint`} className={styles['hint']}>
          {text.qrSizeHint}
        </p>
      </div>
      <fieldset className={styles['group']} disabled={disabled || !wall.qrVisible}>
        <legend className={styles['legend']}>{text.qrPlacement}</legend>
        <div className={styles['corners']}>
          {CORNERS.map((corner) => (
            <label key={corner} className={styles['corner']}>
              <input
                type="radio"
                name={`${id}-corner`}
                checked={wall.qrPlacement === corner}
                onChange={() => onChange({ qrPlacement: corner })}
              />
              {text.qrCorners[corner]}
            </label>
          ))}
        </div>
        <p className={styles['hint']}>{text.qrPlacementHint}</p>
      </fieldset>
    </div>
  )
}
