import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  kraftTexture,
  once,
  pixelsFor,
  prepareContain,
  prepareCover,
  reduce,
  shadowImage,
} from './bookImages'

const source = async (width: number, height: number): Promise<Uint8Array> =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 160 } } })
    .jpeg()
    .toBuffer()

describe('pixelsFor', () => {
  it('turns millimetres into pixels at a resolution, never under one', () => {
    expect(pixelsFor(25.4, 300)).toBe(300)
    expect(pixelsFor(210, 150)).toBe(1240)
    expect(pixelsFor(0.001, 150)).toBe(1)
  })
})

describe('prepareCover', () => {
  it('fills the box exactly, whatever the shape of the photograph', async () => {
    for (const [w, h] of [
      [1600, 900],
      [900, 1600],
    ] as const) {
      const prepared = await prepareCover(await source(w, h), 400, 300, 82)
      expect([prepared.width, prepared.height]).toEqual([400, 300])
      expect((await sharp(prepared.jpeg).metadata()).format).toBe('jpeg')
    }
  })
})

describe('prepareContain', () => {
  it('keeps the shape of the photograph whole inside the box', async () => {
    const prepared = await prepareContain(await source(1600, 800), 400, 400, 82)

    expect([prepared.width, prepared.height]).toEqual([400, 200])
  })

  it('never enlarges a small photograph', async () => {
    const prepared = await prepareContain(await source(100, 50), 400, 400, 82)

    expect([prepared.width, prepared.height]).toEqual([100, 50])
  })
})

describe('reduce', () => {
  it('shrinks a prepared photograph to the asked size', async () => {
    const big = await prepareCover(await source(1600, 900), 800, 600, 90)

    const small = await reduce(big, 400, 300, 82)

    expect([small.width, small.height]).toEqual([400, 300])
    expect(small.jpeg.length).toBeLessThan(big.jpeg.length)
  })
})

describe('the generated images', () => {
  it('makes a transparent shadow once, and a kraft paper the same every time', async () => {
    const first = await shadowImage()
    expect(await shadowImage()).toBe(first)
    expect((await sharp(first).metadata()).hasAlpha).toBe(true)

    const paper = await kraftTexture()
    expect(await kraftTexture()).toBe(paper)
    expect((await sharp(paper).metadata()).width).toBe(256)
  })
})

describe('once', () => {
  it('makes a value once and gives the same one after', async () => {
    let made = 0
    const get = once(async () => ++made)

    expect(await get()).toBe(1)
    expect(await get()).toBe(1)
    expect(made).toBe(1)
  })

  it('does not keep a failure: the next call tries again', async () => {
    let calls = 0
    const get = once(async () => {
      calls += 1
      if (calls === 1) throw new Error('disk')
      return 'ok'
    })

    await expect(get()).rejects.toThrow('disk')
    expect(await get()).toBe('ok')
    expect(await get()).toBe('ok')
    expect(calls).toBe(2)
  })
})
