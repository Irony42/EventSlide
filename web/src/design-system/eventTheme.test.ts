import { describe, expect, it } from 'vitest'
import {
  accentNameFor,
  CURATED_ACCENT_HUES,
  CURATED_ACCENT_NAMES,
  DEFAULT_EVENT_THEME,
  readEventTheme,
  themeSurfaceProps,
} from './eventTheme'
import type { EventThemeDto } from '../lib/api/dto'

/**
 * How a theme reaches a surface, and — more importantly — how it does not reach one.
 *
 * The property worth protecting here is the negative: an event that chose nothing must
 * produce no attribute and no inline style, because the wall's committed visual
 * baselines photograph exactly that DOM.
 */

const aTheme = (overrides: Partial<EventThemeDto> = {}): EventThemeDto => ({
  ...DEFAULT_EVENT_THEME,
  ...overrides,
})

describe('themeSurfaceProps', () => {
  it('gives an unthemed event nothing at all to wear', () => {
    // Not "the default values": nothing. A `data-event-frame="soft"` on an event nobody
    // themed would be a DOM difference on every wall in production for no behaviour.
    expect(themeSurfaceProps(DEFAULT_EVENT_THEME, 'wall')).toEqual({})
  })

  it('gives a surface with no event nothing either', () => {
    // The wall before its first response. There is nothing accent-coloured on screen at
    // that moment, which is what makes "the projector never blinks" true rather than
    // hoped for.
    expect(themeSurfaceProps(null, 'wall')).toEqual({})
  })

  it('hands the wall the hue as an angle, never as a colour', () => {
    const props = themeSurfaceProps(aTheme({ accentHue: 345 }), 'wall')

    expect(props.style).toEqual({ '--accent-hue': '345' })
  })

  it('marks the element the stylesheet has to re-derive the accent on', () => {
    // `--accent` references `--accent-hue`, and a custom property that references another
    // is resolved on the element it is declared on — so moving the hue alone changes
    // nothing anywhere. The marker is what selects the re-declaration in `tokens.css`.
    const props = themeSurfaceProps(aTheme({ accentHue: 345 }), 'wall')

    expect(props['data-event-accent']).toBe('345')
  })

  it('hands the wall the font pairing and the frame style it chose', () => {
    const props = themeSurfaceProps(aTheme({ fonts: 'serif', frame: 'square' }), 'wall')

    // The whole object: an event on the default hue must carry no accent marker either,
    // and asserting two keys would not see one appear.
    expect(props).toEqual({ 'data-event-fonts': 'serif', 'data-event-frame': 'square' })
  })

  it('omits each choice the event left on the default', () => {
    const props = themeSurfaceProps(aTheme({ accentHue: 250 }), 'wall')

    expect(props).toEqual({
      style: { '--accent-hue': '250' },
      'data-event-accent': '250',
    })
  })

  it('gives the guest the colour and not the typography', () => {
    // The honest scope of the pairing: a display face buys nothing on a screen whose
    // largest type is `--text-lg`, and had the pairings been bundled rather than built
    // from system faces this is the surface that would have paid the bytes.
    const props = themeSurfaceProps(
      aTheme({ accentHue: 345, fonts: 'serif', frame: 'round' }),
      'guest',
    )

    expect(props).toEqual({
      style: { '--accent-hue': '345' },
      'data-event-accent': '345',
    })
  })
})

describe('the picker’s catalogue', () => {
  it('names every hue it offers', () => {
    expect(CURATED_ACCENT_NAMES).toEqual(['violet', 'rose', 'azure', 'teal'])
  })

  it('recognises a stored hue as one of the named ones', () => {
    expect(accentNameFor(CURATED_ACCENT_HUES.rose)).toBe('rose')
  })

  it('recognises no name for an angle set outside the console', () => {
    // The API takes any legible angle, so a stored hue need not be one of the four. The
    // picker shows none of them selected rather than silently claiming the nearest.
    expect(accentNameFor(200)).toBeNull()
  })
})

describe('readEventTheme', () => {
  it('accepts a theme as the server sends it', () => {
    expect(readEventTheme({ accentHue: 345, fonts: 'serif', frame: 'round' })).toEqual({
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
    })
  })

  it.each([
    ['nothing at all', undefined],
    ['a string where the object goes', 'rose'],
    ['a hue that is text', { accentHue: 'rose', fonts: 'sans', frame: 'soft' }],
    ['a hue that is not a number at all', { accentHue: Number.NaN, fonts: 'sans', frame: 'soft' }],
    ['a hue past the circle', { accentHue: 4000, fonts: 'sans', frame: 'soft' }],
    ['a negative hue', { accentHue: -1, fonts: 'sans', frame: 'soft' }],
    ['a hue between two degrees', { accentHue: 305.5, fonts: 'sans', frame: 'soft' }],
    ['a font pairing this build never shipped', { accentHue: 305, fonts: 'comic', frame: 'soft' }],
    ['a frame style this build never shipped', { accentHue: 305, fonts: 'sans', frame: 'oval' }],
  ])('refuses %s', (_case, value) => {
    // A hue that is not a number reaches `--accent-hue` as something the browser cannot
    // parse, and the accent — the only colour on the guest's one control — falls over.
    expect(readEventTheme(value)).toBeNull()
  })
})
