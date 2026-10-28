import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ChangePasswordPage } from './ChangePasswordPage'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { SessionResponse } from '../../lib/api/dto'

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

  it('replaces the server’s verdict with the mismatch it finds on the next attempt', async () => {
    // The server called the first password too common; the host types another one but
    // mistypes its confirmation. Two sentences side by side, one of them about a password
    // that is no longer in the box, say two things are wrong when one is.
    const api = fakeApi({
      changePassword: vi.fn(() => Promise.reject(new ApiError(400, 'password.tooCommon'))),
    })
    renderPage(api)
    await fill({ current: 'actuel', next: 'motdepasse123', confirmation: 'motdepasse123' })
    expect(await screen.findByText(fr.errors['password.tooCommon'])).toBeVisible()

    await userEvent.clear(screen.getByLabelText(fr.auth.newPassword))
    await userEvent.type(screen.getByLabelText(fr.auth.newPassword), 'une-phrase-de-passe-solide')
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(await screen.findByText(fr.errors['password.mismatch'])).toBeVisible()
    expect(screen.queryByText(fr.errors['password.tooCommon'])).toBeNull()
    expect(api.changePassword).toHaveBeenCalledTimes(1)
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

    const alert = await screen.findByRole('alert')
    // A form with no address field: the sentence must not talk about one.
    expect(alert).toHaveTextContent(fr.auth.passwordIncorrect)
    expect(alert).not.toHaveTextContent(fr.errors['auth.invalidCredentials'])
  })
})

/**
 * Navigation pass, batch D (H14, H15): the change returns to where the person was going, says why
 * when it was forced, and can be cancelled when it was not.
 */
describe('ChangePasswordPage: coming and going (H14)', () => {
  const MODERATION = 'Console de modération'
  const PASSWORD = { current: 'le-mot-de-passe-actuel', next: 'une-phrase-de-passe-solide' }

  /** The page entered with a `from` in its state, as the gate and the account menu enter it. */
  const enter = (api: Api, state: unknown) =>
    renderWithProviders(
      <Routes>
        <Route path="/depart" element={<Navigate to="/admin/password" replace state={state} />} />
        <Route path="/admin/password" element={<ChangePasswordPage />} />
        <Route path="/admin" element={<p>{DASHBOARD}</p>} />
        <Route path="/admin/events/mariage/moderation" element={<p>{MODERATION}</p>} />
      </Routes>,
      { api, route: '/depart' },
    )

  const asUser = (mustChangePassword: boolean, overrides: Partial<Api> = {}) =>
    fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser({ mustChangePassword }),
      })),
      ...overrides,
    })

  const change = () =>
    fill({ current: PASSWORD.current, next: PASSWORD.next, confirmation: PASSWORD.next })

  it.each([
    ['forced', true],
    ['voluntary', false],
  ])('returns to the page the person was going to after a %s change', async (_name, forced) => {
    enter(asUser(forced), { from: '/admin/events/mariage/moderation' })
    await screen.findByLabelText(fr.auth.currentPassword)

    await change()

    expect(await screen.findByText(MODERATION)).toBeVisible()
  })

  it('lands them on the dashboard, as before, when nobody said where they were going', async () => {
    enter(asUser(false), undefined)
    await screen.findByLabelText(fr.auth.currentPassword)

    await change()

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('says why, in forced mode, and offers no way to cancel', async () => {
    enter(asUser(true), { from: '/admin/events/mariage/moderation' })

    expect(await screen.findByText(new RegExp(fr.auth.changePasswordForced))).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.app.cancel })).toBeNull()
  })

  it('offers a way to cancel, and no explanation, when the person came by choice', async () => {
    enter(asUser(false), { from: '/admin/events/mariage/moderation' })
    await screen.findByLabelText(fr.auth.currentPassword)

    expect(screen.queryByText(new RegExp(fr.auth.changePasswordForced))).toBeNull()
    expect(screen.getByRole('button', { name: fr.app.cancel })).toBeVisible()
  })

  it('takes the person back to where they were when they cancel, and changes nothing', async () => {
    const api = asUser(false)
    enter(api, { from: '/admin/events/mariage/moderation' })
    await userEvent.click(await screen.findByRole('button', { name: fr.app.cancel }))

    expect(await screen.findByText(MODERATION)).toBeVisible()
    expect(api.changePassword).not.toHaveBeenCalled()
  })

  it('takes them to the dashboard when they cancel and there is no page to go back to', async () => {
    enter(asUser(false), undefined)
    await userEvent.click(await screen.findByRole('button', { name: fr.app.cancel }))

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('keeps saying why once the change is made, while the page is still on screen', async () => {
    // Choosing the password makes the session forget itself, which is what turns "forced" off. The
    // sentence goes with the page and not a moment before: here the landing never arrives.
    let session: SessionResponse = {
      authenticated: true,
      user: aSessionUser({ mustChangePassword: true }),
    }
    const api = fakeApi({
      session: vi.fn(async () => session),
      changePassword: vi.fn(async () => {
        session = { authenticated: true, user: aSessionUser({ mustChangePassword: false }) }
      }),
      listEvents: vi.fn(() => new Promise<never>(() => undefined)),
    })
    enter(api, undefined)
    await screen.findByText(new RegExp(fr.auth.changePasswordForced))

    await change()

    await waitFor(() => expect(api.listEvents).toHaveBeenCalled())
    expect(screen.getByText(new RegExp(fr.auth.changePasswordForced))).toBeVisible()
  })
})
