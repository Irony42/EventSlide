import { useId } from 'react'
import { Icon } from '../../../design-system/components/Icon'
import {
  accentNameFor,
  CURATED_ACCENT_HUES,
  CURATED_ACCENT_NAMES,
  themeSurfaceProps,
  type CuratedAccent,
} from '../../../design-system/eventTheme'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './AccentSwatches.module.css'
import type { EventThemeDto } from '../../../lib/api/dto'

export interface AccentSwatchesProps {
  readonly theme: EventThemeDto
  readonly disabled: boolean
  readonly onChange: (accentHue: number) => void
}

/**
 * The four colours of the event, in a row (mock-up B1): round swatches with their name under them.
 * The same four values as the settings page offered, now after the ambiance they sit on.
 *
 * Surface: the host's laptop or phone, before the event.
 *
 * **The first one is the ambiance's own accent, not always violet.** The stored hue 305 is the
 * default and means « no colour of the host's »: the surface then wears its ambiance's accent. The
 * swatch is drawn the way the surface is, with `themeSurfaceProps` and the current ambiance
 * (`data-event-ambiance`, plus the custom object's attributes), so the dot paints what the guest's
 * buttons will, Champs d'or's honey as much as EventSlide's violet. The three others carry
 * `data-event-accent`, which `tokens.css` derives their palette from, in the polarity the ambiance
 * has. `data-template-preview` keeps every dot from dressing the console around it.
 *
 * Four named colours and not a wheel: an arbitrary picker is what makes unreadable walls, and the
 * server would refuse an illegible angle anyway (`src/domain/events/eventTheme.ts`). The colour is
 * never the only signal: the chosen swatch carries a ring and a check mark, and every one its name.
 */
export function AccentSwatches({ theme, disabled, onChange }: AccentSwatchesProps) {
  const t = useTranslations()
  const group = useId()
  const selected: CuratedAccent | null = accentNameFor(theme.accentHue)
  const names: Record<CuratedAccent, string> = {
    ...t.admin.themeAccentNames,
    violet: t.admin.appearance.colourFromAmbiance,
  }

  return (
    <fieldset className={styles['swatches']} data-testid="theme-accents">
      <legend className="visually-hidden">{t.admin.appearance.colourTitle}</legend>
      {CURATED_ACCENT_NAMES.map((name) => {
        // Only the ambiance and the hue: no photograph to paint a dot with.
        const { groundUrl: _venue, ...own } = theme
        const dot = themeSurfaceProps({ ...own, accentHue: CURATED_ACCENT_HUES[name] }, 'guest', {
          preview: true,
        })
        return (
          <label key={name} className={styles['swatch']}>
            <input
              type="radio"
              className={styles['input']}
              name={group}
              value={name}
              checked={selected === name}
              disabled={disabled}
              onChange={() => onChange(CURATED_ACCENT_HUES[name])}
            />
            <span className={styles['ring']}>
              <span
                {...dot}
                className={styles['dot']}
                aria-hidden="true"
                data-template-preview="accent"
                data-swatch={name}
              >
                <Icon name="check" size="sm" className={styles['check']} />
              </span>
            </span>
            <span className={styles['name']}>{names[name]}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
