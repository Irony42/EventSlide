import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { aGuestPhoto, renderWithProviders } from '../../../testing/renderWithProviders'
import { MyPhotos } from './MyPhotos'
import styles from './MyPhotos.module.css'

/**
 * The guest's own list on a disposable-camera evening (spec 23): a photograph still veiled keeps its
 * black and white, and the film look is for the ones that are developed. Never both on one element,
 * so the transition that already exists carries the one into the other.
 */
const VEIL = styles['undeveloped'] ?? 'undeveloped'

const render = (film: boolean | undefined, ...photos: Parameters<typeof aGuestPhoto>[0][]) =>
  renderWithProviders(
    <MyPhotos
      photos={photos.map((photo) => aGuestPhoto(photo))}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      onDelete={vi.fn(() => Promise.resolve())}
      {...(film === undefined ? {} : { film })}
    />,
  )

const imageOf = (index: number): HTMLElement => {
  const image = screen.getAllByRole('listitem')[index]?.querySelector('img')
  if (image === null || image === undefined) throw new Error(`no image in row ${index}`)
  return image
}

describe('MyPhotos with the film look', () => {
  it('draws a developed photograph with the look and no veil', () => {
    render(true, { id: 'a', status: 'published' })

    expect(imageOf(0)).toHaveClass('filmLook')
    expect(imageOf(0)).not.toHaveClass(VEIL)
  })

  it('keeps a photograph that awaits the reveal veiled, without the look', () => {
    render(true, { id: 'a', status: 'published', awaitsReveal: true })

    expect(imageOf(0)).toHaveClass(VEIL)
    expect(imageOf(0)).not.toHaveClass('filmLook')
  })

  it('keeps a photograph that awaits the host veiled, without the look', () => {
    render(true, { id: 'a', status: 'pending' })

    expect(imageOf(0)).toHaveClass(VEIL)
    expect(imageOf(0)).not.toHaveClass('filmLook')
  })

  it('puts no look on an evening without the film look', () => {
    render(false, { id: 'a', status: 'published' })

    expect(imageOf(0)).not.toHaveClass('filmLook')
  })

  it('puts no look when the flag is not passed at all', () => {
    render(undefined, { id: 'a', status: 'published' })

    expect(imageOf(0)).not.toHaveClass('filmLook')
  })
})
