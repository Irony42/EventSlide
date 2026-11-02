import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'

export interface HighlightToggleProps {
  readonly highlighted: boolean
  readonly onToggle: () => void
  readonly size?: 'sm' | 'md' | 'lg'
}

/**
 * The host's star on a published photograph (spec 08): a favourite for the best-of.
 *
 * A real toggle button: the name is fixed ("Favori"), and the state is `aria-pressed`, so a
 * screen reader hears "Favori, pressed" rather than a label that flips under it. The state is
 * never carried by the colour alone: the glyph is full or outlined, and the `title` says what
 * pressing does.
 */
export function HighlightToggle({ highlighted, onToggle, size = 'sm' }: HighlightToggleProps) {
  const t = useTranslations()
  return (
    <Button
      variant="ghost"
      size={size}
      aria-label={t.moderation.highlight}
      aria-pressed={highlighted}
      title={highlighted ? t.moderation.highlightRemoveHint : t.moderation.highlightAddHint}
      onClick={onToggle}
    >
      <span aria-hidden="true">{highlighted ? '★' : '☆'}</span> {t.moderation.highlight}
    </Button>
  )
}
