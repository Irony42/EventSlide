import { describe, expect, it } from 'vitest'
import layoutsCss from './WallLayouts.module.css?raw'
import pageCss from '../WallPage.module.css?raw'

/**
 * The timed challenge's banner takes the top centre of the wall (spec 10), so the layouts that
 * fill the screen lay out below it: each reads `--wall-chrome-block-start`, which the wall's root
 * sets while a challenge is up and leaves at zero otherwise (so no other wall moves a pixel).
 * The spotlight is the one layout with no padding of its own: its photograph is full-bleed and
 * the banner sits over it, on its own scrim.
 *
 * The pixels are the visual suite's; this is the half that can silently stop being true when an
 * eighth layout is added without a reservation.
 */
const LAYOUTS = ['mosaic', 'polaroid', 'filmstrip', 'collage', 'clothesline', 'split'] as const

const blockOf = (css: string, selector: string): string => {
  const start = css.indexOf(`\n${selector} {`)
  const end = css.indexOf('\n}\n', start)
  return css.slice(start, end)
}

describe('the layouts and the challenge banner', () => {
  it.each(LAYOUTS)('%s lays out below the banner while there is one', (layout) => {
    expect(blockOf(layoutsCss, `.${layout}`)).toContain(
      'padding-block-start: calc(var(--wall-safe) + var(--wall-chrome-block-start))',
    )
  })

  it('reserves nothing unless the wall root says the top is spoken for', () => {
    expect(pageCss).toContain('--wall-chrome-block-start: 0px;')
    expect(pageCss).toMatch(
      /\.wall\[data-wall-chrome~='top'\] \{\s*--wall-chrome-block-start: calc\(var\(--wall-challenge-height\) \+ var\(--space-4\)\);/,
    )
  })
})
