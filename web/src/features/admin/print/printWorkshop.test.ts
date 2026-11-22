import { describe, expect, it } from 'vitest'
import { PRINT_PANELS, defaultViewOf, isPrintPanel, panelAfterKey } from './printWorkshop'

describe('the print workshop rail', () => {
  it('moves with the arrows, wraps at both ends, and jumps with Home and End', () => {
    expect(panelAfterKey('design', 'ArrowDown')).toBe('texts')
    expect(panelAfterKey('design', 'ArrowRight')).toBe('texts')
    expect(panelAfterKey('print', 'ArrowDown')).toBe('design')
    expect(panelAfterKey('design', 'ArrowUp')).toBe('print')
    expect(panelAfterKey('texts', 'ArrowLeft')).toBe('design')
    expect(panelAfterKey('colours', 'Home')).toBe('design')
    expect(panelAfterKey('colours', 'End')).toBe('print')
  })

  it('leaves every other key alone', () => {
    expect(panelAfterKey('design', 'Tab')).toBeNull()
    expect(panelAfterKey('design', 'a')).toBeNull()
  })

  it('shows the whole sheet on the printing entry and one card on the others', () => {
    expect(defaultViewOf('print')).toBe('sheet')
    for (const panel of PRINT_PANELS.filter((entry) => entry !== 'print')) {
      expect(defaultViewOf(panel)).toBe('card')
    }
  })

  it('knows its five entries and nothing else', () => {
    expect(PRINT_PANELS).toHaveLength(5)
    expect(isPrintPanel('photo')).toBe(true)
    expect(isPrintPanel('export')).toBe(false)
    expect(isPrintPanel(3)).toBe(false)
  })
})
