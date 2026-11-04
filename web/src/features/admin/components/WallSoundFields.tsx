import { useEffect, useId, useRef } from 'react'
import { Button } from '../../../design-system/components/Button'
import type { EventSettingsDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  createWallSoundPlayer,
  WALL_SOUND_TONES,
  type WallSoundPlayer,
} from '../../../lib/wallSoundPlayer'
import { CheckboxField } from './CheckboxField'
import styles from './WallSoundFields.module.css'

type WallSettings = EventSettingsDto['wall']

export interface WallSoundFieldsProps {
  readonly wall: WallSettings
  readonly onChange: (patch: Partial<WallSettings>) => void
  readonly disabled?: boolean
}

/**
 * The host's "Son" sub-block of "Affichage du mur" (spec 12): the switch, one of four tones, the
 * volume, and a "Test" that plays the chosen tone on **this** computer (a click is the gesture a
 * browser wants). Controlled: the page owns the draft and saves it with the rest.
 */
export function WallSoundFields({ wall, onChange, disabled = false }: WallSoundFieldsProps) {
  const t = useTranslations().admin.wallSound
  const group = useId()
  const player = useRef<WallSoundPlayer | null>(null)

  useEffect(
    () => () => {
      player.current?.close()
      player.current = null
    },
    [],
  )

  const test = () => {
    player.current ??= createWallSoundPlayer()
    const active = player.current
    void active.activate().then(async () => {
      await active.load(wall.soundTone)
      active.play(wall.soundTone, wall.soundVolume)
    })
  }

  return (
    <fieldset className={styles['root']}>
      <legend className={styles['legend']}>{t.title}</legend>
      <p className={styles['hint']}>{t.hint}</p>
      <CheckboxField
        label={t.enable}
        hint={t.enableHint}
        checked={wall.soundEnabled}
        disabled={disabled}
        onChange={(soundEnabled) => onChange({ soundEnabled })}
      />
      <div role="radiogroup" aria-label={t.tone}>
        {WALL_SOUND_TONES.map((tone) => (
          <label key={tone} className={styles['choice']}>
            <input
              type="radio"
              className={styles['radio']}
              name={`${group}-tone`}
              value={tone}
              checked={wall.soundTone === tone}
              disabled={disabled}
              onChange={() => onChange({ soundTone: tone })}
            />
            {t.toneNames[tone]}
          </label>
        ))}
      </div>
      <div className={styles['volume']}>
        <input
          type="range"
          className={styles['slider']}
          aria-label={t.volume}
          min={0}
          max={100}
          step={1}
          value={wall.soundVolume}
          disabled={disabled}
          onChange={(event) => onChange({ soundVolume: Number(event.target.value) })}
        />
        <span className={styles['value']} aria-hidden="true">
          {t.volumeValue(wall.soundVolume)}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={test}
          title={t.testHint}
        >
          {t.test}
        </Button>
      </div>
    </fieldset>
  )
}
