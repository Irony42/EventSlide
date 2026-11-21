import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blurPhoto, loadFacesOf, renderCardPng } from './imageRender'

const toBlob = vi.hoisted(() => vi.fn())
vi.mock('html-to-image', () => ({ toBlob }))

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const userAgent = (value: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(value)

const node = () => {
  const root = document.createElement('div')
  root.innerHTML = '<h2>Léa</h2><p>Venez</p><div></div>'
  document.body.append(root)
  return root
}

beforeEach(() => {
  toBlob.mockReset()
  toBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  Reflect.deleteProperty(document, 'fonts')
})

const fakeFonts = () => {
  const load = vi.fn(async (_face: string, _text?: string): Promise<unknown[]> => [])
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load, ready: Promise.resolve() },
  })
  return load
}

describe('renderCardPng', () => {
  it('draws the node at the size asked, one pixel to the pixel, once on an engine that needs no warm-up', async () => {
    userAgent(CHROME)
    const root = node()

    const blob = await renderCardPng(root, { width: 1080, height: 1920 })

    expect(blob.type).toBe('image/png')
    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(toBlob).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        width: 1080,
        height: 1920,
        canvasWidth: 1080,
        canvasHeight: 1920,
        pixelRatio: 1,
      }),
    )
  })

  it('makes a first capture and throws it away on WebKit, which draws the first without its fonts', async () => {
    userAgent(SAFARI)

    await renderCardPng(node(), { width: 1080, height: 1080 })

    expect(toBlob).toHaveBeenCalledTimes(2)
  })

  it('says so when the browser makes no image', async () => {
    userAgent(CHROME)
    toBlob.mockResolvedValue(null)

    await expect(renderCardPng(node(), { width: 1080, height: 1080 })).rejects.toThrow('no image')
  })

  it('asks for the faces the card is written in before it draws', async () => {
    userAgent(CHROME)
    const load = fakeFonts()
    const order: string[] = []
    load.mockImplementation(async () => {
      order.push('fonts')
      return []
    })
    toBlob.mockImplementation(async () => {
      order.push('draw')
      return new Blob(['png'])
    })

    await renderCardPng(node(), { width: 1080, height: 1080 })

    expect(order[0]).toBe('fonts')
    expect(order.at(-1)).toBe('draw')
  })
})

describe('loadFacesOf', () => {
  it('loads each distinct face of the text in the node, once', async () => {
    const load = fakeFonts()
    const root = node()
    ;(root.querySelector('h2') as HTMLElement).style.fontFamily = 'Anton'
    ;(root.querySelector('p') as HTMLElement).style.fontFamily = 'Anton'

    await loadFacesOf(root)

    const faces = load.mock.calls.map(([face]) => String(face))
    expect(faces.some((face) => face.includes('Anton'))).toBe(true)
    expect(new Set(faces).size).toBe(faces.length)
  })

  it('does nothing in a browser with no font loading API', async () => {
    await expect(loadFacesOf(node())).resolves.toBeUndefined()
  })

  it('goes on when a face cannot be loaded', async () => {
    const load = fakeFonts()
    load.mockRejectedValue(new Error('no such face'))

    await expect(loadFacesOf(node())).resolves.toBeUndefined()
  })
})

/** jsdom decodes no image: the method is installed for the test and taken away after it. */
const stubDecode = (decode: () => Promise<void>) =>
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })

afterEach(() => {
  Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
})

describe('blurPhoto', () => {
  const withCanvas = (
    context: Partial<CanvasRenderingContext2D> | null,
    url = 'data:image/jpeg;base64,BBBB',
  ) => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => url,
    }
    const real = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : real(tag),
    )
    stubDecode(async () => undefined)
    return canvas
  }

  it('draws the photograph tiny so the browser’s own smoothing blurs it back up', async () => {
    const drawImage = vi.fn()
    const canvas = withCanvas({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(4000)
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(3000)

    const url = await blurPhoto('data:image/jpeg;base64,AAAA')

    expect(url).toBe('data:image/jpeg;base64,BBBB')
    expect(canvas.width).toBe(40)
    expect(canvas.height).toBe(30)
    expect(drawImage).toHaveBeenCalledTimes(1)
  })

  it('has no ground to give when the browser cannot draw it', async () => {
    withCanvas(null)

    expect(await blurPhoto('data:image/jpeg;base64,AAAA')).toBeNull()
  })

  it('has no ground to give when the image cannot be read', async () => {
    stubDecode(() => Promise.reject(new Error('broken')))

    expect(await blurPhoto('data:image/jpeg;base64,AAAA')).toBeNull()
  })
})
