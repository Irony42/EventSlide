import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PhotoPreload } from './PhotoPreload'

const NEXT_URL = '/api/events/camille-et-sacha/photos/photo-2/display'

/**
 * jsdom decodes no images at all, so `HTMLImageElement.prototype.decode` has to be
 * stood in. Same category of shim as the `EventSource` and `<dialog>` stand-ins in
 * `web/src/testing/`: it replaces a browser API and no application code.
 */
let decoded: string[] = []
let decoding: Promise<void> = Promise.resolve()

const installDecode = (): void => {
  Object.defineProperty(window.HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: function decode(this: HTMLImageElement): Promise<void> {
      decoded.push(this.getAttribute('src') ?? '')
      return decoding
    },
  })
}

const flush = (): Promise<void> => Promise.resolve()

describe('PhotoPreload', () => {
  beforeEach(() => {
    decoded = []
    decoding = Promise.resolve()
    installDecode()
  })

  afterEach(() => {
    Reflect.deleteProperty(window.HTMLImageElement.prototype, 'decode')
  })

  it('decodes the next photo while the current one is still on screen', async () => {
    render(<PhotoPreload url={NEXT_URL} />)

    // A crossfade that starts before the incoming bytes are decoded paints a blank
    // frame, and on congested venue Wi-Fi that is most of them.
    expect(decoded).toEqual([NEXT_URL])
  })

  it('prepares nothing when there is no next photo', () => {
    const { container } = render(<PhotoPreload url={null} />)

    // A one-photo wall has nothing to prepare, and an <img> with no source is a
    // request for the page itself in some browsers.
    expect(container).toBeEmptyDOMElement()
    expect(decoded).toEqual([])
  })

  it('stays out of the accessibility tree, since the slide already names the photo', () => {
    const { container } = render(<PhotoPreload url={NEXT_URL} />)

    const image = container.querySelector('img')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    expect(image).toHaveAttribute('alt', '')
  })

  it('keeps the wall up when the next photo cannot be decoded', async () => {
    decoding = Promise.reject(new Error('decode failed'))

    const { container } = render(<PhotoPreload url={NEXT_URL} />)
    await flush()

    // A failed decode is not fatal: the slide then simply fades in as soon as the
    // browser has the bytes, and an unhandled rejection here would reach the projector
    // as an error overlay in a dev build.
    expect(container.querySelector('img')).toHaveAttribute('src', NEXT_URL)
  })

  it('asks for no decode from a browser that does not offer one', () => {
    Reflect.deleteProperty(window.HTMLImageElement.prototype, 'decode')

    const { container } = render(<PhotoPreload url={NEXT_URL} />)

    // The hidden <img> alone is enough: the browser still fetches it at the document's
    // normal priority, which is the part that matters on a slow venue connection.
    expect(container.querySelector('img')).toHaveAttribute('src', NEXT_URL)
  })
})
