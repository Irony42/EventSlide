import { useId } from 'react'
import type { EventSettingsDto } from '../../../../lib/api/dto'
import { CheckboxField } from '../../../admin/components/CheckboxField'
import {
  QR_CORNERS,
  QR_SCALE_MARKS,
  QR_SCALE_MAX,
  QR_SCALE_MIN,
  QR_SCALE_STEP,
} from '../../../admin/wallDisplayOptions'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import styles from './controls.module.css'

type WallSettings = EventSettingsDto['wall']
type QrSettings = Pick<WallSettings, 'qrVisible' | 'qrScale' | 'qrPlacement'>

export interface QrPickerProps {
  readonly wall: QrSettings
  readonly onChange: (patch: Partial<QrSettings>) => void
}

/** The scale the stylesheet draws (`data-scale` is hundredths); out of range, the middle one. */
const scaleKey = (scale: number): string =>
  scale >= QR_SCALE_MIN && scale <= QR_SCALE_MAX ? String(Math.round(scale * 100)) : '100'

/**
 * The invitation card's three settings (spec 14), drawn on a miniature of the wall: the card sits
 * in the chosen corner at the chosen size, and the four corners are the radios. Same keys and same
 * words as `WallQrControls`, which the settings page keeps.
 */
export function QrPicker({ wall, onChange }: QrPickerProps) {
  const t = useTranslations()
  const text = t.admin.wallDisplay
  const id = useId()
  const off = !wall.qrVisible
  const marks: readonly (readonly [string, number])[] = [
    [text.qrSizeSmall, QR_SCALE_MARKS.small],
    [text.qrSizeMedium, QR_SCALE_MARKS.medium],
    [text.qrSizeLarge, QR_SCALE_MARKS.large],
  ]

  return (
    <div className={styles['qr']}>
      <CheckboxField
        label={text.qrVisible}
        hint={text.qrVisibleHint}
        checked={wall.qrVisible}
        onChange={(qrVisible) => onChange({ qrVisible })}
      />
      <fieldset className={styles['field']} disabled={off}>
        <legend className={styles['legend']}>{text.qrPlacement}</legend>
        <div className={styles['mini']} data-scale={scaleKey(wall.qrScale)} data-hidden={off}>
          <span className={styles['miniPhoto']} />
          <span className={styles['miniPhoto']} />
          <span className={styles['miniPhoto']} />
          <span className={styles['joinCard']} data-corner={wall.qrPlacement} aria-hidden="true" />
          {QR_CORNERS.map((corner) => (
            <label key={corner} className={styles['corner']} data-corner={corner}>
              <input
                type="radio"
                className={styles['input']}
                name={`${id}-corner`}
                checked={wall.qrPlacement === corner}
                onChange={() => onChange({ qrPlacement: corner })}
              />
              <span className={styles['vh']}>{text.qrCorners[corner]}</span>
            </label>
          ))}
        </div>
        <p className={styles['hint']}>{text.qrPlacementHint}</p>
      </fieldset>
      <div className={styles['field']}>
        <label htmlFor={`${id}-scale`} className={styles['legend']}>
          {text.qrSize} <span>{text.qrSizeValue(wall.qrScale)}</span>
        </label>
        <input
          id={`${id}-scale`}
          type="range"
          className={styles['slider']}
          min={QR_SCALE_MIN}
          max={QR_SCALE_MAX}
          step={QR_SCALE_STEP}
          value={wall.qrScale}
          disabled={off}
          aria-describedby={`${id}-scale-hint`}
          onChange={(event) => onChange({ qrScale: Number(event.target.value) })}
        />
        <div className={styles['marks']}>
          {marks.map(([label, value]) => (
            <button
              key={value}
              type="button"
              className={styles['mark']}
              aria-pressed={wall.qrScale === value}
              disabled={off}
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
    </div>
  )
}
