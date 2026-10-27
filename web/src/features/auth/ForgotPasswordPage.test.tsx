import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
import { fr } from '../../lib/i18n/fr'
import { anAbout, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { Locale } from '../../lib/i18n/locale'

/** A box that can send mail, which is where this form means anything. */
const withMail = (api: Api): Api => ({
  ...api,
  about: vi.fn(async () => anAbout({ features: { siteAdmin: false, forgotPassword: true } })),
})

const renderForgot = (api: Api, locale?: Locale) =>
  renderWithProviders(
    <Routes>
      <Route path="/password/forgot" element={<ForgotPasswordPage />} />
      <Route path="/login" element={<p>Connexion</p>} />
    </Routes>,
    { api: withMail(api), route: '/password/forgot', ...(locale === undefined ? {} : { locale }) },
  )

const ask = async (address: string) => {
  await userEvent.type(screen.getByLabelText(fr.auth.email), address)
  await userEvent.click(screen.getByRole('button', { name: fr.auth.forgotSubmit }))
}

describe('ForgotPasswordPage on a box with no mail relay', () => {
  const renderWithoutMail = () => {
    const api = fakeApi({
      about: vi.fn(async () => anAbout({ features: { siteAdmin: false, forgotPassword: false } })),
    })
    renderWithProviders(
      <Routes>
        <Route path="/password/forgot" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<p>Connexion</p>} />
      </Routes>,
      { api, route: '/password/forgot' },
    )
    return api
  }

  it('says the reset is not available here, instead of offering a form that cannot work', async () => {
    const api = renderWithoutMail()

    expect(await screen.findByText(fr.auth.forgotUnavailable)).toBeVisible()
    expect(screen.queryByLabelText(fr.auth.email)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.auth.forgotSubmit })).toBeNull()
    expect(screen.getByRole('link', { name: fr.auth.backToLogin })).toBeVisible()
    expect(api.requestPasswordReset).not.toHaveBeenCalled()
  })
})

describe('ForgotPasswordPage before the box has said what it can do', () => {
  it('shows the form rather than a verdict drawn from the build’s own guess', async () => {
    // Until /api/about answers, the context holds a default that says no mail: acting on it would
    // turn every page load on a box that can send mail into "not available" for a moment.
    const api = fakeApi({ about: vi.fn(() => new Promise<never>(() => {})) })
    renderWithProviders(
      <Routes>
        <Route path="/password/forgot" element={<ForgotPasswordPage />} />
      </Routes>,
      { api, route: '/password/forgot' },
    )

    expect(screen.getByLabelText(fr.auth.email)).toBeVisible()
    expect(screen.queryByText(fr.auth.forgotUnavailable)).toBeNull()
  })
})

describe('ForgotPasswordPage when the box could not be asked', () => {
  it.each([
    ['the request fails', () => Promise.reject(new Error('offline'))],
    ['the answer is empty', () => Promise.resolve(null as never)],
  ])(
    'keeps the form when %s, since the build’s guess is not the box’s word',
    async (_name, about) => {
      const api = fakeApi({ about: vi.fn(about) })
      renderWithProviders(
        <Routes>
          <Route path="/password/forgot" element={<ForgotPasswordPage />} />
        </Routes>,
        { api, route: '/password/forgot' },
      )

      await waitFor(() => expect(api.about).toHaveBeenCalled())
      expect(await screen.findByLabelText(fr.auth.email)).toBeVisible()
      expect(screen.queryByText(fr.auth.forgotUnavailable)).toBeNull()
    },
  )
})

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

  it.each([
    ['no @ at all', 'camille.example.org'],
    ['a domain with no dot, which the server refuses too', 'camille@gmail'],
    ['a space inside', 'camille dupont@example.org'],
    ['two @', 'camille@@example.org'],
  ])('sends nothing for %s, and says so', async (_name, typed) => {
    // The server answers 202 for a string that cannot be an address, so without this the person
    // would be told to check an inbox that no relay was ever asked to write to.
    const api = fakeApi()
    renderForgot(api)

    await ask(typed)

    expect(await screen.findByText(fr.errors['email.malformed'])).toBeVisible()
    expect(api.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('does not take the keyboard when it opens: a form that is simply the page navigated to', async () => {
    renderForgot(fakeApi())

    expect(screen.getByRole('heading', { name: fr.auth.forgotTitle })).not.toHaveFocus()
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
