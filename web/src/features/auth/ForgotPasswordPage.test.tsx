import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { Locale } from '../../lib/i18n/locale'

const renderForgot = (api: Api, locale?: Locale) =>
  renderWithProviders(
    <Routes>
      <Route path="/password/forgot" element={<ForgotPasswordPage />} />
      <Route path="/login" element={<p>Connexion</p>} />
    </Routes>,
    { api, route: '/password/forgot', ...(locale === undefined ? {} : { locale }) },
  )

const ask = async (address: string) => {
  await userEvent.type(screen.getByLabelText(fr.auth.email), address)
  await userEvent.click(screen.getByRole('button', { name: fr.auth.forgotSubmit }))
}

describe('ForgotPasswordPage', () => {
  it('sends the address and the language of the page, which is the language of the mail', async () => {
    const api = fakeApi()
    renderForgot(api)

    await ask('camille@example.org')

    await waitFor(() =>
      expect(api.requestPasswordReset).toHaveBeenCalledWith('camille@example.org', 'fr'),
    )
  })

  it('writes the mail in the language the person is reading', async () => {
    const api = fakeApi()
    renderForgot(api, 'de')

    await userEvent.type(screen.getByLabelText(de.auth.email), 'camille@example.org')
    await userEvent.click(screen.getByRole('button', { name: de.auth.forgotSubmit }))

    await waitFor(() =>
      expect(api.requestPasswordReset).toHaveBeenCalledWith('camille@example.org', 'de'),
    )
  })

  it('answers every address with the same confirmation, and never repeats the address', async () => {
    // The server answers 202 for an account, a stranger and a switched-off account alike; the
    // page must not be where the difference appears. Two addresses, one markup.
    const first = renderForgot(fakeApi())
    await ask('connu@example.org')
    await screen.findByRole('heading', { name: fr.auth.forgotSentTitle })
    const known = first.container.innerHTML
    first.unmount()

    const second = renderForgot(fakeApi())
    await ask('inconnu@example.org')
    await screen.findByRole('heading', { name: fr.auth.forgotSentTitle })

    expect(second.container.innerHTML).toBe(known)
    expect(document.body.textContent).not.toContain('inconnu@example.org')
    expect(screen.getByText(fr.auth.forgotSent)).toBeVisible()
  })

  it('says "if an account uses this address", never that one does', async () => {
    renderForgot(fakeApi())

    await ask('camille@example.org')

    // The sentence is conditional by construction; the wording is the contract.
    expect(await screen.findByText(fr.auth.forgotSent)).toBeVisible()
    expect(fr.auth.forgotSent.startsWith('Si un compte')).toBe(true)
  })

  it('sends nothing for a string that cannot be an address, and says so', async () => {
    const api = fakeApi()
    renderForgot(api)

    await ask('camille.example.org')

    expect(await screen.findByText(fr.errors['email.malformed'])).toBeVisible()
    expect(api.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('says the box cannot send mail, in words, when the server says so', async () => {
    const api = fakeApi({
      requestPasswordReset: vi.fn(() => Promise.reject(new ApiError(404, 'feature.unavailable'))),
    })
    renderForgot(api)

    await ask('camille@example.org')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.forgotUnavailable)
    // The form stays: nothing was sent, and nothing claims it was.
    expect(screen.queryByRole('heading', { name: fr.auth.forgotSentTitle })).toBeNull()
  })

  it.each([
    ['a rate limit', new ApiError(429, 'rate.limited'), fr.errors['rate.limited']],
    ['a dropped connection', ApiError.network(), fr.errors.network],
  ])('keeps the form and says what happened after %s', async (_name, failure, sentence) => {
    const api = fakeApi({ requestPasswordReset: vi.fn(() => Promise.reject(failure)) })
    renderForgot(api)

    await ask('camille@example.org')

    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(screen.getByLabelText(fr.auth.email)).toHaveValue('camille@example.org')
    expect(screen.queryByRole('heading', { name: fr.auth.forgotSentTitle })).toBeNull()
  })

  it('moves the keyboard to the confirmation once it is on screen', async () => {
    renderForgot(fakeApi())

    await ask('camille@example.org')

    expect(await screen.findByRole('heading', { name: fr.auth.forgotSentTitle })).toHaveFocus()
  })

  it('labels the field, and can be sent from the keyboard', async () => {
    const api = fakeApi()
    renderForgot(api)

    const field = screen.getByLabelText(fr.auth.email)
    expect(field).toHaveAttribute('type', 'email')
    expect(field).toHaveAttribute('autocomplete', 'email')

    await userEvent.type(field, 'camille@example.org{Enter}')

    await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalledTimes(1))
  })

  it('leads back to the sign-in from the form and from the confirmation', async () => {
    renderForgot(fakeApi())
    expect(screen.getByRole('link', { name: fr.auth.backToLogin })).toHaveAttribute(
      'href',
      '/login',
    )

    await ask('camille@example.org')

    expect(await screen.findByRole('link', { name: fr.auth.backToLogin })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
