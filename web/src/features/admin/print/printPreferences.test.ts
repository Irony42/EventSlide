import { afterEach, describe, expect, it } from 'vitest'
import { readPrintPreferences, writePrintPreferences } from './printPreferences'

const KEY = 'eventslide.print.noces'

afterEach(() => window.localStorage.clear())

describe('the print preferences kept on this device', () => {
  it('reads back the card the host chose: design, words, steps, colour and framing', () => {
    writePrintPreferences('noces', {
      design: 'billet',
      texts: { title: 'Les 40 ans de Léa', table: '7' },
      steps: false,
      colour: '#2e6b4f',
      focusX: 30,
      focusY: 70,
    })

    expect(readPrintPreferences('noces')).toEqual({
      design: 'billet',
      texts: { title: 'Les 40 ans de Léa', table: '7' },
      steps: false,
      colour: '#2e6b4f',
      focusX: 30,
      focusY: 70,
    })
  })

  it('reads a colour back in lower case, the way the swatches are written', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ colour: '#2E6B4F' }))
    expect(readPrintPreferences('noces')).toEqual({ colour: '#2e6b4f' })
  })

  it('drops what it does not recognise rather than printing it', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        design: 'arche',
        colour: 'red; background: url(x)',
        focusX: 140,
        focusY: 12.5,
        texts: { title: 'x'.repeat(61), note: 42, table: '7', joinCode: 'H7K2QM' },
      }),
    )

    expect(readPrintPreferences('noces')).toEqual({ texts: { table: '7' } })
  })
})
