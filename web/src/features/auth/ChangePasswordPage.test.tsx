import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { ChangePasswordPage } from './ChangePasswordPage'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'

const DASHBOARD = 'Tableau de bord'

const renderPage = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/admin/password" element={<ChangePasswordPage />} />
      <Route path="/admin" element={<p>{DASHBOARD}</p>} />
    </Routes>,
    { api, route: '/admin/password' },
  )

const fill = async (values: { current?: string; next: string; confirmation: string }) => {
  if (values.current !== undefined) {
    await userEvent.type(screen.getByLabelText(fr.auth.currentPassword), values.current)
  }
  await userEvent.type(screen.getByLabelText(fr.auth.newPassword), values.next)
  await userEvent.type(screen.getByLabelText(fr.auth.confirmPassword), values.confirmation)
  await userEvent.click(screen.getByRole('button', { name: fr.app.save }))
}

describe('ChangePasswordPage', () => {
  it('states the minimum length before the host types', () => {
    renderPage(fakeApi())

    expect(screen.getByText(fr.auth.newPasswordHint(PASSWORD_MIN_LENGTH))).toBeVisible()
  })

  it('sends the change and confirms it', async () => {
    const api = fakeApi()

    renderPage(api)
    await fill({
      current: 'le-mot-de-passe-actuel',
      next: 'une-phrase-de-passe-solide',
      confirmation: 'une-phrase-de-passe-solide',
    })

    expect(api.changePassword).toHaveBeenCalledWith(
      'le-mot-de-passe-actuel',
      'une-phrase-de-passe-solide',
    )
    expect(await screen.findByText(fr.auth.passwordSaved)).toBeVisible()
    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('catches two boxes that disagree without asking the server', async () => {
    const api = fakeApi()

    renderPage(api)
    await fill({
      current: 'le-mot-de-passe-actuel',
      next: 'une-phrase-de-passe-solide',
      confirmation: 'une-phrase-de-passe-solidee',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['password.mismatch'])
    expect(api.changePassword).not.toHaveBeenCalled()
    expect(screen.getByLabelText(fr.auth.confirmPassword)).toHaveAttribute('aria-invalid', 'true')
  })

  it('drops the mismatch as soon as the host starts correcting it', async () => {
    renderPage(fakeApi())
    await fill({
      current: 'le-mot-de-passe-actuel',
      next: 'une-phrase-de-passe-solide',
      confirmation: 'faute',
    })
    expect(await screen.findByRole('alert')).toBeVisible()

    await userEvent.type(screen.getByLabelText(fr.auth.confirmPassword), 'x')

    // An error that stays put while the value changes reads as a screen that has
    // stopped responding.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces the server’s own verdict on the new password', async () => {
    const api = fakeApi({
      changePassword: vi.fn(() => Promise.reject(new ApiError(400, 'password.tooCommon'))),
    })

    renderPage(api)
    await fill({ current: 'actuel', next: 'motdepasse123', confirmation: 'motdepasse123' })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['password.tooCommon'])
    expect(screen.queryByText(DASHBOARD)).toBeNull()
  })

  it('says the current password was wrong rather than silently failing', async () => {
    const api = fakeApi({
      changePassword: vi.fn(() => Promise.reject(new ApiError(401, 'auth.invalidCredentials'))),
    })

    renderPage(api)
    await fill({
      current: 'faux',
      next: 'une-phrase-de-passe-solide',
      confirmation: 'une-phrase-de-passe-solide',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.invalidCredentials'])
  })
})
