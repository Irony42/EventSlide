import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Notice, type NoticeTone } from './Notice'
import styles from './Notice.module.css'
// Vite's `?raw`, for the reason `tokens.contrast.test.ts` gives: the web project runs
// under jsdom, where a stylesheet has no rules to read through the DOM.
import NOTICE_CSS from './Notice.module.css?raw'
import { classesOf, cls } from '../../testing/classesOf'

/**
 * The glyph is decoration: it is `aria-hidden`, so it has no accessible identity and a
 * structural query is the only handle a test can hold. The sentence beside it is what the
 * assertions about meaning use.
 */
const TONES: readonly NoticeTone[] = ['neutral', 'success', 'danger', 'warning', 'accent']

const glyphOf = (container: HTMLElement): SVGSVGElement => {
  const glyph = container.querySelector('svg')
  if (glyph === null) throw new Error('the notice drew no glyph')
  return glyph
}

/** The outline a tone draws, which is what tells two tones apart without their colour. */
const shapeOf = (container: HTMLElement): string =>
  (glyphOf(container).querySelector('path')?.getAttribute('d') ?? '').replace(/\s+/g, ' ').trim()

describe('Notice: what a screen reader gets', () => {
  it('hides the glyph, so the sentence is the whole of what is read', () => {
    const { container } = render(
      <Notice tone="danger" variant="boxed">
        Enregistrement impossible.
      </Notice>,
    )

    expect(glyphOf(container)).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.firstElementChild).toHaveTextContent(/^Enregistrement impossible\.$/)
  })

  it('announces itself as an alert when the caller says it is one', () => {
    render(
      <Notice tone="danger" variant="boxed" role="alert">
        Enregistrement impossible.
      </Notice>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Enregistrement impossible.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('announces itself politely as a status when the caller says so', () => {
    render(
      <Notice tone="warning" variant="boxed" role="status">
        Rafraîchissement impossible.
      </Notice>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Rafraîchissement impossible.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('announces nothing by itself when the caller gives no role', () => {
    // Static text, or text inside a live region the page already owns: a role of its own
    // would announce it twice.
    const { container } = render(
      <Notice tone="warning" variant="boxed">
        Publication sans validation.
      </Notice>,
    )

    expect(container.firstElementChild).not.toHaveAttribute('role')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Publication sans validation.')).toBeVisible()
  })

  it('carries an id, for the control it is described by', () => {
    render(
      <Notice tone="danger" variant="inline" role="alert" id="terms-error">
        Acceptez les conditions.
      </Notice>,
    )

    expect(screen.getByRole('alert')).toHaveAttribute('id', 'terms-error')
  })

  it('prints no id when it is not given one', () => {
    const { container } = render(
      <Notice tone="danger" variant="boxed">
        Non.
      </Notice>,
    )

    expect(container.firstElementChild).not.toHaveAttribute('id')
  })
})

describe('Notice: colour is never the only signal', () => {
  it.each(TONES)('draws a glyph for the %s tone', (tone) => {
    const { container } = render(
      <Notice tone={tone} variant="boxed">
        Une phrase.
      </Notice>,
    )

    expect(shapeOf(container)).not.toBe('')
  })

  it('draws a different shape for each tone, not only a different colour', () => {
    const shapes = TONES.map((tone) => {
      const { container, unmount } = render(
        <Notice tone={tone} variant="boxed">
          Une phrase.
        </Notice>,
      )
      const shape = shapeOf(container)
      unmount()
      return shape
    })

    // A red-green colourblind host has to tell a refusal from a caution under stage
    // lighting (DESIGN-SYSTEM.md section 8), and the shape is what they have.
    expect(new Set(shapes).size).toBe(TONES.length)
  })

  it.each(TONES)('wears the %s tone as a class of its own', (tone) => {
    const { container } = render(
      <Notice tone={tone} variant="boxed">
        Une phrase.
      </Notice>,
    )

    expect(classesOf(container.firstElementChild)).toContain(cls(styles, tone))
  })
})

describe('Notice: the two variants', () => {
  it('is framed when it is boxed, and not bare', () => {
    const { container } = render(
      <Notice tone="danger" variant="boxed">
        Une phrase.
      </Notice>,
    )

    expect(classesOf(container.firstElementChild)).toContain(cls(styles, 'boxed'))
    expect(classesOf(container.firstElementChild)).not.toContain(cls(styles, 'inline'))
  })

  it('is a bare sentence when it is inline, with no frame', () => {
    const { container } = render(
      <Notice tone="danger" variant="inline">
        Une phrase.
      </Notice>,
    )

    expect(classesOf(container.firstElementChild)).toContain(cls(styles, 'inline'))
    expect(classesOf(container.firstElementChild)).not.toContain(cls(styles, 'boxed'))
  })

  it('puts the glyph in the span the tone’s colour and the nudge are set on', () => {
    const { container } = render(
      <Notice tone="danger" variant="inline">
        Une phrase.
      </Notice>,
    )

    // Without the class the glyph would take the sentence's colour in a boxed notice and
    // sit a few pixels high of its first line.
    expect(classesOf(glyphOf(container).parentElement)).toEqual([cls(styles, 'glyph')])
  })
})

/**
 * What a class does, read off the stylesheet: the tests above only prove a class is worn,
 * and nothing in the suite renders a notice in a browser, so a frame that stopped being
 * drawn or a sentence that stopped taking the tone's colour would change no assertion.
 */
const declarationsOf = (selector: string): string => {
  const stripped = NOTICE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/\./g, '\\.')
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(stripped)
  if (rule === null) throw new Error(`the stylesheet has no rule for ${selector}`)
  return (rule[1] ?? '').replace(/\s+/g, ' ').trim()
}

describe('Notice: how each part is drawn', () => {
  it.each([
    ['.neutral', '--notice-tone: var(--text-secondary)'],
    ['.success', '--notice-tone: var(--success)'],
    ['.danger', '--notice-tone: var(--danger)'],
    ['.warning', '--notice-tone: var(--warning)'],
    ['.accent', '--notice-tone: var(--accent)'],
  ])('sets the tone once, on %s', (selector, declaration) => {
    expect(declarationsOf(selector)).toContain(declaration)
  })

  it('frames a boxed notice in the tone, on a raised surface, and leaves the ink alone', () => {
    const boxed = declarationsOf('.boxed')

    expect(boxed).toContain('border: 1px solid var(--notice-tone)')
    expect(boxed).toContain('background: var(--surface-raised)')
    expect(boxed).not.toMatch(/(?:^|[\s;])color:/)
  })

  it('tints the sentence of an inline notice and draws no frame around it', () => {
    const inline = declarationsOf('.inline')

    expect(inline).toContain('color: var(--notice-tone)')
    expect(inline).not.toMatch(/border|background|padding/)
  })

  it('colours the glyph in the tone, whichever variant it is in', () => {
    expect(declarationsOf('.glyph')).toContain('color: var(--notice-tone)')
  })
})

describe('Notice: its class names', () => {
  it('wears its own classes in order, and the caller’s after them', () => {
    const { container } = render(
      <Notice tone="warning" variant="inline" className="mine">
        Une phrase.
      </Notice>,
    )

    expect(classesOf(container.firstElementChild)).toEqual([
      cls(styles, 'notice'),
      cls(styles, 'inline'),
      cls(styles, 'warning'),
      'mine',
    ])
  })

  it('wears only its own when the caller adds none', () => {
    const { container } = render(
      <Notice tone="danger" variant="boxed">
        Une phrase.
      </Notice>,
    )

    expect(classesOf(container.firstElementChild)).toEqual([
      cls(styles, 'notice'),
      cls(styles, 'boxed'),
      cls(styles, 'danger'),
    ])
  })
})

describe('Notice: its content', () => {
  it('keeps a link inside the sentence rather than beside it', () => {
    const { container } = render(
      <Notice tone="accent" variant="boxed">
        Lisez <a href="/conditions">les conditions</a> avant de continuer.
      </Notice>,
    )

    // The glyph and the sentence are the notice's two children, so an inline element
    // inside the sentence cannot turn into a third column of the row.
    expect(container.firstElementChild?.children).toHaveLength(2)
    const sentence = container.firstElementChild?.lastElementChild
    if (!(sentence instanceof HTMLElement)) throw new Error('the notice has no sentence')
    expect(within(sentence).getByRole('link', { name: 'les conditions' })).toBeVisible()
  })
})
