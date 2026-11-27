import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { SignupConfirmPage } from './SignupConfirmPage'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { anAbout, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { SignupMode } from '../../../lib/api/dto'

const TOKEN = 'T'.repeat(43)

const render = (api: Api, mode: SignupMode = 'open') =>
  renderWithProviders(
    <Routes>
      <Route path="/signup/confirm/:token" element={<SignupConfirmPage />} />
      <Route path="/signup" element={<p>Formulaire</p>} />
      <Route path="/login" element={<p>Connexion</p>} />
    </Routes>,
    {
      api: {
        ...api,
        about: vi.fn(async () =>
          anAbout({ features: { siteAdmin: false, forgotPassword: false, signup: mode } }),
        ),
      },
      route: `/signup/confirm/${TOKEN}`,
    },
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

  it('says the operator validates by hand when review is answered in review mode', async () => {
    const api = fakeApi({ confirmSignup: vi.fn(async () => ({ next: 'review' as const })) })
    render(api, 'review')
    await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))
    await press()

    expect(await screen.findByText(fr.signup.reviewDone)).toBeVisible()
  })

  it('says the account opens as soon as possible when review is answered in open mode (disk guard)', async () => {
    const api = fakeApi({ confirmSignup: vi.fn(async () => ({ next: 'review' as const })) })
    render(api, 'open')
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
      .mockRejectedValueOnce(new ApiError(404, 'feature.unavailable'))
      .mockResolvedValue({ state: 'usable', maskedEmail: 'l•••@example.org' })
    render(fakeApi({ signupPreview: preview }))
    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText(fr.signup.confirmIntro('l•••@example.org'))).toBeVisible()
  })
})
