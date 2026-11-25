import { useId } from 'react'
import {
  isThemeFonts,
  isThemeFrame,
  themeSurfaceProps,
  THEME_FONTS,
  THEME_FRAMES,
} from '../../../design-system/eventTheme'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './ScreenDetails.module.css'
import type { EventThemeDto, ThemeFonts } from '../../../lib/api/dto'

export interface ScreenDetailsProps {
  readonly theme: EventThemeDto
  readonly disabled: boolean
  readonly onChange: (theme: EventThemeDto) => void
}

/**
 * The two details of the room's screen, folded away (mock-up B1): the corner of the photographs and
 * the face of the event's name. A native `<details>`, closed, whose summary says what they are set
 * to, so the host who never opens it still reads their own choices.
 *
 * Surface: the host's laptop or phone, before the event.
 *
 * The stored values and what they do are unchanged (`theme.frame`, `theme.fonts`; the wall wears
 * them through `themeSurfaceProps`). Each choice is a tile that **shows** it instead of naming it:
 * the corner is drawn with the wall's own radius token (`data-event-frame` re-declares
 * `--wall-frame-radius`), and « Aa » is set in the face the wall would use, the ambiance's display
 * face or the serif stack (`data-event-fonts`), on the element that carries the ambiance
 * (`data-template-preview` keeps it from dressing the console). Nothing here chooses a radius or a
 * face. The choice is told by an edge and a tint, not by colour alone, and the radios are real.
 */
export function ScreenDetails({ theme, disabled, onChange }: ScreenDetailsProps) {
  const t = useTranslations()
  const frames = useId()
  const fonts = useId()
  const copy = t.admin.appearance

  const fontsName = (value: ThemeFonts): string =>
    value === 'sans' ? copy.fontsAmbiance : copy.fontsClassic
  const summary = [
    t.admin.themeFrameNames[theme.frame],
    theme.fonts === 'sans' ? copy.fontsAmbianceSummary : copy.fontsClassicSummary,
  ].join(', ')

  // The ambiance and the face only: a venue photograph has no part in a letter.
  const { groundUrl: _venue, ...own } = theme

  return (
    <details className={styles['details']}>
      <summary className={styles['summary']}>
        <span className={styles['title']}>{copy.detailsTitle}</span>
        <small className={styles['current']}>{summary}</small>
      </summary>

      <fieldset className={styles['tiles']}>
        <legend className={styles['legend']}>{t.admin.themeFrame}</legend>
        {THEME_FRAMES.map((frame) => (
          <label key={frame} className={styles['tile']}>
            <input
              type="radio"
              className={styles['input']}
              name={frames}
              value={frame}
              checked={theme.frame === frame}
              disabled={disabled}
              onChange={() => {
                if (isThemeFrame(frame)) onChange({ ...theme, frame })
              }}
            />
            <span
              className={styles['corner']}
              aria-hidden="true"
              // The default is absent, as on the wall: the root's radius is the soft one.
              data-event-frame={frame === 'soft' ? undefined : frame}
              data-template-preview="frame"
            />
            {t.admin.themeFrameNames[frame]}
          </label>
        ))}
      </fieldset>

      <fieldset className={styles['tiles']}>
        <legend className={styles['legend']}>{copy.fontsLegend}</legend>
        {THEME_FONTS.map((value) => (
          <label key={value} className={styles['tile']}>
            <input
              type="radio"
              className={styles['input']}
              name={fonts}
              value={value}
              checked={theme.fonts === value}
              disabled={disabled}
              onChange={() => {
                if (isThemeFonts(value)) onChange({ ...theme, fonts: value })
              }}
            />
            <span
              {...themeSurfaceProps({ ...own, fonts: value }, 'wall', { preview: true })}
              className={styles['aa']}
              aria-hidden="true"
              data-template-preview="fonts"
            >
              Aa
            </span>
            {fontsName(value)}
          </label>
        ))}
      </fieldset>
    </details>
  )
}
