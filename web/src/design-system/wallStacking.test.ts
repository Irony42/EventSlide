import { describe, expect, it } from 'vitest'

const raw = import.meta.glob<string>(
  [
    './tokens.css',
    '../features/wall/components/WallChallenge.module.css',
    '../features/wall/components/WallMessage.module.css',
  ],
  { query: '?raw', import: 'default', eager: true },
)
const tokens = raw['./tokens.css'] ?? ''
const challengeCss = raw['../features/wall/components/WallChallenge.module.css'] ?? ''
const messageCss = raw['../features/wall/components/WallMessage.module.css'] ?? ''

/**
 * A running challenge stays on screen over a guestbook card (spec 10 over spec 01).
 *
 * Both are positioned layers of the wall, and a tie in `z-index` is settled by document order:
 * the card, drawn after the banner, covered it ("sur l'écran le défi n'apparaît pas quand on
 * affiche une citation du livre d'or"). The order is therefore a rung of the token scale, read
 * off the stylesheets, not a number each file picks.
 */
const token = (name: string): number => {
  const found = new RegExp(String.raw`${name}:\s*(\d+)\s*;`).exec(tokens)
  if (found?.[1] === undefined) throw new Error(`${name} is not a number in tokens.css`)
  return Number(found[1])
}

const zIndexOf = (css: string): string => {
  const found = /z-index:\s*([^;]+);/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  if (found?.[1] === undefined) throw new Error('no z-index')
  return found[1].trim()
}

describe('the wall stacking order', () => {
  it('draws the challenge banner on its own rung, above the guestbook card', () => {
    expect(zIndexOf(challengeCss)).toBe('var(--z-wall-challenge)')
    expect(zIndexOf(messageCss)).toBe('var(--z-wall-caption)')
    expect(token('--z-wall-challenge')).toBeGreaterThan(token('--z-wall-caption'))
  })

  it('keeps the banner under the dialogs', () => {
    expect(token('--z-wall-challenge')).toBeLessThan(token('--z-dialog'))
  })
})
