import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { aGuestPhoto, renderWithProviders } from '../../../testing/renderWithProviders'
import { classesOf, cls } from '../../../testing/classesOf'
import { MyPhotos } from './MyPhotos'
import styles from './MyPhotos.module.css'

describe('MyPhotos', () => {
  it('gives a clip’s row its own class after the row class, and a photo’s row only the row class', () => {
    renderWithProviders(
      <MyPhotos
        photos={[
          aGuestPhoto({ id: 'photo-1' }),
          aGuestPhoto({ id: 'clip-1', kind: 'clip', videoUrl: '/api/clips/clip-1.mp4' }),
        ]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onDelete={vi.fn(() => Promise.resolve())}
      />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => classesOf(row))).toEqual([
      [cls(styles, 'photo')],
      [cls(styles, 'photo'), cls(styles, 'clipRow')],
    ])
  })
})
