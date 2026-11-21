import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRINT_PHOTO_MAX_SIDE,
  isPrintPhotoUrl,
  preparePrintPhoto,
  readPrintPhoto,
  scaledSize,
  writePrintPhoto,
} from './printPhoto'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('the photograph of the printed card', () => {
  it('caps the long side and keeps the ratio, never enlarging', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: PRINT_PHOTO_MAX_SIDE, height: 900 })
    expect(scaledSize(3000, 4000)).toEqual({ width: 900, height: PRINT_PHOTO_MAX_SIDE })
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('accepts only the JPEG data URL it writes itself', () => {
    expect(isPrintPhotoUrl(JPEG)).toBe(true)
    expect(isPrintPhotoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isPrintPhotoUrl('https://elsewhere.example/a.jpg')).toBe(false)
    expect(isPrintPhotoUrl('javascript:alert(1)')).toBe(false)
  })

  it('remembers it per event and forgets it on request', () => {
    writePrintPhoto('noces', JPEG)
    expect(readPrintPhoto('noces')).toBe(JPEG)
    expect(readPrintPhoto('autre')).toBeNull()
    writePrintPhoto('noces', null)
    expect(readPrintPhoto('noces')).toBeNull()
  })

  it('ignores what storage holds when it is not such a URL', () => {
    window.localStorage.setItem('eventslide.printPhoto.noces', 'https://elsewhere.example/a.jpg')
    expect(readPrintPhoto('noces')).toBeNull()
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => writePrintPhoto('noces', JPEG)).not.toThrow()
    expect(readPrintPhoto('noces')).toBeNull()
  })

  it('says whether the photograph was kept', () => {
    expect(writePrintPhoto('noces', JPEG)).toBe(true)
    expect(writePrintPhoto('noces', null)).toBe(true)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(writePrintPhoto('noces', JPEG)).toBe(false)
  })
})

describe('preparing the photograph in the browser', () => {
  const stubCanvas = (url: string) => {
    const calls: string[] = []
    const context = {
      set fillStyle(value: string) {
        calls.push(`fill ${value}`)
      },
      fillRect: () => calls.push('fillRect'),
      drawImage: (_image: unknown, _x: number, _y: number, w: number, h: number) =>
        calls.push(`draw ${w}x${h}`),
    }
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(canvas, 'toDataURL').mockReturnValue(url)
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? canvas : create(tag),
    )
    return calls
  }

  it('lays white paper under the image before drawing it scaled, and closes the bitmap', async () => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4000, height: 3000, close })),
    )
    const calls = stubCanvas(JPEG)

    await expect(preparePrintPhoto(new Blob(['x']))).resolves.toBe(JPEG)
    expect(calls).toEqual(['fill white', 'fillRect', 'draw 1200x900'])
    expect(close).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('answers null for what the browser cannot decode, or a canvas that answers anything else', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('bad'))),
    )
    await expect(preparePrintPhoto(new Blob(['x']))).resolves.toBeNull()

    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 10, height: 10, close })),
    )
    stubCanvas('data:image/png;base64,AAAA')
    await expect(preparePrintPhoto(new Blob(['x']))).resolves.toBeNull()
    expect(close).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('forgets the previous photograph when storage refuses the new one', () => {
    writePrintPhoto('noces', JPEG)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    writePrintPhoto('noces', 'data:image/jpeg;base64,/9j/BBBB')
    vi.restoreAllMocks()
    expect(readPrintPhoto('noces')).toBeNull()
  })
})
