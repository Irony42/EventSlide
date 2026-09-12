import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VisuallyHidden } from './VisuallyHidden'
// The clip technique lives in base.css rather than in a colocated module, because the
// skip link and the live regions need it before any component mounts. Loading the same
// stylesheet the app loads is what makes the rule below observable instead of a claim
// about a class name.
import '../base.css'

describe('VisuallyHidden', () => {
  it('keeps its text in the accessibility tree while taking it off the screen', () => {
    render(<VisuallyHidden>3 photos en attente</VisuallyHidden>)

    const style = window.getComputedStyle(screen.getByText('3 photos en attente'))

    // `display: none` and `visibility: hidden` would take the text out of the
    // accessibility tree too, which is the one thing this component must never do.
    expect(style.display).not.toBe('none')
    expect(style.visibility).not.toBe('hidden')
    expect(style.clipPath).toBe('inset(50%)')
    expect(style.width).toBe('1px')
  })

  it('wraps block content in a div so the markup stays parseable', () => {
    render(
      <VisuallyHidden as="div">
        <p>Une photo vient d’être publiée.</p>
      </VisuallyHidden>,
    )

    // The element is the whole observable effect of the prop: a <span> around a <p> is
    // invalid nesting, and a browser re-parses it into a different tree than the one
    // React rendered — which moves the text out of the region announcing it.
    expect(screen.getByText('Une photo vient d’être publiée.').parentElement?.tagName).toBe('DIV')
  })
})
