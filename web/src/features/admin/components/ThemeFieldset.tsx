import type { CSSProperties } from 'react'
import {
  accentNameFor,
  CURATED_ACCENT_HUES,
  CURATED_ACCENT_NAMES,
  isThemeFonts,
  isThemeFrame,
  THEME_FONTS,
  THEME_FRAMES,
  type CuratedAccent,
} from '../../../design-system/eventTheme'
import { fr } from '../../../lib/i18n/fr'
import { SelectField } from './SelectField'
import styles from './ThemeFieldset.module.css'
import type { EventThemeDto } from '../../../lib/api/dto'

/**
 * What a host actually picks (roadmap 2.2): a colour, a typography, a frame.
 *
 * **Four named colours and not a colour wheel.** An arbitrary picker guarantees
 * unreadable walls and a support queue, and it asks a host setting up a wedding at 18:00
 * to make a judgement about contrast they have no way to make. Four options they can
 * compare at a glance is both the easier decision and the one that cannot go wrong — the
 * server would refuse an illegible hue anyway (`src/domain/events/eventTheme.ts`), so
 * offering one here would only be a form that cannot be submitted.
 *
 * The swatch is a live preview rather than a printed colour: it sets `--accent-hue` on
 * itself and paints with `var(--accent)`, so what the host sees is the same derivation
 * the wall will run, and this component contains no colour of its own. That is also the
 * only honest preview available — the console itself is deliberately not themed.
 *
 * Surface: the host's laptop, before the event.
 */

type SwatchStyle = CSSProperties & { readonly '--accent-hue': string }

/** Declared rather than written inline, so the custom property keeps its own type. */
const swatchStyle = (hue: number): SwatchStyle => ({ '--accent-hue': String(hue) })

export interface ThemeFieldsetProps {
  readonly theme: EventThemeDto
  readonly disabled: boolean
  readonly onChange: (theme: EventThemeDto) => void
}

// The vocabulary comes from the design system, the wording from `lib/i18n/`. A list
// derived from the copy table would make a reorganisation of that file reorder the
// controls, and it would offer whatever key somebody added there rather than what the
// server accepts.
const fontOptions = THEME_FONTS.map((value) => ({
  value,
  label: fr.admin.themeFontsNames[value],
}))

const frameOptions = THEME_FRAMES.map((value) => ({
  value,
  label: fr.admin.themeFrameNames[value],
}))

export function ThemeFieldset({ theme, disabled, onChange }: ThemeFieldsetProps) {
  const selected: CuratedAccent | null = accentNameFor(theme.accentHue)

  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{fr.admin.theme}</legend>
      <p className={styles['hint']}>{fr.admin.themeHint}</p>

      <fieldset className={styles['colours']} data-testid="theme-accents">
        {/* Nested, so the radio group has a name of its own for a screen reader:
            "Apparence, Couleur, Rose" is what a host hears, not four unattached radios. */}
        <legend className={styles['legend']}>{fr.admin.themeAccent}</legend>
        {CURATED_ACCENT_NAMES.map((name) => (
          /*
            The whole row previews its own colour, and the marker is not decoration:
            `tokens.css` re-derives `--accent` for `[data-event-accent]`, because a custom
            property that references another is resolved on the element it is declared on.
            Moving `--accent-hue` alone would leave every swatch — and the radio's own
            `accent-color` — the product's violet beside four different names.

            This is the one themed element in the console, and it is this narrow on
            purpose: inside a label there is a radio and a swatch, and nothing else can
            inherit it.
          */
          <label
            key={name}
            className={styles['choice']}
            data-event-accent={String(CURATED_ACCENT_HUES[name])}
            style={swatchStyle(CURATED_ACCENT_HUES[name])}
          >
            <input
              type="radio"
              className={styles['radio']}
              name="themeAccent"
              value={name}
              checked={selected === name}
              disabled={disabled}
              onChange={() => onChange({ ...theme, accentHue: CURATED_ACCENT_HUES[name] })}
            />
            {/* The colour is never the only signal (DESIGN-SYSTEM.md section 8): the
                swatch sits beside its name and the radio carries the state. */}
            <span className={styles['swatch']} aria-hidden="true" />
            {fr.admin.themeAccentNames[name]}
          </label>
        ))}
      </fieldset>

      <SelectField
        label={fr.admin.themeFonts}
        hint={fr.admin.themeFontsHint}
        value={theme.fonts}
        options={fontOptions}
        disabled={disabled}
        onChange={(value) => {
          if (isThemeFonts(value)) onChange({ ...theme, fonts: value })
        }}
      />

      <SelectField
        label={fr.admin.themeFrame}
        value={theme.frame}
        options={frameOptions}
        disabled={disabled}
        onChange={(value) => {
          if (isThemeFrame(value)) onChange({ ...theme, frame: value })
        }}
      />
    </fieldset>
  )
}
