import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { BookPreviewDto } from '../../../lib/api/dto'
import { aBookPreview, aPreviewPage, aPreviewPhoto } from '../../../testing/renderWithProviders'
import { BookPageView } from './BookPageView'
import type { Sheet } from './bookSpreads'

const page = (preview: BookPreviewDto, template: string): Sheet => {
  const found = preview.pages.findIndex((p) => p.template === template)
  const planned = preview.pages[found]!
  return { kind: 'page', page: planned, index: found, half: null, number: found + 1 }
}

const draw = (preview: BookPreviewDto, sheet: Sheet, quality: 'thumb' | 'display' = 'display') =>
  render(<BookPageView preview={preview} sheet={sheet} quality={quality} />)

describe('BookPageView, the covers', () => {
  it('writes the title and the subtitle on the cover, over the cover photograph', () => {
    const preview = aBookPreview()
    const { container } = draw(preview, { kind: 'cover' })

    expect(screen.getByText('Mariage')).toBeVisible()
    expect(screen.getByText('14 juin 2026')).toBeVisible()
    expect(container.querySelector('img')).toHaveAttribute('src', preview.cover.photo.displayUrl)
  })

  it('uses the miniature of the photograph for the strip, and the large one for the open book', () => {
    const preview = aBookPreview()

    expect(
      draw(preview, { kind: 'cover' }, 'thumb').container.querySelector('img'),
    ).toHaveAttribute('src', preview.cover.photo.thumbUrl)
  })

  it('runs the Magazine cover to the edges with the title over it', () => {
    const preview = aBookPreview({
      style: 'magazine',
      look: { fullBleed: true, polaroid: false, minBodySize: 9 },
    })
    const { container } = draw(preview, { kind: 'cover' })

    expect(container.querySelector('img')?.className).toMatch(/bleed/)
    expect(screen.getByText('Mariage')).toBeVisible()
  })

  it('holds a polaroid on the Souvenir cover, tilted and taped', () => {
    const preview = aBookPreview({
      style: 'souvenir',
      look: { fullBleed: false, polaroid: true, minBodySize: 11 },
    })
    const { container } = draw(preview, { kind: 'cover' })

    const frame = container.querySelector<HTMLElement>('[class*="polaroid"]')!
    expect(frame.style.getPropertyValue('--rot')).toMatch(/deg$/)
    expect(container.querySelector('[class*="tape"]')).not.toBeNull()
  })

  it('draws the back cover with the title and the mention, and the inside of a cover blank', () => {
    const preview = aBookPreview()
    draw(preview, { kind: 'back' })
    expect(screen.getByText('Mariage')).toBeVisible()
    expect(screen.getByText(preview.texts.createdWith)).toBeVisible()

    const blank = draw(preview, { kind: 'inside' })
    expect(blank.container.querySelectorAll('img, p')).toHaveLength(0)
  })
})

