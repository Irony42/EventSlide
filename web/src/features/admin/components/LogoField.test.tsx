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
import { LogoField } from './LogoField'

const URL_PATH = `/api/events/camille-et-sacha/logo/${'ab'.repeat(32)}`

const withLogo = (): EventDto =>
  anEventDto({
    settings: eventSettings({ brand: { welcomeMessage: null, logoUrl: URL_PATH } }),
  })

const photo = (): File => new File(['pixels'], 'logo.png', { type: 'image/png' })

const renderField = (
  api: Api,
  props: Partial<Parameters<typeof LogoField>[0]> = {},
  onChanged: (event: EventDto) => void = () => {},
) =>
  renderWithProviders(
    <LogoField
      slug="camille-et-sacha"
      logoUrl={null}
      disabled={false}
      onChanged={onChanged}
      {...props}
    />,
    { api },
  )

describe('LogoField', () => {
  it('says the ambiance shows its own photo when the host has uploaded none', () => {
    renderField(fakeApi())

    expect(screen.getByText(fr.admin.logoNone)).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.logoRemove })).toBeNull()
    expect(screen.getByText(fr.admin.logoChoose)).toBeVisible()
  })

  it('uploads what the host picks and hands the answered event to the page', async () => {
    const answered = withLogo()
    const putEventLogo = vi.fn(async () => answered)
    const onChanged = vi.fn()
    renderField(fakeApi({ putEventLogo }), {}, onChanged)
    const file = photo()

    await userEvent.upload(screen.getByTestId('logo-input'), file)

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(answered))
    expect(putEventLogo).toHaveBeenCalledWith('camille-et-sacha', file)
  })

  it('confirms in the host’s language', async () => {
    renderField(fakeApi({ putEventLogo: vi.fn(async () => withLogo()) }))

    await userEvent.upload(screen.getByTestId('logo-input'), photo())

    expect(await screen.findByText(fr.admin.logoSaved)).toBeVisible()
  })

  it('shows the logo the server holds, with a text alternative', () => {
    renderField(fakeApi(), { logoUrl: URL_PATH })

    const preview = screen.getByRole('img', { name: fr.admin.logoPreviewAlt })
    expect(preview).toHaveAttribute('src', URL_PATH)
    expect(screen.getByText(fr.admin.logoReplace)).toBeVisible()
    expect(screen.queryByText(fr.admin.logoNone)).toBeNull()
  })

  it('takes the logo down and says the default is back', async () => {
    const answered = anEventDto()
    const removeEventLogo = vi.fn(async () => answered)
    const onChanged = vi.fn()
    renderField(fakeApi({ removeEventLogo }), { logoUrl: URL_PATH }, onChanged)

    await userEvent.click(screen.getByRole('button', { name: fr.admin.logoRemove }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(answered))
    expect(removeEventLogo).toHaveBeenCalledWith('camille-et-sacha')
    expect(await screen.findByText(fr.admin.logoRemoved)).toBeVisible()
  })

  it('names the server’s refusal in the host’s language and keeps the old logo', async () => {
    const putEventLogo = vi.fn(() => Promise.reject(new ApiError(400, 'image.unsupportedFormat')))
    const onChanged = vi.fn()
    renderField(fakeApi({ putEventLogo }), { logoUrl: URL_PATH }, onChanged)

    await userEvent.upload(screen.getByTestId('logo-input'), photo(), { applyAccept: false })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['image.unsupportedFormat'])
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: fr.admin.logoPreviewAlt })).toBeVisible()
  })

  it('draws no image for a URL that is not the shape the server mints', () => {
    renderField(fakeApi(), { logoUrl: 'https://evil.example/logo.png' })

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(fr.admin.logoChoose)).toBeVisible()
  })

  it('accepts PNG, JPEG and WebP only in the picker, and never an SVG', () => {
    renderField(fakeApi())

    expect(screen.getByTestId('logo-input')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp',
    )
  })

  it('names a refused removal too', async () => {
    renderField(fakeApi({ removeEventLogo: vi.fn(() => Promise.reject(ApiError.network())) }), {
      logoUrl: URL_PATH,
    })

    await userEvent.click(screen.getByRole('button', { name: fr.admin.logoRemove }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
  })

  it('clears an earlier refusal when the next attempt starts', async () => {
    const putEventLogo = vi
      .fn<Api['putEventLogo']>()
      .mockRejectedValueOnce(new ApiError(400, 'image.corrupt'))
      .mockResolvedValueOnce(withLogo())
    renderField(fakeApi({ putEventLogo }))
    const input = screen.getByTestId('logo-input')

    await userEvent.upload(input, photo())
    expect(await screen.findByRole('alert')).toBeVisible()
    await userEvent.upload(input, photo())

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('says it is working while the file travels, in a live region that is always there', async () => {
    let release: (event: EventDto) => void = () => {}
    const putEventLogo = vi.fn(
      () =>
        new Promise<EventDto>((resolve) => {
          release = resolve
        }),
    )
    renderField(fakeApi({ putEventLogo }))
    expect(screen.getByRole('status')).toHaveTextContent('')

    await userEvent.upload(screen.getByTestId('logo-input'), photo())

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.logoBusy)
    expect(screen.getByTestId('logo-input')).toBeDisabled()
    release(withLogo())
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''))
  })

  it('closes both controls for a moderator or an archived event', () => {
    renderField(fakeApi(), { logoUrl: URL_PATH, disabled: true })

    expect(screen.getByTestId('logo-input')).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.admin.logoRemove })).toBeDisabled()
  })
})
