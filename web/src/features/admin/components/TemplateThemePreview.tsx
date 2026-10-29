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
 * `data-event-fonts`, `data-event-frame` and `data-glass`. Every colour, face and corner
 * below then resolves through `tokens.css` exactly as it does in the room — the accent
 * through `var(--accent)`, the heading through `var(--font-display)`, the photographs'
 * corners through `var(--wall-frame-radius)`. The panel is the one part that is not worn, below. This
 * file and its stylesheet hold no value of their own, so a new frame style or a changed
 * palette reaches the preview in the same commit it reaches the wall, and cannot drift.
 *
 * The console is deliberately not themed (DESIGN-SYSTEM.md section 12), and that is why the
 * attributes go on this element and not above it: nothing else on the page can inherit them.
 *
 * ## What the panel does not show, and why
 *
 * `data-glass` is carried like the rest, but the panel is painted `--surface-raised` and does
 * not compose the glass sheet. Wearing it would put this screen into the material's guards —
 * `glass.material.test.ts` lists the argued wearers (a pane with content moving under it, which
 * a static miniature is not), and `glassBackdrop.test.ts` refuses a `ground` claim for a page
 * that can reach `glass.module.css`, which would move `/admin/events/new` to the strict floor
 * and blunt the test that proves the router's ranking. And nothing would be gained to look at:
 * every template sets `glass`, the default, and glass over a flat ground is within a tint of the
 * opaque colour — the difference is the blur over motion, which a still box cannot show.
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