describe('BookPageView, the pages', () => {
  it('puts the caption and the first name under a lone photograph', () => {
    const preview = aBookPreview()
    draw(preview, page(preview, 'single'))

    expect(screen.getByText('Le gâteau')).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
  })

  it('draws no line for a photograph that has none', () => {
    const preview = aBookPreview()
    const { container } = draw(preview, page(preview, 'twoStack'))

    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('puts the caption of a photograph among several on a bar at its foot', () => {
    const preview = aBookPreview({
      pages: [
        aPreviewPage(
          'twoStack',
          [aPreviewPhoto('p2', { caption: 'Les mariés' }), aPreviewPhoto('p3')],
          [],
          [
            { x: 17, y: 8, w: 66, h: 41, contain: false, hero: false },
            { x: 17, y: 51, w: 66, h: 41, contain: false, hero: false },
          ],
        ),
      ],
    })
    draw(preview, page(preview, 'twoStack'))

    expect(screen.getByText('Les mariés').closest('p')?.className).toMatch(/bar/)
  })

  it('counts the hearts on the hero of a Magazine page only', () => {
    const slots = [{ x: 0, y: 0, w: 100, h: 100, contain: false, hero: true }]
    const hearted = [aPreviewPhoto('p1', { hearts: 5 })]
    const magazine = aBookPreview({
      style: 'magazine',
      look: { fullBleed: true, polaroid: false, minBodySize: 9 },
      pages: [aPreviewPage('full', hearted, [], slots)],
    })
    draw(magazine, page(magazine, 'full'))
    expect(screen.getByText('♥ 5')).toBeVisible()
  })

  it('shows no heart badge in Classique', () => {
    const classique = aBookPreview({
      pages: [
        aPreviewPage(
          'single',
          [aPreviewPhoto('p1', { hearts: 5 })],
          [],
          [{ x: 12, y: 10, w: 76, h: 66, contain: true, hero: true }],
        ),
      ],
    })
    draw(classique, page(classique, 'single'))
    expect(screen.queryByText('♥ 5')).toBeNull()
  })

  it('writes the evening in numbers with the labels of the book language', () => {
    const preview = aBookPreview()
    draw(preview, page(preview, 'stats'))

    expect(screen.getByText(preview.texts.statsTitle)).toBeVisible()
    expect(screen.getByText(preview.texts.statHearts)).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
  })

  it('lists the contents with their pages, and the guest book among the chapters', () => {
    const preview = aBookPreview({
      pages: [
        aPreviewPage(
          'contents',
          [],
          [
            { x: 15, y: 12, w: 70, h: 8 },
            { x: 15, y: 30, w: 70, h: 44 },
          ],
        ),
      ],
      contents: [
        { label: 'I · La soirée', page: 4 },
        { label: "Le livre d'or", page: 12 },
      ],
    })
    draw(preview, page(preview, 'contents'))

    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['I · La soirée4', "Le livre d'or12"])
  })

  it('opens a chapter with its numeral, its name and its hours', () => {
    const preview = aBookPreview({
      chapters: [
        {
          index: 1,
          numeral: 'II',
          title: 'La nuit',
          subtitle: 'de 23 h à 2 h · 40 photos',
          firstPage: 20,
        },
      ],
      pages: [aPreviewPage('chapter', [], [{ x: 20, y: 34, w: 60, h: 32 }], [], { chapter: 0 })],
    })
    // The page points at chapter 0 of the list: give it that one.
    const sheet = page({ ...preview, chapters: [{ ...preview.chapters[0]!, index: 0 }] }, 'chapter')
    draw({ ...preview, chapters: [{ ...preview.chapters[0]!, index: 0 }] }, sheet)

    expect(screen.getByText('II')).toBeVisible()
    expect(screen.getByText('La nuit')).toBeVisible()
    expect(screen.getByText('de 23 h à 2 h · 40 photos')).toBeVisible()
  })

  it('writes the messages of the guest book with their authors, under the heading on the first page', () => {
    const preview = aBookPreview({
      pages: [
        aPreviewPage(
          'messages',
          [],
          [
            { x: 10, y: 16, w: 38, h: 34 },
            { x: 52, y: 16, w: 38, h: 34 },
          ],
          [],
          {
            firstMessages: true,
            messages: [
              { text: 'Bravo', author: 'Zoé' },
              { text: 'Merci', author: null },
            ],
          },
        ),
      ],
    })
    draw(preview, page(preview, 'messages'))

    expect(screen.getByText(preview.texts.guestbook)).toBeVisible()
    expect(screen.getByText('— Zoé')).toBeVisible()
    expect(screen.getByText('Merci')).toBeVisible()
    expect(screen.queryByText('— null')).toBeNull()
  })

  it('keeps the heading of the guest book for its first page', () => {
    const preview = aBookPreview({
      pages: [
        aPreviewPage('messages', [], [{ x: 10, y: 16, w: 38, h: 34 }], [], {
          messages: [{ text: 'Suite', author: null }],
        }),
      ],
    })
    draw(preview, page(preview, 'messages'))

    expect(screen.queryByText(preview.texts.guestbook)).toBeNull()
  })

  it('quotes a message on its own page', () => {
    const preview = aBookPreview({
      pages: [
        aPreviewPage('quote', [], [{ x: 16, y: 38, w: 68, h: 24 }], [], {
          messages: [{ text: 'La plus belle soirée', author: 'Léa' }],
        }),
      ],
    })
    draw(preview, page(preview, 'quote'))

    expect(screen.getByText('La plus belle soirée')).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
  })

  it('thanks the photographers by name, and says what the book leaves out on the closing page', () => {
    const preview = aBookPreview({ closingNotes: ['2 vidéos ne figurent pas dans ce livre'] })
    draw(preview, page(preview, 'thanks'))
    expect(screen.getByText(preview.thanks.heading)).toBeVisible()
    expect(screen.getByText('Léa (3)')).toBeVisible()

    draw(preview, page(preview, 'end'))
    expect(screen.getByText('2 vidéos ne figurent pas dans ce livre')).toBeVisible()
  })

  it('runs a double-page photograph over two faces, each showing its own half', () => {
    const wide = aPreviewPage('wide', [aPreviewPhoto('p1', { caption: 'Le toast' })], [], [], {
      span: 2,
    })
    const preview = aBookPreview({ pages: [wide] })
    const left = draw(preview, { kind: 'page', page: wide, index: 0, half: 'left', number: 1 })
    expect(left.container.querySelector('img')?.className).not.toMatch(/wideRight/)
    expect(screen.queryByText('Le toast')).toBeNull()
    left.unmount()

    const right = draw(preview, { kind: 'page', page: wide, index: 0, half: 'right', number: 2 })
    expect(right.container.querySelector('img')?.className).toMatch(/wideRight/)
    expect(screen.getByText('Le toast')).toBeVisible()
  })

  it('draws Souvenir photographs as tilted polaroids with their caption and mission sticker', () => {
    const preview = aBookPreview({
      style: 'souvenir',
      look: { fullBleed: false, polaroid: true, minBodySize: 11 },
      pages: [
        aPreviewPage(
          'twoSide',
          [aPreviewPhoto('p2', { caption: 'Le bal', missionLabel: 'Mission : le bal' })],
          [],
          [{ x: 8, y: 17, w: 41, h: 66, contain: false, hero: false }],
        ),
      ],
    })
    draw(preview, page(preview, 'twoSide'))

    expect(screen.getByText('Le bal')).toBeVisible()
    expect(screen.getByText('Mission : le bal')).toBeVisible()
  })
})
