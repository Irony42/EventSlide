import { themeSurfaceProps } from '../../../design-system/eventTheme'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { templateTheme } from '../eventTemplates'
import styles from './TemplateThemePreview.module.css'
import type { EventTemplateKey } from '../../../lib/api/dto'

/**
 * A miniature of what a template's theme looks like, beside its card (roadmap 3.5 / 2.2).
 *
 * Surface: the host's laptop, on the create form — the one console screen that shows what
 * the other two will look like.
 *
 * ## It wears the theme; it does not imitate it
 *
 * The root takes `themeSurfaceProps(theme, 'wall')`, which is what `WallPage` spreads onto
 * the projector's own element: the same `--accent-hue`, the same `data-event-accent`,
 * `data-event-fonts`, and `data-event-frame`. Every colour, face and corner
 * below then resolves through `tokens.css` exactly as it does in the room — the accent
 * through `var(--accent)`, the heading through `var(--font-display)`, the photographs'
 * corners through `var(--wall-frame-radius)`. The panel is the one part that is not worn, below. This
 * file and its stylesheet hold no value of their own, so a new frame style or a changed
 * palette reaches the preview in the same commit it reaches the wall, and cannot drift.
 *
 * The console is deliberately not themed (DESIGN-SYSTEM.md section 12), and that is why the
 * attributes go on this element and not above it: nothing else on the page can inherit them.
 *
 * ## The panel
 *
 * Painted `--surface-raised`, the colour every pane of the product is drawn on (the glass
 * material that once sat on it is retired, ADR 0012).
 *
 * ## Decorative, and nothing else
 *
 * `aria-hidden`: the card's list already says, in words, everything this shows, and a screen
 * reader gains nothing from a heading that reads "Votre évènement" five times. It holds no
 * control and is not part of the radio's name or description, so the group's semantics and
 * keyboard behaviour are those of the cards without it. The photographs are plain boxes —
 * a placeholder, never a guest's picture and never a request.
 *
 * Which template carries which appearance is not decided here: `templateTheme` reads the
 * table the server's own rule is pinned to.
 */
export interface TemplateThemePreviewProps {
  /** `null` is "Sans modèle", which previews the product's defaults. */
  readonly template: EventTemplateKey | null
}

const PHOTOS = [0, 1, 2] as const

export function TemplateThemePreview({ template }: TemplateThemePreviewProps) {
  const t = useTranslations()
  const theme = templateTheme(template)

  return (
    <div
      {...themeSurfaceProps(theme, 'wall', { preview: true })}
      className={styles['stage']}
      aria-hidden="true"
      data-template-preview={template ?? 'none'}
    >
      <div className={styles['panel']}>
        <span className={styles['heading']}>{t.admin.templatePreviewSample}</span>
        <span className={styles['accent']} data-preview-accent />
      </div>
      <div className={styles['photos']}>
        {PHOTOS.map((slot) => (
          <span key={slot} className={styles['photo']} data-preview-photo />
        ))}
      </div>
    </div>
  )
}
