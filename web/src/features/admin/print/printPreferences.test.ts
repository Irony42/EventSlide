import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('remembers the open rail entry and drops one it does not know', () => {
    writePrintPreferences('noces', { panel: 'colours' })
    expect(readPrintPreferences('noces')).toEqual({ panel: 'colours' })

    window.localStorage.setItem(KEY, JSON.stringify({ panel: 'export' }))
    expect(readPrintPreferences('noces')).toEqual({})
  })

  it('does not throw when the storage refuses to read or write', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const refused = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    expect(readPrintPreferences('noces')).toEqual({})
    expect(() => writePrintPreferences('noces', { panel: 'print' })).not.toThrow()
    blocked.mockRestore()
    refused.mockRestore()
  })
})
