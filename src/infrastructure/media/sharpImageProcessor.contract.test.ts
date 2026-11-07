import sharp from 'sharp'
import { imageProcessorContract } from '../../application/testing/contracts/imageProcessorContract'
import { createSharpImageProcessor } from './sharpImageProcessor'

imageProcessorContract('sharp', async () => ({
  processor: createSharpImageProcessor({ maxPixels: 50_000_000 }),
  image: async (width, height) =>
    new Uint8Array(
      await sharp({
        create: { width, height, channels: 3, background: { r: 200, g: 60, b: 120 } },
      })
        .jpeg()
        .toBuffer(),
    ),
  corrupt: async () => new TextEncoder().encode('this is not an image, only text'),
}))
