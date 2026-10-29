import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { EventDto } from '../../../lib/api/dto'
import { VenuePhotoField } from './VenuePhotoField'

const URL_PATH = `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`

const withPhoto = (): EventDto =>
  anEventDto({
    settings: eventSettings({
      theme: {
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        material: 'glass',
        ambiance: 'eventslide',
        groundUrl: URL_PATH,
      },
    }),
  })

const photo = (): File => new File(['pixels'], 'le-lieu.jpg', { type: 'image/jpeg' })

const renderField = (
  api: Api,
  props: Partial<Parameters<typeof VenuePhotoField>[0]> = {},
  onChanged: (event: EventDto) => void = () => {},
) =>
  renderWithProviders(
    <VenuePhotoField
      slug="camille-et-sacha"
      groundUrl={null}
      disabled={false}
      onChanged={onChanged}
      {...props}
    />,
    { api },
  )

describe('VenuePhotoField', () => {
  it('says the ambiance shows its own photo when the host has uploaded none', () => {
    renderField(fakeApi())

    expect(screen.getByText(fr.admin.venuePhotoDefault)).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.venuePhotoRemove })).toBeNull()
    expect(screen.getByText(fr.admin.venuePhotoChoose)).toBeVisible()
  })

  it('uploads what the host picks and hands the answered event to the page', async () => {
    const answered = withPhoto()
    const putVenuePhoto = vi.fn(async () => answered)
    const onChanged = vi.fn()
    renderField(fakeApi({ putVenuePhoto }), {}, onChanged)
    const file = photo()

    await userEvent.upload(screen.getByTestId('venue-photo-input'), file)

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(answered))
    expect(putVenuePhoto).toHaveBeenCalledWith('camille-et-sacha', file)
  })

  it('confirms in the host’s language', async () => {
    renderField(fakeApi({ putVenuePhoto: vi.fn(async () => withPhoto()) }))

    await userEvent.upload(screen.getByTestId('venue-photo-input'), photo())

    expect(await screen.findByText(fr.admin.venuePhotoSaved)).toBeVisible()
  })

  it('shows the photograph the server holds, with a text alternative', () => {
    renderField(fakeApi(), { groundUrl: URL_PATH })

    const preview = screen.getByRole('img', { name: fr.admin.venuePhotoPreviewAlt })
    expect(preview).toHaveAttribute('src', URL_PATH)
    expect(screen.getByText(fr.admin.venuePhotoReplace)).toBeVisible()
    expect(screen.queryByText(fr.admin.venuePhotoDefault)).toBeNull()
  })

  it('takes the photograph down and says the default is back', async () => {
    const answered = anEventDto()
    const removeVenuePhoto = vi.fn(async () => answered)
    const onChanged = vi.fn()
    renderField(fakeApi({ removeVenuePhoto }), { groundUrl: URL_PATH }, onChanged)

    await userEvent.click(screen.getByRole('button', { name: fr.admin.venuePhotoRemove }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(answered))
    expect(removeVenuePhoto).toHaveBeenCalledWith('camille-et-sacha')
    expect(await screen.findByText(fr.admin.venuePhotoRemoved)).toBeVisible()
  })

  it('names the server’s refusal in the host’s language and keeps the old photograph', async () => {
    const putVenuePhoto = vi.fn(() => Promise.reject(new ApiError(400, 'image.unsupportedFormat')))
    const onChanged = vi.fn()
    renderField(fakeApi({ putVenuePhoto }), { groundUrl: URL_PATH }, onChanged)

    await userEvent.upload(screen.getByTestId('venue-photo-input'), photo(), { applyAccept: false })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['image.unsupportedFormat'])
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: fr.admin.venuePhotoPreviewAlt })).toBeVisible()
  })

  it('names a refused removal too', async () => {
    renderField(fakeApi({ removeVenuePhoto: vi.fn(() => Promise.reject(ApiError.network())) }), {
      groundUrl: URL_PATH,
    })

    await userEvent.click(screen.getByRole('button', { name: fr.admin.venuePhotoRemove }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
  })

  it('clears an earlier refusal when the next attempt starts', async () => {
    const putVenuePhoto = vi
      .fn<Api['putVenuePhoto']>()
      .mockRejectedValueOnce(new ApiError(400, 'image.corrupt'))
      .mockResolvedValueOnce(withPhoto())
    renderField(fakeApi({ putVenuePhoto }))
    const input = screen.getByTestId('venue-photo-input')

    await userEvent.upload(input, photo())
    expect(await screen.findByRole('alert')).toBeVisible()
    await userEvent.upload(input, photo())

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('says it is working while the file travels, in a live region that is always there', async () => {
    let release: (event: EventDto) => void = () => {}
    const putVenuePhoto = vi.fn(
      () =>
        new Promise<EventDto>((resolve) => {
          release = resolve
        }),
    )
    renderField(fakeApi({ putVenuePhoto }))
    expect(screen.getByRole('status')).toHaveTextContent('')

    await userEvent.upload(screen.getByTestId('venue-photo-input'), photo())

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.venuePhotoBusy)
    expect(screen.getByTestId('venue-photo-input')).toBeDisabled()
    release(withPhoto())
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''))
  })

  it('closes both controls for a moderator or an archived event', () => {
    renderField(fakeApi(), { groundUrl: URL_PATH, disabled: true })

    expect(screen.getByTestId('venue-photo-input')).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.admin.venuePhotoRemove })).toBeDisabled()
  })
})
