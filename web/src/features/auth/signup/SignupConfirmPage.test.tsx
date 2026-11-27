import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { SignupConfirmPage } from './SignupConfirmPage'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import { de } from '../../../lib/i18n/de'
import type { Locale } from '../../../lib/i18n/locale'

const TOKEN = 'T'.repeat(43)

const render = (api: Api, route = `/signup/confirm/${TOKEN}`, locale?: Locale) =>
  renderWithProviders(
    <Routes>
      <Route path="/signup/confirm/:token" element={<SignupConfirmPage />} />
      <Route path="/signup" element={<p>Formulaire</p>} />
      <Route path="/login" element={<p>Connexion</p>} />
    </Routes>,
    { api, route, ...(locale === undefined ? {} : { locale }) },
  )

const press = () => userEvent.click(screen.getByRole('button', { name: fr.signup.confirmSubmit }))

/** The tables write a no-break space before a colon or a question mark; the DOM query folds it. */
const plain = (text: string) => text.replace(/[^\S ]/g, ' ')

describe('SignupConfirmPage', () => {
  it('shows the masked address and writes nothing until the button is pressed', async () => {
    const api = fakeApi()
    render(api)

    expect(await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))).toBeVisible()
    expect(api.signupPreview).toHaveBeenCalledWith(TOKEN, expect.anything())
    expect(api.confirmSignup).not.toHaveBeenCalled()
  })

  it('says the account is open when the server answers mail', async () => {
    const api = fakeApi()
    render(api)
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByText(plain(fr.signup.mailDone))).toBeVisible()
    expect(api.confirmSignup).toHaveBeenCalledWith(TOKEN)
    expect(screen.queryByRole('button', { name: fr.signup.confirmSubmit })).toBeNull()
  })

  it('says the operator validates by hand when the server answers review', async () => {
    const api = fakeApi({ confirmSignup: vi.fn(async () => ({ next: 'review' as const })) })
    render(api)
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByText(fr.signup.reviewDone)).toBeVisible()
  })

  it('says the account opens as soon as possible when the server answers held (disk guard)', async () => {
    const api = fakeApi({ confirmSignup: vi.fn(async () => ({ next: 'held' as const })) })
    render(api)
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByText(fr.signup.pendingDone)).toBeVisible()
    expect(screen.queryByText(fr.signup.reviewDone)).toBeNull()
  })

  it('says so when the link was already spent, with no button', async () => {
    render(
      fakeApi({
        signupPreview: vi.fn(async () => ({ state: 'spent' as const, maskedEmail: 'x' })),
      }),
    )

    expect(await screen.findByText(plain(fr.signup.spent))).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.signup.confirmSubmit })).toBeNull()
  })

  it('offers to start again when the link expired', async () => {
    render(
      fakeApi({
        signupPreview: vi.fn(async () => ({ state: 'expired' as const, maskedEmail: 'x' })),
      }),
    )
    await userEvent.click(await screen.findByRole('link', { name: fr.signup.restart }))

    expect(await screen.findByText('Formulaire')).toBeVisible()
  })

  it('keeps the button and says why when the press fails', async () => {
    const api = fakeApi({
      confirmSignup: vi.fn(async () => {
        throw new ApiError(500, 'internal')
      }),
    })
    render(api)
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByRole('alert')).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: fr.signup.confirmSubmit })).toBeEnabled(),
    )
  })

  it('offers a retry when the link could not be read', async () => {
    const preview = vi
      .fn()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue({ state: 'usable', maskedEmail: 'l•••@example.org' })
    render(fakeApi({ signupPreview: preview }))
    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))).toBeVisible()
  })

  it('answers a 404 feature.unavailable on the preview with the unavailable sentence', async () => {
    render(
      fakeApi({
        signupPreview: vi.fn(async () => {
          throw new ApiError(404, 'feature.unavailable')
        }),
      }),
    )

    expect(await screen.findByText(fr.signup.unavailable)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.signup.confirmSubmit })).toBeNull()
  })

  it('answers a 404 feature.unavailable on the press with the unavailable sentence', async () => {
    render(
      fakeApi({
        confirmSignup: vi.fn(async () => {
          throw new ApiError(404, 'feature.unavailable')
        }),
      }),
    )
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.signup.unavailable)
  })

  it('re-reads the link after a failed press and shows what it has become', async () => {
    const preview = vi
      .fn()
      .mockResolvedValueOnce({ state: 'usable', maskedEmail: 'l•••@example.org' })
      .mockResolvedValue({ state: 'spent', maskedEmail: 'l•••@example.org' })
    const api = fakeApi({
      signupPreview: preview,
      confirmSignup: vi.fn(async () => {
        throw new ApiError(404, 'signup.notFound')
      }),
    })
    render(api)
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByText(plain(fr.signup.spent))).toBeVisible()
    expect(preview).toHaveBeenCalledTimes(2)
  })

  it('opens in the language the mail link asks for', async () => {
    render(fakeApi(), `/signup/confirm/${TOKEN}?lang=de`)

    expect(await screen.findByRole('button', { name: de.signup.confirmSubmit })).toBeVisible()
  })

  it('replaces a stored language with the one in the address', async () => {
    render(fakeApi(), `/signup/confirm/${TOKEN}?lang=en`, 'de')

    expect(await screen.findByRole('button', { name: 'Confirm my address' })).toBeVisible()
  })
})
