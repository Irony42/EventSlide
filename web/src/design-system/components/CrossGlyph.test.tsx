import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CloseIcon } from './CloseIcon'
import { CROSS_PATH } from './iconPaths'
import { StatusIcon } from './StatusIcon'

const pathOf = (element: ReactElement): string | null | undefined =>
  render(element).container.querySelector('path')?.getAttribute('d')

describe('the cross glyph', () => {
  it('is drawn from one path in the dismiss button and in the danger status', () => {
    expect(pathOf(<CloseIcon />)).toBe(CROSS_PATH)
    expect(pathOf(<StatusIcon tone="danger" />)).toBe(CROSS_PATH)
  })

  it('is not the path of the other tones', () => {
    expect(pathOf(<StatusIcon tone="success" />)).not.toBe(CROSS_PATH)
  })
})
