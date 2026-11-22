import { describe, expect, it } from 'vitest'
import { aBookPreview, aPreviewPage } from '../../../testing/renderWithProviders'
import { findSpread, sheetsOf, singlesOf, spreadOfFace, spreadsOf } from './bookSpreads'

describe('sheetsOf', () => {
  it('runs from the cover to the back cover, the plan between the inside of the cover and the blank', () => {
    const sheets = sheetsOf(aBookPreview())
    expect(sheets.map((s) => s.kind)).toEqual([
      'cover',
      'inside',
      ...Array<string>(6).fill('page'),
      'blank',
      'back',
    ])
    // The file's page count plus the back cover and its inside, which the file does not have.
    expect(sheets).toHaveLength(aBookPreview().pageCount + 2)
  })

  it('numbers the pages like the contents page does, and cuts a double-page photograph in two', () => {
    const preview = aBookPreview({
      pages: [
        aPreviewPage('title'),
        aPreviewPage('contents'),
        aPreviewPage('wide', [], [], [], { span: 2 }),
        aPreviewPage('end'),
      ],
    })
    const pages = sheetsOf(preview).flatMap((s) => (s.kind === 'page' ? [s] : []))
    expect(pages.map((s) => [s.number, s.half])).toEqual([
      [1, null],
      [2, null],
      [3, 'left'],
      [4, 'right'],
      [5, null],
    ])
  })
})

describe('spreadsOf', () => {
  it('opens on the cover alone on the right, pairs the faces, and ends on the back cover alone on the left', () => {
    const spreads = spreadsOf(sheetsOf(aBookPreview()))
    expect(spreads[0]).toEqual({ at: 0, left: null, right: { kind: 'cover' } })
    expect(spreads[1]!.left).toEqual({ kind: 'inside' })
    expect(spreads[1]!.right).toMatchObject({ kind: 'page', number: 1 })
    expect(spreads[spreads.length - 1]).toEqual({ at: 9, left: { kind: 'back' }, right: null })
    // The last plan page faces the inside of the back cover.
    expect(spreads[spreads.length - 2]!.right).toEqual({ kind: 'blank' })
    expect(spreads).toHaveLength(6)
  })

  it('keeps a left page on the left: the faces after the inside of the cover alternate', () => {
    const spreads = spreadsOf(sheetsOf(aBookPreview()))
    expect(spreads[2]!.left).toMatchObject({ number: 2 })
    expect(spreads[2]!.right).toMatchObject({ number: 3 })
  })
})

describe('singlesOf and findSpread', () => {
  it('shows one face at a time', () => {
    const sheets = sheetsOf(aBookPreview())
    expect(singlesOf(sheets)).toHaveLength(sheets.length)
  })

  it('finds the first spread holding a face, or nothing', () => {
    const spreads = spreadsOf(sheetsOf(aBookPreview()))
    expect(findSpread(spreads, (s) => s.kind === 'page' && s.page.template === 'thanks')).toBe(3)
    expect(findSpread(spreads, (s) => s.kind === 'page' && s.page.template === 'quote')).toBeNull()
    expect(findSpread(spreads, (s) => s.kind === 'cover')).toBe(0)
  })
})

describe('spreadOfFace', () => {
  it('finds the spread that shows a face, in either mode', () => {
    const sheets = sheetsOf(aBookPreview())
    const spreads = spreadsOf(sheets)
    expect(spreadOfFace(spreads, 0)).toBe(0)
    expect(spreadOfFace(spreads, 1)).toBe(1)
    expect(spreadOfFace(spreads, 2)).toBe(1)
    expect(spreadOfFace(spreads, 3)).toBe(2)
    expect(spreadOfFace(spreads, sheets.length - 1)).toBe(spreads.length - 1)
    expect(spreadOfFace(singlesOf(sheets), 5)).toBe(5)
  })
})
