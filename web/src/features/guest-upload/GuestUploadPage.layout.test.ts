import { describe, expect, it } from 'vitest'
import PAGE_CSS from './GuestUploadPage.module.css?raw'
import OPTIONS_CSS from './components/ComposerOptions.module.css?raw'
import CLIP_CSS from './components/ClipComposer.module.css?raw'
import PICKER_CSS from './components/PhotoPicker.module.css?raw'
import QUEUE_CSS from './components/UploadQueue.module.css?raw'
import FIELD_CSS from '../../design-system/components/Field.module.css?raw'
import TOKENS_CSS from '../../design-system/tokens.css?raw'
import DESIGN_SYSTEM_MD from '../../../../docs/DESIGN-SYSTEM.md?raw'

/**
 * What the guest screen's stylesheets promise a phone that is small, or set to large text.
 *
 * jsdom has no layout, so the geometry itself is `tests/e2e/journeys/guest-upload-pane.spec.ts`'s
 * (the pane's share of the screen, and no sideways scroll at 320 px with text at 200%). What is
 * checked here is the one-line rule each of those rests on, so that taking it out fails in the
 * fast ring and names the rule rather than a number.
 */

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first rule whose selector is exactly `selector`. */
const declarationsOf = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(withoutComments(css))
  if (rule === null) throw new Error(`no rule for ${selector}`)
  return rule[1] ?? ''
}

describe('a guest on the narrowest phone, or with large text', () => {
  it('lets the header buttons wrap instead of forcing one line wider than the screen', () => {
    // The ghost buttons' own rule is `white-space: nowrap`; the page's has to beat it.
    const rule = declarationsOf(PAGE_CSS, '.header > .noticeLink')

    expect(rule).toMatch(/white-space:\s*normal/)
    expect(rule).toMatch(/max-inline-size:\s*100%/)
  })

  it('lets the caption and video buttons wrap, and sit on separate lines when they must', () => {
    expect(declarationsOf(OPTIONS_CSS, '.toggles')).toMatch(/flex-wrap:\s*wrap/)
    expect(declarationsOf(OPTIONS_CSS, '.toggles > .toggle')).toMatch(/white-space:\s*normal/)
    // And breaks inside a word, for a language whose word for a caption is one long one.
    expect(declarationsOf(OPTIONS_CSS, '.toggles > .toggle')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it.each([
    ['the photo pickers', PICKER_CSS],
    ['the video pickers', CLIP_CSS],
  ])(
    'stacks %s when two no longer fit, and does not size them as two fixed columns',
    (_name, css) => {
      const rule = declarationsOf(css, '.picker')

      expect(rule).toMatch(
        /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*var\(--tile-min-width\)\)/,
      )
      expect(rule).not.toMatch(/grid-template-columns:\s*1fr 1fr/)
    },
  )

  it('lets the badge of a field label drop under a long label instead of past the screen', () => {
    expect(declarationsOf(FIELD_CSS, '.label')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('lets a row of the queue wrap its thumbnail, name and controls', () => {
    expect(declarationsOf(QUEUE_CSS, '.item')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('keeps a folded video section folded, which its own display would otherwise undo', () => {
    expect(declarationsOf(CLIP_CSS, '.composer')).toMatch(/display:\s*flex/)
    expect(declarationsOf(CLIP_CSS, '.composer[hidden]')).toMatch(/display:\s*none/)
  })

  it('declares the narrowest side-by-side tile as a design token, and the docs say the same', () => {
    const declared = (css: string) => /--tile-min-width:\s*([0-9.]+rem);/.exec(css)?.[1]

    expect(declared(TOKENS_CSS)).toBeDefined()
    expect(declared(DESIGN_SYSTEM_MD)).toBe(declared(TOKENS_CSS))
  })

  it('holds a pane with nothing in it to a spacing that fits two fifths of a phone', () => {
    // Not the share itself (that is a measurement), but the three spacings it was measured with:
    // a maintainer who puts the old ones back moves the pane past 40% before any test of a
    // photograph notices.
    expect(declarationsOf(PAGE_CSS, '.composer')).toMatch(/gap:\s*var\(--space-3\)/)
    expect(declarationsOf(PAGE_CSS, '.composer')).toMatch(/padding:\s*var\(--space-3\)/)
    expect(declarationsOf(PICKER_CSS, '.action')).toMatch(/padding-block:\s*var\(--space-4\)/)
  })
})
