import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { aGuestPhoto } from '../../../testing/renderWithProviders'
import { BACKDROP_PHOTOS, GuestBackdrop, backdropPhotos } from './GuestBackdrop'

const at = (
  id: string,
  createdAt: string,
  status: 'pending' | 'published' | 'rejected' = 'published',
) => aGuestPhoto({ id, createdAt, status, thumbUrl: `/media/${id}.jpg` })

describe('the guest’s photographs as the page’s ambient light (clear glass, W2)', () => {
  it('takes the newest few, and never a refused one', () => {
    const photos = [
      at('old', '2026-10-30T10:00:00Z'),
      at('refused', '2026-10-30T13:00:00Z', 'rejected'),
      at('b', '2026-10-30T11:00:00Z'),
      at('newest', '2026-10-30T12:00:00Z', 'pending'),
      at('c', '2026-10-30T11:30:00Z'),
    ]
    expect(backdropPhotos(photos).map((photo) => photo.id)).toEqual(['newest', 'c', 'b'])
    expect(backdropPhotos(photos)).toHaveLength(BACKDROP_PHOTOS)
  })

  it('draws nothing at all before the guest has sent a photograph', () => {
    const { container } = render(<GuestBackdrop photos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is decoration: hidden from assistive technology, no text, one tile per photograph', () => {
    const { getByTestId } = render(
      <GuestBackdrop photos={[at('a', '2026-10-30T10:00:00Z'), at('b', '2026-10-30T11:00:00Z')]} />,
    )
    const layer = getByTestId('guest-backdrop')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.textContent).toBe('')
    const tiles = [...layer.querySelectorAll('span')]
    expect(tiles.map((tile) => tile.style.getPropertyValue('--backdrop-image'))).toEqual([
      'url("/media/b.jpg")',
      'url("/media/a.jpg")',
    ])
  })
})
