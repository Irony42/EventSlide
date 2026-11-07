import { describe, expect, it } from 'vitest'
import type { ImageProcessor, RenderSpec } from '../../ports/imageProcessor'

/**
 * The promises of `ImageProcessor` that a caller leans on, held against the fake and against
 * `sharp`: the dimensions a probe reports, that a render fits its box without enlarging and
 * keeps the aspect ratio, that it answers the format asked for, and that a file that is not an
 * image is refused with `image.corrupt`.
 *
 * Deliberately not here: `RenderedImage.byteSize` (the fake scripts it, `sharp` measures it) and
 * pixel content.
 */
export interface ImageProcessorSubject {
  readonly processor: ImageProcessor
  /** A decodable image of exactly this size. */
  readonly image: (width: number, height: number) => Promise<Uint8Array>
  /** Bytes the processor must refuse. */
  readonly corrupt: () => Promise<Uint8Array>
}

const DISPLAY: RenderSpec = { maxWidth: 2560, maxHeight: 2560, quality: 82, format: 'jpeg' }
const THUMB: RenderSpec = { maxWidth: 480, maxHeight: 480, quality: 78, format: 'jpeg' }

export const imageProcessorContract = (
  name: string,
  makeSubject: () => Promise<ImageProcessorSubject>,
): void => {
  describe(`ImageProcessor contract: ${name}`, () => {
    it('probes the dimensions of an image', async () => {
      const { processor, image } = await makeSubject()

      const probed = await processor.probe(await image(640, 480))

      expect(probed.ok && [probed.value.dimensions.width, probed.value.dimensions.height]).toEqual([
        640, 480,
      ])
    })

    it('refuses bytes that are not an image, with an image.* code', async () => {
      const { processor, corrupt } = await makeSubject()

      const probed = await processor.probe(await corrupt())

      expect(!probed.ok && probed.error.code).toMatch(/^image./)
    })

    it('shrinks a large image into the box, keeping its aspect ratio', async () => {
      const { processor, image } = await makeSubject()

      const rendered = await processor.render(await image(4000, 3000), THUMB)

      expect(
        rendered.ok && [rendered.value.dimensions.width, rendered.value.dimensions.height],
      ).toEqual([480, 360])
    })

    it('fits a portrait image by its tall edge', async () => {
      const { processor, image } = await makeSubject()

      const rendered = await processor.render(await image(3000, 4000), THUMB)

      expect(
        rendered.ok && [rendered.value.dimensions.width, rendered.value.dimensions.height],
      ).toEqual([360, 480])
    })

    it('never enlarges an image that already fits the box', async () => {
      const { processor, image } = await makeSubject()

      const rendered = await processor.render(await image(300, 200), DISPLAY)

      expect(
        rendered.ok && [rendered.value.dimensions.width, rendered.value.dimensions.height],
      ).toEqual([300, 200])
    })

    it('answers the format it was asked for', async () => {
      const { processor, image } = await makeSubject()
      const bytes = await image(800, 600)

      const jpeg = await processor.render(bytes, THUMB)
      const webp = await processor.render(bytes, { ...THUMB, format: 'webp' })

      expect(jpeg.ok && jpeg.value.format).toBe('jpeg')
      expect(webp.ok && webp.value.format).toBe('webp')
    })
  })
}
