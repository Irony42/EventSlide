import { describe, expect, it } from 'vitest'
import TOKENS from './tokens.css?raw'
import CONTROLS from '../features/wall/panel/controls/controls.module.css?raw'

const rem = (name: string): number =>
  Number(new RegExp(String.raw`${name}:\s*([\d.]+)rem;`).exec(TOKENS)?.[1])

const rule = (selector: string): string => {
  const at = CONTROLS.indexOf(`
${selector} {`)
  return at < 0 ? '' : CONTROLS.slice(at, CONTROLS.indexOf('}', at))
}

describe('the option switch geometry', () => {
  it('is a pill well over 1.6 times as wide as tall, with a knob inside it', () => {
    expect(rem('--switch-width') / rem('--switch-height')).toBeGreaterThan(1.6)
    expect(rem('--switch-knob')).toBeLessThan(rem('--switch-height'))
    expect(rem('--switch-gap')).toBeCloseTo((rem('--switch-height') - rem('--switch-knob')) / 2)
  })

  it('draws the track from those tokens and never stretches it to the touch target', () => {
    const track = rule('.switch')
    expect(track).toContain('inline-size: var(--switch-width)')
    expect(track).toContain('block-size: var(--switch-height)')
    expect(track).not.toContain('--touch-min')
  })

  it('leaves the 44 px target to the card around it', () => {
    expect(rule('.card')).toContain('min-block-size: var(--touch-min)')
    expect(rem('--switch-height')).toBeLessThan(rem('--touch-min'))
  })

  it('slides the knob by transform, only when motion is welcome, and transitions no paint', () => {
    expect(CONTROLS).toMatch(
      /prefers-reduced-motion: no-preference\) \{\s*\.switch::after \{\s*transition: transform/,
    )
    expect(CONTROLS).not.toMatch(/\.switch[^}]*transition:[^}]*(background|border|inset)/)
  })

  it('does not outline every card in the accent', () => {
    expect(CONTROLS).not.toMatch(/\.card:has\(\.switch:checked\) \{[^}]*border-color/)
  })
})
