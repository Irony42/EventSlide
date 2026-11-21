import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import sharp from 'sharp'
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/** What a QR reader finds in a screenshot of the element, flattened on white paper. */
export const decodeQr = async (qr: Locator): Promise<string> => {
  // Paper is white, and a browser prints no background: the console's dark one would swallow the
  // modules in a screenshot, so the element is put on white the way the sheet of paper is.
  await qr.evaluate((element) => {
    element.style.background = 'white'
  })
  // zxing's binariser works on 8-pixel blocks and wants a module a few pixels wide. At 1x the code
  // is about three and a half pixels per module with a fractional origin, so each link (the port
  // and the join code change from one server to the next) was anti-aliased differently and about
  // one in ten was lost; drawn large it is the opposite, a module wider than a block. So the
  // element is painted at four times the size and brought down to a few pixels a module,
  // which is the same image for every link. What is read is still only what the browser paints.
  const modules = await qr.evaluate((element) => {
    const svg = element instanceof SVGSVGElement ? element : element.querySelector('svg')
    return svg?.viewBox.baseVal.width ?? 0
  })
  expect(modules, 'the QR is an SVG with a viewBox in modules').toBeGreaterThan(0)
  const page = qr.page()
  await page.evaluate(() => {
    document.documentElement.style.zoom = '4'
  })
  let png: Buffer
  try {
    png = await qr.screenshot({ omitBackground: true })
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.zoom = ''
    })
  }
  // The binariser still has opinions about the module size, and not the same ones for every
  // link, so the capture is read at a few sizes, the way a phone's camera finds a code by
  // moving: the first size that decodes wins, and what it decodes must still equal the link.
  let failure: unknown = new Error('the QR was not read at any size')
  for (const pixelsPerModule of [4, 2, 3, 5, 6]) {
    const side = Math.ceil(modules) * pixelsPerModule
    const { data, info } = await sharp(png)
      .flatten({ background: '#ffffff' })
      .resize(side, side, { fit: 'fill', kernel: 'lanczos3' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)
    try {
      return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText()
    } catch (error) {
      failure = error
    }
  }
  throw failure
}
