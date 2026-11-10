import { describe, expect, it } from 'vitest'
import type { WallLayout } from '../../lib/api/dto'
import { joinSlotOf } from './joinSlot'

const LAYOUTS: readonly WallLayout[] = [
  'spotlight',
  'mosaic',
  'polaroid',
  'filmstrip',
  'collage',
  'split',
  'clothesline',
]

describe('joinSlotOf', () => {
  it('keeps the invitation in a corner for the spotlight only', () => {
    expect(LAYOUTS.filter((layout) => joinSlotOf(layout) === 'corner')).toEqual(['spotlight'])
  })

  it('gives every other layout the place its composition has for it', () => {
    expect(Object.fromEntries(LAYOUTS.map((layout) => [layout, joinSlotOf(layout)]))).toEqual({
      spotlight: 'corner',
      mosaic: 'tile',
      polaroid: 'print',
      filmstrip: 'band',
      collage: 'cell',
      split: 'seam',
      clothesline: 'tag',
    })
  })
})
