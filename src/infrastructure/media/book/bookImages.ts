import sharp from 'sharp'

/**
 * What the book asks of `sharp`: one photograph at a time, never anything global (`concurrency`,
 * `cache` are process-wide and would slow the guests' uploads that share the process). The only
 * decoder this opens is `sharp`, on JPEGs the ingest pipeline re-encoded itself.
 */

export interface Prepared {
  readonly jpeg: Buffer
  readonly width: number
  readonly height: number
}

const MM_PER_INCH = 25.4
export const pixelsFor = (mm: number, dpi: number): number =>
  Math.max(1, Math.round((mm / MM_PER_INCH) * dpi))

const toPrepared = ({
  data,
  info,
}: {
  data: Buffer
  info: { width: number; height: number }
}): Prepared => ({ jpeg: data, width: info.width, height: info.height })

/**
 * A photograph filling a box (`cover`, the interesting part kept: `attention`), at the box's own
 * pixel size. `sharp` rotates by the EXIF orientation first (the ingest baked it in already; the
 * `rotate()` is a no-op there and a seat belt otherwise).
 */
export const prepareCover = async (
  bytes: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Promise<Prepared> =>
  toPrepared(
    await sharp(bytes)
      .rotate()
      .resize(width, height, { fit: 'cover', position: 'attention' })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true }),
  )

/** A photograph contained whole in a box, never cropped, never enlarged past its own pixels. */
export const prepareContain = async (
  bytes: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Promise<Prepared> =>
  toPrepared(
    await sharp(bytes)
      .rotate()
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true }),
  )

/** A prepared photograph reduced to a smaller box of the same shape (the screen copy of a printer one). */
export const reduce = async (
  from: Prepared,
  width: number,
  height: number,
  quality: number,
): Promise<Prepared> =>
  toPrepared(
    await sharp(from.jpeg)
      .resize(width, height, { fit: 'fill' })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true }),
  )

/** A soft shadow under a polaroid: a blurred black square on transparency, made once. */
let shadow: Promise<Buffer> | null = null
export const shadowImage = (): Promise<Buffer> => {
  shadow ??= sharp({
    create: { width: 240, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: 160,
            height: 160,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0.55 },
          },
        },
        left: 40,
        top: 40,
      },
    ])
    .blur(14)
    .png()
    .toBuffer()
  return shadow
}

/**
 * The kraft paper of the Souvenir style: a square of fine fibres from a seeded generator, so it is
 * the same every time, made once and tiled by the renderer.
 */
let kraft: Promise<Buffer> | null = null
export const kraftTexture = (): Promise<Buffer> => {
  kraft ??= (async () => {
    const size = 256
    const raw = Buffer.alloc(size * size * 3)
    let state = 0x2545f491
    for (let i = 0; i < size * size; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const grain = (state >>> 24) % 28
      raw[i * 3] = 205 - grain
      raw[i * 3 + 1] = 180 - grain
      raw[i * 3 + 2] = 140 - grain
    }
    return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
      .blur(0.8)
      .jpeg({ quality: 80 })
      .toBuffer()
  })()
  return kraft
}
