import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import sharp from 'sharp'
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/** Where the element is on the page, in page pixels, once the fonts are in and nothing has moved for five frames. */
const settledBox = (qr: Locator): Promise<string> =>
  qr.evaluate(async (element) => {
    await document.fonts.ready
    let last = ''
    let still = 0
    for (let frame = 0; frame < 300 && still < 5; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      const box = element.getBoundingClientRect()
      const key = [box.x + scrollX, box.y + scrollY, box.width, box.height].join(',')
      still = key === last ? still + 1 : 0
      last = key
    }
    if (still < 5) throw new Error('the QR kept moving: its layout never settled')
    return last
  })

/**
 * A screenshot of the element taken while it is **known to be still**: the layout is waited on
 * before the capture (the fit of the card's texts and the zoom both re-lay the sheet out), the box
 * is read again after it, and a capture of a box that moved meanwhile, or that is not the whole
 * square code at four pixels a module at least, is taken again rather than read.
 */
const captureStill = async (qr: Locator, modules: number): Promise<Buffer> => {
  let reason = ''
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await settledBox(qr)
    const png = await qr.screenshot({ omitBackground: true })
    const after = await settledBox(qr)
    const { width = 0, height = 0 } = await sharp(png).metadata()
    if (before !== after) reason = `the box moved from ${before} to ${after}`
    else if (Math.abs(width - height) > 1) reason = `the capture is ${width}x${height}, not square`
    else if (width < Math.ceil(modules) * 4)
      reason = `the capture is ${width}px for ${modules} modules`
    else return png
  }
  throw new Error(`no still, whole capture of the QR: ${reason}`)
}

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
    png = await captureStill(qr, modules)
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

/**
 * What a QR reader finds anywhere in an image file (an invitation image downloaded from the
 * console): the code is looked for in the picture as it is, then at lower sizes, the way a phone
 * finds one by moving. Throws when none is read.
 */
export const decodeQrInImage = async (image: Buffer): Promise<string> => {
  const { width = 0 } = await sharp(image).metadata()
  let failure: unknown = new Error('no QR found in the image')
  for (const scale of [1, 0.75, 0.5]) {
    const { data, info } = await sharp(image)
      .flatten({ background: '#ffffff' })
      .resize(Math.round(width * scale))
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
