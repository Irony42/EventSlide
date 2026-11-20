import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { useFitText } from './useFitText'

/**
 * jsdom lays nothing out, so the boxes are stated: a card 200 px wide, a text whose content is as
 * tall as its font size times its line count, inside a ceiling of 60 px.
 */
function Card({ text, min }: { readonly text: string; readonly min?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useFitText(root, text)
  return (
    <div ref={root}>
      <article data-print-card="essentiel">
        <h2 data-fit {...(min === undefined ? {} : { 'data-fit-min': min })}>
          {text}
        </h2>
      </article>
    </div>
  )
}

const laidOut = (lines: (size: number, wrapped: boolean) => number, width = 200) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
  } as DOMRect)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (element: Element) =>
      ({
        fontSize: (element as HTMLElement).style.fontSize === '' ? '40px' : sizeOf(element),
        maxHeight: '60px',
      }) as CSSStyleDeclaration,
  )
  const sizeOf = (element: Element) =>
    `${(parseFloat((element as HTMLElement).style.fontSize) / 100) * width}px`
  const size = (element: HTMLElement) =>
    element.style.fontSize === '' ? 40 : (parseFloat(element.style.fontSize) / 100) * width
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return size(this) * lines(size(this), this.style.whiteSpace === 'normal')
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
}

afterEach(() => vi.restoreAllMocks())

describe('useFitText', () => {
  it('shrinks a text until it fits its box, and writes the size in cqw of the card', () => {
    laidOut(() => 3)
    const { container } = render(<Card text="Anniversaire surprise des quarante ans" />)
    const title = container.querySelector('h2') as HTMLElement

    const size = (parseFloat(title.style.fontSize) / 100) * 200
    expect(title.style.fontSize).toMatch(/cqw$/)
    expect(size * 3).toBeLessThanOrEqual(60 + size * 0.14)
    expect(size).toBeGreaterThan(17)
  })

  it('leaves a text that fits alone', () => {
    laidOut(() => 1)
    const { container } = render(<Card text="Camille & Sacha" />)
    expect((container.querySelector('h2') as HTMLElement).style.fontSize).toBe('')
  })

  it('lets a one-line text wrap rather than fall under its floor, then fits it again', () => {
    // On one line it needs to be tiny; wrapped, two lines of 28 px fit the 60 px ceiling.
    laidOut((_size, wrapped) => (wrapped ? 2 : 8))
    const { container } = render(<Card text="Les quarante ans de Léa" min="9" />)
    const title = container.querySelector('h2') as HTMLElement

    expect(title.style.whiteSpace).toBe('normal')
    expect(parseFloat(title.style.fontSize)).toBeGreaterThanOrEqual(9)
  })

  it('does nothing where nothing is laid out', () => {
    laidOut(() => 3, 0)
    const measured = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    const { container } = render(<Card text="Anniversaire surprise des quarante ans" />)
    expect((container.querySelector('h2') as HTMLElement).style.fontSize).toBe('')
    expect(measured).not.toHaveBeenCalled()
  })
})
