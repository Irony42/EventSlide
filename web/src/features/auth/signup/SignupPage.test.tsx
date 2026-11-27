import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { SignupPage } from './SignupPage'
import { SignupSentPage } from './SignupSentPage'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { de } from '../../../lib/i18n/de'
import { anAbout, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { AboutLinks, SignupMode } from '../../../lib/api/dto'

const withMode = (api: Api, signup: SignupMode, links: AboutLinks): Api => ({
  ...api,
  about: vi.fn(async () =>
    anAbout({ features: { siteAdmin: false, forgotPassword: false, signup }, links }),
  ),
})

const renderSignup = (
  api: Api,
  route = '/signup',
  mode: SignupMode = 'open',
  links: AboutLinks = {},
) =>
  renderWithProviders(
    <Routes>
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/sent" element={<SignupSentPage />} />
      <Route path="/login" element={<p>Connexion</p>} />
    </Routes>,
    { api: withMode(api, mode, links), route },
  )

const fill = async () => {
  await userEvent.type(screen.getByLabelText(fr.auth.email), ' lea@example.org ')
  await userEvent.type(screen.getByLabelText(new RegExp(fr.signup.clientName)), 'Mariage de Léa')
}
const submit = () => userEvent.click(screen.getByRole('button', { name: fr.signup.submit }))

/** The tables write a no-break space before a colon or a question mark; the DOM query folds it. */
const plain = (text: string) => text.replace(/[^\S ]/g, ' ')

describe('SignupPage', () => {
  it('sends the trimmed form with the page language and an empty trap, then shows the sent screen', async () => {
    const api = fakeApi()
    renderSignup(api)
    await fill()
    await submit()

    await waitFor(() =>
      expect(api.requestSignup).toHaveBeenCalledWith({
        email: 'lea@example.org',
        clientName: 'Mariage de Léa',
        locale: 'fr',
        website: '',
      }),
    )
    expect(await screen.findByText(plain(fr.signup.sent))).toBeVisible()
  })

  it('sends the occasion and the date when they are given', async () => {
    const api = fakeApi()
    renderSignup(api)
    await fill()
    await userEvent.type(screen.getByLabelText(new RegExp(fr.signup.note)), 'Quarante invités')
    await userEvent.type(screen.getByLabelText(new RegExp(fr.signup.eventDate)), '2027-06-12')
    await submit()

    await waitFor(() =>
      expect(api.requestSignup).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'Quarante invités', eventDate: '2027-06-12' }),
      ),
    )
  })

  it('shows the busy variant when the day is full', async () => {
    const api = fakeApi({ requestSignup: vi.fn(async () => ({ status: 'busy' as const })) })
    renderSignup(api)
    await fill()
    await submit()

    expect(await screen.findByText(fr.signup.busy)).toBeVisible()
  })

  it('does not send a malformed address or a missing name', async () => {
    const api = fakeApi()
    renderSignup(api)
    await userEvent.type(screen.getByLabelText(fr.auth.email), 'lea.example.org')
    await submit()

    expect(await screen.findByText(fr.errors['email.malformed'])).toBeVisible()
    expect(screen.getByText(fr.signup.clientNameMissing)).toBeVisible()
    expect(api.requestSignup).not.toHaveBeenCalled()
  })

  it('hides the trap from people and assistive technology, and sends what a bot put in it', async () => {
    const api = fakeApi()
    renderSignup(api)
    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')
    expect(trap).not.toBeNull()
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(trap?.tabIndex).toBe(-1)
    expect(screen.queryByRole('textbox', { name: /website/i })).toBeNull()

    await fill()
    await userEvent.type(trap as HTMLInputElement, 'http://spam.example')
    await submit()
    await waitFor(() =>
      expect(api.requestSignup).toHaveBeenCalledWith(
        expect.objectContaining({ website: 'http://spam.example' }),
      ),
    )
  })

  it('shows the notice with the 60-day sentence and the privacy link the box has', async () => {
    renderSignup(fakeApi(), '/signup', 'open', { privacy: 'https://example.org/privacy' })

    expect(screen.getByText(/60 jours/)).toBeVisible()
    expect(
      await screen.findByRole('link', { name: new RegExp(fr.about.privacyLink) }),
    ).toHaveAttribute('href', 'https://example.org/privacy')
  })

  it('tells people not to write anything sensitive in the occasion box', () => {
    renderSignup(fakeApi())

    expect(screen.getByLabelText(new RegExp(fr.signup.note))).toHaveAccessibleDescription(
      expect.stringContaining('rien de sensible'),
    )
  })

  it('has no privacy link on a box that has none', () => {
    renderSignup(fakeApi())

    expect(screen.queryByRole('link', { name: new RegExp(fr.about.privacyLink) })).toBeNull()
  })

  it('opens in the language asked by ?lang= and sends it', async () => {
    const api = fakeApi()
    renderSignup(api, '/signup?lang=de')

    expect(await screen.findByLabelText(new RegExp(de.signup.clientName))).toBeVisible()
    await userEvent.type(screen.getByLabelText(de.auth.email), 'lea@example.org')
    await userEvent.type(screen.getByLabelText(new RegExp(de.signup.clientName)), 'Hochzeit')
    await userEvent.click(screen.getByRole('button', { name: de.signup.submit }))
    await waitFor(() =>
      expect(api.requestSignup).toHaveBeenCalledWith(expect.objectContaining({ locale: 'de' })),
    )
  })

  it('ignores an unknown ?lang=', () => {
    renderSignup(fakeApi(), '/signup?lang=xx')

    expect(screen.getByLabelText(new RegExp(fr.signup.clientName))).toBeVisible()
  })

  it('says signup is not open on a box that has said it is off, with no form', async () => {
    renderSignup(fakeApi(), '/signup', 'off')

    expect(await screen.findByText(fr.signup.unavailable)).toBeVisible()
    expect(screen.queryByLabelText(new RegExp(fr.signup.clientName))).toBeNull()
  })

  it('answers a 404 feature.unavailable in a sentence of its own and stays on the form', async () => {
    const api = fakeApi({
      requestSignup: vi.fn(async () => {
        throw new ApiError(404, 'feature.unavailable')
      }),
    })
    renderSignup(api)
    await fill()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.signup.unavailable)
  })
})
