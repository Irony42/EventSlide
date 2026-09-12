import { afterEach, describe, expect, it, vi } from 'vitest'
import { downscaleImage } from './downscaleImage'

/**
 * jsdom has no canvas and no image decoder, so the browser side is stubbed here — the
 * same category of stand-in as the `IntersectionObserver` and `EventSource` stubs in
 * testing/setup.ts. What is being asserted is this module's own decisions: when to
 * shrink, how far, and that no failure path ever loses the photo.
 */

const aFileOf = (bytes: number, name = 'photo.jpg', type = 'image/jpeg'): File =>
  new File([new Uint8Array(bytes)], name, { type })

const aBitmap = (width: number, height: number): ImageBitmap => ({
  width,
  height,
  close: () => {},
})

const stubDecoder = (bitmap: ImageBitmap): void => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve(bitmap)),
  )
}

/**
 * Casts through `unknown`: a hand-written stub cannot satisfy the whole
 * `CanvasRenderingContext2D` interface, and jsdom implements none of it.
 */
const stubCanvas = (blob: Blob | null) => {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
    callback(blob)
  })
  return { drawImage }
}

describe('downscaleImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves a photo that is already small alone', async () => {
    // Re-encoding a 200 kB photo costs more than it saves and can make it larger.
    const original = aFileOf(200_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('leaves a file that is not an image alone', async () => {
    const original = aFileOf(4_000_000, 'notes.pdf', 'application/pdf')

    expect(await downscaleImage(original)).toBe(original)
  })

  it('uploads the original when the browser cannot decode at all', async () => {
    // No `createImageBitmap`: there is no safe way to decode here, and a photo that
    // uploads slowly beats a photo that never uploads.
    const original = aFileOf(4_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('uploads the original when the decode fails', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('corrupt'))),
    )
    const original = aFileOf(4_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('leaves a photo that already fits the display size alone', async () => {
    stubDecoder(aBitmap(1600, 1200))
    const original = aFileOf(4_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('caps the longest edge at the display variant and re-encodes to JPEG', async () => {
    // A 20 MP phone photo is 4-12 MB and the largest variant the server keeps is
    // 2560 px, so everything above that is upload time spent on bytes that are
    // discarded on arrival.
    stubDecoder(aBitmap(5000, 4000))
    const { drawImage } = stubCanvas(new Blob([new Uint8Array(900_000)]))

    const result = await downscaleImage(aFileOf(6_000_000, 'IMG_4821.jpeg'))

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 2048)
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('IMG_4821.jpg')
    expect(result.size).toBe(900_000)
  })

  it('keeps the original when the re-encode came out no smaller', async () => {
    stubDecoder(aBitmap(5000, 4000))
    stubCanvas(new Blob([new Uint8Array(7_000_000)]))
    const original = aFileOf(6_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('keeps the original when the codec produces nothing', async () => {
    stubDecoder(aBitmap(5000, 4000))
    stubCanvas(null)
    const original = aFileOf(6_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('keeps the original when the canvas refuses a 2D context', async () => {
    stubDecoder(aBitmap(5000, 4000))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const original = aFileOf(6_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('keeps the original when the browser refuses to draw the bitmap', async () => {
    // Safari throws here on a photo whose decoded surface exceeds its canvas budget.
    // Rethrowing would lose the photo; the server re-encodes anyway.
    stubDecoder(aBitmap(5000, 4000))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage: () => {
            throw new Error('total canvas memory use exceeds the maximum limit')
          },
        }) as unknown as CanvasRenderingContext2D,
    )
    const original = aFileOf(6_000_000)

    expect(await downscaleImage(original)).toBe(original)
  })

  it('releases the decoded bitmap even when the re-encode throws', async () => {
    // A 12 MP photo decodes to a 48 MB surface, and a guest sending thirty of them
    // would hold all thirty until the garbage collector noticed.
    const close = vi.fn()
    stubDecoder({ width: 5000, height: 4000, close })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage: () => {
            throw new Error('total canvas memory use exceeds the maximum limit')
          },
        }) as unknown as CanvasRenderingContext2D,
    )

    await downscaleImage(aFileOf(6_000_000))

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('names the shrunken photo .jpg even when the original had no extension', async () => {
    // Some Android share sheets hand over a file with no extension at all. Uploading
    // it as `photo` would leave the server guessing from bytes alone.
    stubDecoder(aBitmap(5000, 4000))
    stubCanvas(new Blob([new Uint8Array(900_000)]))

    const result = await downscaleImage(aFileOf(6_000_000, 'IMG_4821'))

    expect(result.name).toBe('IMG_4821.jpg')
  })
})
