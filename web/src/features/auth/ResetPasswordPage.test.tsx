import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { ResetPasswordPage } from './ResetPasswordPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'

/** A token-shaped value, so a leak of it is something a test can search for. */
const TOKEN = 'k3Rm-9XvQeL0aTz7HnYw2CdUfS5bJiGp8oVxNt1AyE4'

const NEW_PASSWORD = 'une-nouvelle-phrase-de-passe'

const renderReset = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/password/reset/:token" element={<ResetPasswordPage />} />
      <Route path="/password/forgot" element={<p>Mot de passe oublié</p>} />
      <Route path="/login" element={<p>Connexion</p>} />
    </Routes>,
    { api, route: `/password/reset/${TOKEN}` },
  )

const choose = async (password = NEW_PASSWORD, confirmation = NEW_PASSWORD) => {
  await userEvent.type(screen.getByLabelText(fr.auth.newPassword), password)
  await userEvent.type(screen.getByLabelText(fr.auth.confirmPassword), confirmation)
  await userEvent.click(screen.getByRole('button', { name: fr.auth.resetSubmit }))
}

describe('ResetPasswordPage', () => {
  it('sends the token from the address and the password chosen, and nothing else', async () => {
    const api = fakeApi()
    renderReset(api)

    await choose()

    await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledWith(TOKEN, NEW_PASSWORD))
    expect(api.confirmPasswordReset).toHaveBeenCalledTimes(1)
  })

  it('says the sessions are closed and offers the sign-in, without signing anybody in', async () => {
    const api = fakeApi()
    renderReset(api)

    await choose()

    expect(await screen.findByRole('heading', { name: fr.auth.resetDoneTitle })).toHaveFocus()
    expect(screen.getByText(fr.auth.resetDone)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.auth.submit })).toHaveAttribute('href', '/login')
    // The link may have been read by somebody who was not at the keyboard: no session starts.
    expect(api.login).not.toHaveBeenCalled()
    expect(api.session).not.toHaveBeenCalled()
  })

  it('says one thing for a link that opens nothing, and offers to ask for another', async () => {
    const api = fakeApi({
      confirmPasswordReset: vi.fn(() => Promise.reject(new ApiError(400, 'auth.invalidToken'))),
    })
    renderReset(api)

    await choose()

    expect(await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })).toHaveFocus()
    expect(screen.getByText(fr.errors['auth.invalidToken'])).toBeVisible()
    expect(screen.getByRole('link', { name: fr.auth.resetAskAgain })).toHaveAttribute(
      'href',
      '/password/forgot',
    )
    expect(screen.queryByLabelText(fr.auth.newPassword)).toBeNull()
  })

  it('keeps the form, and what was typed, when the policy refuses the password', async () => {
    const confirm = vi
      .fn<Api['confirmPasswordReset']>()
      .mockRejectedValueOnce(new ApiError(400, 'password.tooCommon'))
      .mockResolvedValueOnce(undefined)
    renderReset(fakeApi({ confirmPasswordReset: confirm }))

    await choose('password1234', 'password1234')

    // Not a dead link: the server does not spend the link on a refusal, so the same form is
    // the right answer and sending the person to ask for a new mail would be a wrong one.
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['password.tooCommon'])
    expect(screen.getByLabelText(fr.auth.newPassword)).toHaveValue('password1234')
    expect(screen.queryByRole('heading', { name: fr.auth.deadLinkTitle })).toBeNull()

    await userEvent.clear(screen.getByLabelText(fr.auth.newPassword))
    await userEvent.clear(screen.getByLabelText(fr.auth.confirmPassword))
    await choose()

    expect(await screen.findByRole('heading', { name: fr.auth.resetDoneTitle })).toBeVisible()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('sends nothing for an empty password, and says so on the box', async () => {
    // The server's schema refuses an empty string with the generic request.invalid; the policy
    // that has a sentence for it never sees it.
    const api = fakeApi()
    renderReset(api)

    await userEvent.click(screen.getByRole('button', { name: fr.auth.resetSubmit }))

    expect(await screen.findByText(fr.errors['password.tooShort'])).toBeVisible()
    expect(api.confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('does not take the keyboard when it opens: a form that is simply the page navigated to', async () => {
    renderReset(fakeApi())

    expect(screen.getByRole('heading', { name: fr.auth.resetTitle })).not.toHaveFocus()
  })

  it('sends nothing when the two passwords disagree', async () => {
    const api = fakeApi()
    renderReset(api)

    await choose(NEW_PASSWORD, `${NEW_PASSWORD}-oups`)

    expect(await screen.findByText(fr.errors['password.mismatch'])).toBeVisible()
    expect(api.confirmPasswordReset).not.toHaveBeenCalled()
  })

  it.each([
    ['a dropped connection', ApiError.network(), fr.errors.network],
    ['a rate limit', new ApiError(429, 'rate.limited'), fr.errors['rate.limited']],
    ['a server error', new ApiError(500, 'unknown'), fr.errors.unknown],
  ])('says what happened after %s, and keeps the form', async (_name, failure, sentence) => {
    const api = fakeApi({ confirmPasswordReset: vi.fn(() => Promise.reject(failure)) })
    renderReset(api)

    await choose()

    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(screen.getByLabelText(fr.auth.newPassword)).toHaveValue(NEW_PASSWORD)
    expect(screen.queryByRole('heading', { name: fr.auth.deadLinkTitle })).toBeNull()
  })

  it('labels both fields as new passwords, so a manager offers to save rather than to fill', async () => {
    renderReset(fakeApi())

    for (const label of [fr.auth.newPassword, fr.auth.confirmPassword]) {
      const field = screen.getByLabelText(label)
      expect(field).toHaveAttribute('type', 'password')
      expect(field).toHaveAttribute('autocomplete', 'new-password')
    }
  })

  it('can be submitted from the keyboard', async () => {
    const api = fakeApi()
    renderReset(api)

    await userEvent.type(screen.getByLabelText(fr.auth.newPassword), NEW_PASSWORD)
    await userEvent.type(screen.getByLabelText(fr.auth.confirmPassword), `${NEW_PASSWORD}{Enter}`)

    await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledTimes(1))
  })

  it('keeps the token out of the title, out of storage and off every screen', async () => {
    const titleBefore = document.title
    const api = fakeApi({
      confirmPasswordReset: vi.fn(() => Promise.reject(new ApiError(400, 'auth.invalidToken'))),
    })
    renderReset(api)

    expect(document.body.textContent).not.toContain(TOKEN)
    await choose()
    await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })

    expect(document.title).toBe(titleBefore)
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN)
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN)
  })
})
