import { describe, expect, it } from 'vitest'
import { DomainError } from '../../domain/shared/errors'
import { MEDIA_VARIANTS } from '../ports/mediaStore'
import { VARIANT_SPECS } from '../usecases/photos/uploadPhotos'
import {
  DEFAULT_RENDERED_BYTE_SIZES,
  FakeImageProcessor,
  readTag,
  tagBytes,
} from './fakeImageProcessor'

describe('tagBytes and readTag', () => {
  it('read back what was written', () => {
    expect(readTag(tagBytes('holiday.jpg'))).toBe('holiday.jpg')
  })
})

describe('FakeImageProcessor', () => {
  it('can tell the variants apart, because their longest edges differ', () => {
    const edges = MEDIA_VARIANTS.map((variant) => VARIANT_SPECS[variant].maxWidth)

    expect(new Set(edges).size).toBe(MEDIA_VARIANTS.length)
  })

  describe('probe', () => {
    it('answers a 4032 x 3024 jpeg for a file nobody scripted', async () => {
      const probed = await new FakeImageProcessor().probe(tagBytes('a'))

      expect(probed.ok && [probed.value.format, probed.value.dimensions.width]).toEqual([
        'jpeg',
        4032,
      ])
      expect(probed.ok && probed.value.dimensions.height).toBe(3024)
    })

    it('answers the size a file was scripted with', async () => {
      const images = new FakeImageProcessor().script('wide', { width: 8000, height: 1000 })

      const probed = await images.probe(tagBytes('wide'))

      expect(probed.ok && [probed.value.dimensions.width, probed.value.dimensions.height]).toEqual([
        8000, 1000,
      ])
    })

    it('answers the refusal a file was scripted with, and no probe of another file is touched', async () => {
      const refusal = DomainError.invalid('image.corrupt')
      const images = new FakeImageProcessor().script('broken', { probeError: refusal })

      const broken = await images.probe(tagBytes('broken'))
      const fine = await images.probe(tagBytes('fine'))

      expect(!broken.ok && broken.error).toBe(refusal)
      expect(fine.ok).toBe(true)
    })

    it('writes each call down, in order', async () => {
      const images = new FakeImageProcessor()

      await images.probe(tagBytes('a'))
      await images.probe(tagBytes('b'))

      expect(images.calls).toEqual(['probe:a', 'probe:b'])
    })
  })

  describe('render', () => {
    it.each(MEDIA_VARIANTS)(
      'renders the %s variant as bytes a test can compute in advance',
      async (variant) => {
        const images = new FakeImageProcessor()

        const rendered = await images.render(tagBytes('a'), VARIANT_SPECS[variant])

        expect(rendered.ok && [...rendered.value.bytes]).toEqual([
          ...images.renderedBytes('a', variant),
        ])
        expect(rendered.ok && readTag(rendered.value.bytes)).toBe(`a/${variant}`)
      },
    )

    it('charges exactly 1 MB for the three variants of an unscripted photo', async () => {
      const images = new FakeImageProcessor()
      let total = 0

      for (const variant of MEDIA_VARIANTS) {
        const rendered = await images.render(tagBytes('a'), VARIANT_SPECS[variant])
        total += rendered.ok ? rendered.value.byteSize : 0
      }

      expect(total).toBe(1_000_000)
      expect(Object.values(DEFAULT_RENDERED_BYTE_SIZES).reduce((sum, size) => sum + size, 0)).toBe(
        1_000_000,
      )
    })

    it('charges the sizes a file was scripted with', async () => {
      const images = new FakeImageProcessor().script('big', {
        byteSizes: { original: 5, display: 3, thumb: 1 },
      })

      const rendered = await images.render(tagBytes('big'), VARIANT_SPECS.display)

      expect(rendered.ok && rendered.value.byteSize).toBe(3)
    })

    it('fits the render into the box of the variant, without enlarging', async () => {
      const images = new FakeImageProcessor().script('small', { width: 100, height: 50 })

      const thumb = await images.render(tagBytes('small'), VARIANT_SPECS.thumb)
      const huge = await images.render(tagBytes('a'), VARIANT_SPECS.thumb)

      expect(thumb.ok && [thumb.value.dimensions.width, thumb.value.dimensions.height]).toEqual([
        100, 50,
      ])
      expect(huge.ok && [huge.value.dimensions.width, huge.value.dimensions.height]).toEqual([
        480, 360,
      ])
    })

    it('fails the one variant it was scripted to fail, with the renderer’s own code', async () => {
      const images = new FakeImageProcessor().script('a', { renderErrorAt: 'thumb' })

      const display = await images.render(tagBytes('a'), VARIANT_SPECS.display)
      const thumb = await images.render(tagBytes('a'), VARIANT_SPECS.thumb)

      expect(display.ok).toBe(true)
      expect(!thumb.ok && [thumb.error.kind, thumb.error.code]).toEqual([
        'invalid',
        'image.renderFailed',
      ])
    })

    it('writes each call down with the variant it was for, in order', async () => {
      const images = new FakeImageProcessor()

      await images.probe(tagBytes('a'))
      await images.render(tagBytes('a'), VARIANT_SPECS.display)
      await images.render(tagBytes('a'), VARIANT_SPECS.thumb)

      expect(images.calls).toEqual(['probe:a', 'render:a:display', 'render:a:thumb'])
    })

    it('refuses a size that is not one of the variants, rather than guessing', async () => {
      const images = new FakeImageProcessor()

      await expect(
        images.render(tagBytes('a'), { maxWidth: 17, maxHeight: 17, quality: 80, format: 'jpeg' }),
      ).rejects.toThrow('no variant renders at 17px')
    })
  })
})
