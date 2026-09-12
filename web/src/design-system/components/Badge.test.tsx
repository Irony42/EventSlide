import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

/**
 * The glyph is decoration: it is `aria-hidden`, so it has no accessible identity and a
 * structural query is the only handle a test can hold. The word beside it is what the
 * assertions about meaning use.
 */
const glyphsIn = (container: HTMLElement): number => container.querySelectorAll('svg').length

describe('Badge', () => {
  it('pairs the word with a glyph so colour is never the only signal', () => {
    const { container } = render(<Badge tone="danger">Refusée</Badge>)

    // A red-green colourblind host under stage lighting has to be able to tell a
    // published photo from a refused one (DESIGN-SYSTEM.md section 8).
    expect(screen.getByText('Refusée')).toBeVisible()
    expect(glyphsIn(container)).toBe(1)
  })

  it('shows the caller’s glyph instead of the tone’s, not as well as it', () => {
    const { container } = render(
      <Badge tone="success" icon={<span>★</span>}>
        Publiée
      </Badge>,
    )

    expect(screen.getByText('★')).toBeVisible()
    expect(glyphsIn(container)).toBe(0)
  })

  it('drops the glyph entirely for a badge that is only a count', () => {
    const { container } = render(<Badge icon={null}>3</Badge>)

    // A status glyph next to a number claims a status the number does not have.
    expect(screen.getByText('3')).toBeVisible()
    expect(glyphsIn(container)).toBe(0)
  })
})
