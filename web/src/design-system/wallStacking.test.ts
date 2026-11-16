import { describe, expect, it } from 'vitest'

const raw = import.meta.glob<string>(
  [
    './tokens.css',
    '../features/wall/components/WallChallenge.module.css',
    '../features/wall/components/WallMessage.module.css',
    '../features/wall/components/WallAnnouncementBand.module.css',
    '../features/wall/components/WallAnnouncementCard.module.css',
    '../features/wall/components/WallAnnouncementPill.module.css',
    '../features/wall/components/WallControls.module.css',
  ],
  { query: '?raw', import: 'default', eager: true },
)
const tokens = raw['./tokens.css'] ?? ''
const challengeCss = raw['../features/wall/components/WallChallenge.module.css'] ?? ''
const messageCss = raw['../features/wall/components/WallMessage.module.css'] ?? ''
const bandCss = raw['../features/wall/components/WallAnnouncementBand.module.css'] ?? ''
const pillCss = raw['../features/wall/components/WallAnnouncementPill.module.css'] ?? ''
const announcementCss = raw['../features/wall/components/WallAnnouncementCard.module.css'] ?? ''

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

  it('draws an announcement’s countdown banner on the challenge’s rung, the two never being up together', () => {
    expect(zIndexOf(bandCss)).toBe('var(--z-wall-challenge)')
  })

  it('draws the announcement card in front of the challenge banner, and under the owner’s controls and the dialogs (spec 21)', () => {
    expect(zIndexOf(announcementCss)).toBe('var(--z-wall-announcement)')
    expect(token('--z-wall-announcement')).toBeGreaterThan(token('--z-wall-challenge'))
    // The owner's bar sits at the caption rung plus ten (WallControls.module.css).
    expect(zIndexOf(raw['../features/wall/components/WallControls.module.css'] ?? '')).toBe(
      'calc(var(--z-wall-caption) + 10)',
    )
    expect(token('--z-wall-announcement')).toBeLessThan(token('--z-wall-caption') + 10)
    expect(token('--z-wall-announcement')).toBeLessThan(token('--z-dialog'))
  })

  it('draws the discreet pill on the caption rung, so the fullscreen card and the challenge banner are in front of it (spec 21, rule 19)', () => {
    expect(zIndexOf(pillCss)).toBe('var(--z-wall-caption)')
    expect(token('--z-wall-announcement')).toBeGreaterThan(token('--z-wall-caption'))
    expect(token('--z-wall-challenge')).toBeGreaterThan(token('--z-wall-caption'))
  })

  it('draws the pill on the guestbook card’s own rung, which covers it by coming later in the page', () => {
    // A tie is settled by document order, and `WallPage` draws the column before the card
    // (`WallPage.announcements.discreet.test.tsx` pins that order): the card covers the pill.
    expect(zIndexOf(pillCss)).toBe(zIndexOf(messageCss))
  })
})
