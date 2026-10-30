import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { DeleteAccountPage } from './DeleteAccountPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'

const SIGN_IN = 'Page de connexion'

const renderPage = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/admin/account/delete" element={<DeleteAccountPage />} />
      <Route path="/login" element={<p>{SIGN_IN}</p>} />
      <Route path="/admin" element={<p>Tableau de bord</p>} />
    </Routes>,
    { api, route: '/admin/account/delete' },
  )

const confirm = async (password: string) => {
  await userEvent.type(screen.getByLabelText(fr.auth.password), password)
  await userEvent.click(screen.getByRole('button', { name: fr.auth.deleteAccountSubmit }))
}

describe('DeleteAccountPage', () => {
  it('says what goes and what stays before the password is asked', () => {
    renderPage(fakeApi())

    expect(screen.getByText(fr.auth.deleteAccountIntro)).toBeVisible()
  })

  it('sends the password, confirms, and leaves for the sign-in page', async () => {
    const api = fakeApi()

    renderPage(api)
    await confirm('le-mot-de-passe-actuel')

    expect(api.deleteOwnAccount).toHaveBeenCalledWith('le-mot-de-passe-actuel', undefined)
    expect(await screen.findByText(SIGN_IN)).toBeVisible()
  })

  it.each([
    ['account.holdsEvents', fr.auth.deleteAccountHoldsEvents],
    ['account.holdsMedia', fr.auth.deleteAccountHoldsMedia],
    ['account.holdsReviews', fr.auth.deleteAccountHoldsReviews],
    ['account.lastClientOwner', fr.auth.deleteAccountLastOwner],
  ])(
    'tells the person, in plain words and with a next step, why %s refuses, and stays',
    async (code, sentence) => {
      const api = fakeApi({
        deleteOwnAccount: vi.fn(() => Promise.reject(new ApiError(409, code))),
      })

      renderPage(api)
      await confirm('le-mot-de-passe-actuel')

      expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
      expect(sentence).toMatch(/opérateur/)
      expect(screen.queryByText(SIGN_IN)).toBeNull()
    },
  )

  it('sends the authenticator’s code with the password when one is typed', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.type(screen.getByLabelText(fr.auth.deleteAccountCode), ' 123456 ')
    await confirm('le-mot-de-passe-actuel')

    expect(api.deleteOwnAccount).toHaveBeenCalledWith('le-mot-de-passe-actuel', '123456')
  })

  it('says the code is missing or wrong in the server’s own sentence', async () => {
    const api = fakeApi({
      deleteOwnAccount: vi.fn(() => Promise.reject(new ApiError(401, 'auth.invalidSecondFactor'))),
    })

    renderPage(api)
    await confirm('le-mot-de-passe-actuel')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['auth.invalidSecondFactor'],
    )
  })

  it('words a wrong password as the password’s, not as a sign-in’s', async () => {
    const api = fakeApi({
      deleteOwnAccount: vi.fn(() => Promise.reject(new ApiError(401, 'auth.invalidCredentials'))),
    })

    renderPage(api)
    await confirm('pas-le-bon')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.passwordIncorrect)
  })

  it('goes back where the person came from on Annuler, deleting nothing', async () => {
    const api = fakeApi()

    renderPage(api)
    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.deleteOwnAccount).not.toHaveBeenCalled()
    expect(await screen.findByText('Tableau de bord')).toBeVisible()
  })
})
