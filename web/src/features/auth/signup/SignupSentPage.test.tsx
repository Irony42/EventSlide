import { describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignupSentPage } from './SignupSentPage'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'

const Start = () => <a href="/signup/sent">x</a>

/** The tables write a no-break space before a colon or a question mark; the DOM query folds it. */
const plain = (text: string) => text.replace(/[^\S ]/g, ' ')

describe('SignupSentPage', () => {
  it('says to check the inbox, with the 24 h validity, for a visit with no state', () => {
    renderWithProviders(<SignupSentPage />, { route: '/signup/sent' })

    expect(screen.getByRole('heading', { name: fr.signup.sentTitle })).toBeVisible()
    expect(screen.getByText(plain(fr.signup.sent))).toBeVisible()
    expect(screen.queryByText(fr.signup.busy)).toBeNull()
  })

  it('offers the way back to the sign-in page', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/signup/sent" element={<SignupSentPage />} />
        <Route path="/login" element={<p>Connexion</p>} />
        <Route path="/" element={<Start />} />
      </Routes>,
      { route: '/signup/sent' },
    )
    await userEvent.click(screen.getByRole('link', { name: fr.auth.backToLogin }))

    expect(await screen.findByText('Connexion')).toBeVisible()
  })
})
