import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TemplateThemePreview } from './TemplateThemePreview'
import { EVENT_TEMPLATE_KEYS } from '../eventTemplates'
import { fr } from '../../../lib/i18n/fr'
import type { EventTemplateKey } from '../../../lib/api/dto'

/**
 * The miniature beside a template's card.
 *
 * What it must get right is which appearance it wears, and that it wears it through the
 * attributes the room's own element carries: a preview drawn some other way would be a
 * second copy of the look, free to drift from the first. jsdom computes no custom property,
 * so these assertions are on the mechanism — the markers `tokens.css` keys on — and the
 * stylesheet's half (that `var(--accent)` really resolves through them) is the real
 * browser's, which `tests/e2e/journeys/template-theme-preview.spec.ts` measures.
 *
 * The expectations are written out per template rather than read back from the table the
 * component reads, because a test that derives its answer from the same lookup is a test
 * that cannot fail when the lookup is wrong. They are the card's own words — "Rose,
 * Classique, Coins très arrondis" for a wedding — as attributes, and the picker's test
 * holds the two halves together.
 */

/** `null` is an attribute that must be absent: the default is never rendered as a value. */
const APPEARANCE: Readonly<
  Record<EventTemplateKey, { accent: string | null; fonts: string | null; frame: string | null }>
> = {
  wedding: { accent: '345', fonts: 'serif', frame: 'round' },
  birthday: { accent: null, fonts: null, frame: 'round' },
  conference: { accent: '250', fonts: null, frame: 'square' },
  party: { accent: '195', fonts: null, frame: null },
}

const previewOf = (container: HTMLElement): HTMLElement => {
  const preview = container.querySelector<HTMLElement>('[data-template-preview]')
  if (preview === null) throw new Error('no preview rendered')
  return preview
}

describe('TemplateThemePreview', () => {
  it.each(EVENT_TEMPLATE_KEYS)("wears %s's own accent, typography and photo frame", (key) => {
    const { container } = render(<TemplateThemePreview template={key} />)
    const preview = previewOf(container)
    const expected = APPEARANCE[key]

    expect(preview.getAttribute('data-event-accent')).toBe(expected.accent)
    expect(preview.getAttribute('data-event-fonts')).toBe(expected.fonts)
    expect(preview.getAttribute('data-event-frame')).toBe(expected.frame)
    // The angle `tokens.css` derives the palette from, set the way the wall sets it.
    expect(preview.style.getPropertyValue('--accent-hue')).toBe(expected.accent ?? '')
  })

  it('previews the defaults for "Sans modèle", which sets no appearance', () => {
    // Nothing on the element at all, not the default values spelled out: it is the DOM an
    // unthemed wall renders, so the product's own look is what resolves.
    const { container } = render(<TemplateThemePreview template={null} />)
    const preview = previewOf(container)

    expect(preview.getAttribute('data-template-preview')).toBe('none')
    expect(preview).not.toHaveAttribute('data-event-accent')
    expect(preview).not.toHaveAttribute('data-event-fonts')
    expect(preview).not.toHaveAttribute('data-event-frame')
    expect(preview.style.getPropertyValue('--accent-hue')).toBe('')
  })

  it.each([...EVENT_TEMPLATE_KEYS, null] as const)(
    'is decorative: hidden from assistive technology and holding nothing to operate (%s)',
    (key) => {
      const { container } = render(<TemplateThemePreview template={key} />)
      const preview = previewOf(container)

      expect(preview).toHaveAttribute('aria-hidden', 'true')
      expect(
        preview.querySelectorAll('a, button, input, select, textarea, [tabindex], [role]'),
      ).toHaveLength(0)
    },
  )

  it.each([...EVENT_TEMPLATE_KEYS, null] as const)(
    'shows three placeholder photographs and no real one (%s)',
    (key) => {
      // A guest's photograph on the create form would be a request for it, and the
      // preview's weight on the page is the point of it being boxes.
      const { container } = render(<TemplateThemePreview template={key} />)

      expect(container.querySelectorAll('img, video, canvas, svg')).toHaveLength(0)
      expect(previewOf(container).querySelectorAll('[data-preview-photo]')).toHaveLength(3)
    },
  )

  it('sets its heading in words the interface translates', () => {
    const { container } = render(<TemplateThemePreview template="wedding" />)

    expect(previewOf(container)).toHaveTextContent(fr.admin.templatePreviewSample)
  })
})
