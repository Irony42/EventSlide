import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { fr } from '../../../lib/i18n/fr'
import { aGuestPhoto, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { classesOf, cls } from '../../../testing/classesOf'
import { MyPhotos } from './MyPhotos'
import styles from './MyPhotos.module.css'
import type { Api } from '../../../lib/api/client'
import type { GuestPhotoDto } from '../../../lib/api/dto'

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
        slug="camille-et-sacha"
        reactionsEnabled={false}
      />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => classesOf(row))).toEqual([
      [cls(styles, 'photo')],
      [cls(styles, 'photo'), cls(styles, 'clipRow')],
    ])
  })
})

describe('MyPhotos reactions', () => {
  const SLUG = 'camille-et-sacha'

  const renderList = (
    photos: readonly GuestPhotoDto[],
    options: { readonly reactionsEnabled: boolean; readonly api?: Api },
  ) =>
    renderWithProviders(
      <MyPhotos
        photos={photos}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onDelete={vi.fn(() => Promise.resolve())}
        slug={SLUG}
        reactionsEnabled={options.reactionsEnabled}
      />,
      options.api === undefined ? {} : { api: options.api },
    )

  it('offers the reactions under a photo that is on the wall when the host has them on', async () => {
    renderList([aGuestPhoto({ id: 'photo-1', status: 'published' })], { reactionsEnabled: true })

    expect(await screen.findByRole('group', { name: fr.upload.reactionsGroup(1) })).toBeVisible()
  })

  it('offers nothing under a photo that is not on the wall, whatever the host decided', () => {
    // A reaction lands only on what the room can see: the server would answer a pending
    // photo with `reaction.notPublished`, and a button that can only be refused is a
    // button that should not be there.
    const api = fakeApi()
    renderList(
      [
        aGuestPhoto({ id: 'photo-1', status: 'pending' }),
        aGuestPhoto({ id: 'photo-2', status: 'rejected' }),
        aGuestPhoto({ id: 'photo-3', status: 'hidden' }),
      ],
      { reactionsEnabled: true, api },
    )

    expect(screen.queryByRole('group')).toBeNull()
    expect(api.reactions).not.toHaveBeenCalled()
  })

  it('offers nothing, and asks the server nothing, when the host has reactions off', () => {
    const api = fakeApi()
    renderList([aGuestPhoto({ id: 'photo-1', status: 'published' })], {
      reactionsEnabled: false,
      api,
    })

    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByRole('button', { name: fr.upload.reactionKinds.love })).toBeNull()
    expect(api.reactions).not.toHaveBeenCalled()
  })

  it('numbers each row by the photo’s place in the list, so no two rows share a name', async () => {
    renderList(
      [
        aGuestPhoto({ id: 'photo-1', status: 'pending' }),
        aGuestPhoto({ id: 'photo-2', status: 'published' }),
        aGuestPhoto({ id: 'photo-3', status: 'published' }),
      ],
      { reactionsEnabled: true },
    )

    expect(await screen.findByRole('group', { name: fr.upload.reactionsGroup(2) })).toBeVisible()
    expect(screen.getByRole('group', { name: fr.upload.reactionsGroup(3) })).toBeVisible()
    expect(screen.queryByRole('group', { name: fr.upload.reactionsGroup(1) })).toBeNull()
  })

  it('asks for the reactions of the photo it sits under, in this event', async () => {
    const api = fakeApi()
    renderList([aGuestPhoto({ id: 'photo-7', status: 'published' })], {
      reactionsEnabled: true,
      api,
    })

    await screen.findByRole('group')

    expect(api.reactions).toHaveBeenCalledWith(SLUG, 'photo-7', expect.any(AbortSignal))
  })
})
