import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { aGuestPhoto, renderWithProviders } from '../../../testing/renderWithProviders'
import notice from '../../../design-system/components/Notice.module.css'
import { fr } from '../../../lib/i18n/fr'
import { classesOf, cls } from '../../../testing/classesOf'
import { MyPhotos } from './MyPhotos'
import styles from './MyPhotos.module.css'

describe('MyPhotos', () => {
  it('shows a photo awaiting the host as its negative, and only that one (ADR 0010)', () => {
    renderWithProviders(
      <MyPhotos
        photos={[
          aGuestPhoto({ id: 'photo-1', status: 'pending' }),
          aGuestPhoto({ id: 'photo-2', status: 'published' }),
        ]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onDelete={vi.fn(() => Promise.resolve())}
      />,
    )

    const thumbs = [...document.querySelectorAll('img')]
    expect(thumbs.map((thumb) => classesOf(thumb))).toEqual([
      [cls(styles, 'thumb'), cls(styles, 'negative')],
      [cls(styles, 'thumb')],
    ])
    // The filter is never the only signal: the words are still there.
    expect(screen.getByText(fr.upload.statusPending)).toBeInTheDocument()
  })

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

  it('shows a failed refresh above the thumbnails it kept, framed like the host’s failures, with a retry', async () => {
    // The list is the one screen that tells a guest their photos arrived. A refresh that
    // fails says so; it does not take the proof away.
    const onRetry = vi.fn()
    renderWithProviders(
      <MyPhotos
        photos={[aGuestPhoto({ id: 'photo-1' })]}
        loading={false}
        error={fr.upload.mineFailed}
        onRetry={onRetry}
        onDelete={vi.fn(() => Promise.resolve())}
      />,
    )

    const failure = screen.getByRole('alert')
    expect(failure).toHaveTextContent(fr.upload.mineFailed)
    expect(classesOf(failure)).toContain(cls(notice, 'boxed'))
    const list = screen.getByRole('list')
    expect(failure.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('listitem')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
