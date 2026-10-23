import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { AcceptInvitationPage } from './AcceptInvitationPage'
import { LanguagePicker } from '../../app/LanguagePicker'
import { formatDateTime } from '../../lib/format'
import { ApiError } from '../../lib/http'
import { de } from '../../lib/i18n/de'
import { fr } from '../../lib/i18n/fr'
import {
  anInvitationAccepted,
  anInvitationPreview,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { SessionResponse } from '../../lib/api/dto'
import type { Locale } from '../../lib/i18n/locale'

/** A token-shaped value, so a leak of it is something a test can search for. */
const TOKEN = 'Z7q-Mx0Ld3Tn9VbRk2YcHs8WfAe5GuJi4PoXz1NvB6E'

const CHOSEN_PASSWORD = 'une-phrase-de-passe-longue'

/** Shows what the router handed the sign-in page, so "back to this link" is observable. */
function LoginProbe() {
  const location = useLocation()
  return <p data-testid="login-state">{JSON.stringify(location.state)}</p>
}

/**
 * Real routes, so "went to the event" is asserted by what the person ends up looking at.
 * `/admin/events/:slug` carries the slug in its text, which is how a wrong destination shows.
 */
const renderInvitation = (api: Api, options: { readonly locale?: Locale } = {}) =>
  renderWithProviders(
    <Routes>
      <Route path="/invite/:token" element={<AcceptInvitationPage />} />
      <Route path="/admin" element={<p>Tableau de bord</p>} />
      <Route path="/admin/events/:slug" element={<EventStub />} />
      <Route path="/login" element={<LoginProbe />} />
    </Routes>,
    { api, route: `/invite/${TOKEN}`, ...options },
  )

function EventStub() {
  const { pathname } = useLocation()
  return <p>Évènement à {pathname}</p>
}

const signedInAs = (email: string): Partial<Api> => ({
  session: vi.fn(async (): Promise<SessionResponse> => ({
    authenticated: true,
    user: aSessionUser({ email }),
  })),
})

const fillIn = async (
  name = 'Camille',
  password = CHOSEN_PASSWORD,
  confirmation = CHOSEN_PASSWORD,
) => {
  const nameBox = await screen.findByLabelText(fr.auth.invitationName)
  // `type` refuses an empty string, and an empty box is a case worth driving.
  if (name !== '') await userEvent.type(nameBox, name)
  if (password !== '') await userEvent.type(screen.getByLabelText(fr.auth.password), password)
  if (confirmation !== '') {
    await userEvent.type(screen.getByLabelText(fr.auth.invitationConfirmPassword), confirmation)
  }
}

const submit = () => userEvent.click(screen.getByRole('button', { name: fr.auth.invitationSubmit }))

describe('AcceptInvitationPage: what the link says', () => {
  it('asks the server about the link it was opened with, and says what it is for', async () => {
    const api = fakeApi()

    renderInvitation(api)

    expect(
      await screen.findByText(fr.auth.invitationToModerate('Camille & Sacha'), { exact: false }),
    ).toBeVisible()
    expect(api.invitation).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal))
  })

  it('says when the link ends, in the reader’s own formatting', async () => {
    const preview = anInvitationPreview({ expiresAt: '2026-06-27T21:00:00.000Z' })
    renderInvitation(fakeApi({ invitation: vi.fn(async () => preview) }))

    const expiry = formatDateTime(preview.expiresAt, 'fr') ?? ''
    expect(await screen.findByText(new RegExp(fr.auth.invitationExpires(expiry)))).toBeVisible()
  })

  it.each([
    [
      'a client’s owner',
      anInvitationPreview({ kind: 'client', role: 'owner', targetName: 'Studio Lune' }),
      fr.auth.invitationToOwn('Studio Lune'),
    ],
    [
      'a client’s member',
      anInvitationPreview({ kind: 'client', role: 'member', targetName: 'Studio Lune' }),
      fr.auth.invitationToJoin('Studio Lune'),
    ],
  ])('says what an invitation for %s is for', async (_name, preview, sentence) => {
    renderInvitation(fakeApi({ invitation: vi.fn(async () => preview) }))

    expect(await screen.findByText(new RegExp(sentence))).toBeVisible()
  })

  it('prints the name of the event as written, whatever language the page is in', async () => {
    // An event's name is what a person typed, not interface: no table translates it.
    renderInvitation(fakeApi(), { locale: 'de' })

    expect(await screen.findByText(/„Camille & Sacha“/)).toBeVisible()
    expect(screen.getByRole('heading', { name: de.auth.invitationTitle })).toBeVisible()
  })

  it('does not say whether the address already has an account, but offers both ways in', async () => {
    renderInvitation(fakeApi())

    // The preview carries nothing about the address, so the page cannot take a side: it shows
    // the form for making an account and the way in for somebody who already has one.
    expect(await screen.findByLabelText(fr.auth.invitationName)).toBeVisible()
    expect(screen.getByText(fr.auth.invitationHaveAccount)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.auth.submit })).toBeVisible()
  })
})

describe('AcceptInvitationPage: creating the account', () => {
  it('sends the name and the password chosen, and lands the person on the event', async () => {
    const api = fakeApi()
    renderInvitation(api)

    await fillIn('Camille')
    await submit()

    await waitFor(() =>
      expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, {
        kind: 'newAccount',
        displayName: 'Camille',
        password: CHOSEN_PASSWORD,
      }),
    )
    expect(await screen.findByText(/Évènement à \/admin\/events\/camille-et-sacha/)).toBeVisible()
  })

  it('opens the console, not an event, for a client’s invitation', async () => {
    const api = fakeApi({
      invitation: vi.fn(async () =>
        anInvitationPreview({ kind: 'client', role: 'owner', targetName: 'Studio Lune' }),
      ),
      acceptInvitation: vi.fn(async () =>
        anInvitationAccepted({ kind: 'client', role: 'owner', eventSlug: null }),
      ),
    })
    renderInvitation(api)

    await fillIn()
    await submit()

    expect(await screen.findByText('Tableau de bord')).toBeVisible()
  })

  it('sends nothing when the two passwords disagree, and says so on the second box', async () => {
    const api = fakeApi()
    renderInvitation(api)

    await fillIn('Camille', CHOSEN_PASSWORD, `${CHOSEN_PASSWORD}-oups`)
    await submit()

    expect(await screen.findByText(fr.errors['password.mismatch'])).toBeVisible()
    expect(api.acceptInvitation).not.toHaveBeenCalled()
  })

  it('clears the mismatch as soon as the second box is touched', async () => {
    renderInvitation(fakeApi())
    await fillIn('Camille', CHOSEN_PASSWORD, 'autre')
    await submit()
    await screen.findByText(fr.errors['password.mismatch'])

    await userEvent.type(screen.getByLabelText(fr.auth.invitationConfirmPassword), 'x')

    expect(screen.queryByText(fr.errors['password.mismatch'])).toBeNull()
  })

  it('keeps everything that was typed when the server refuses the password, and the link still works', async () => {
    const accept = vi
      .fn<Api['acceptInvitation']>()
      .mockRejectedValueOnce(new ApiError(400, 'password.tooCommon'))
      .mockResolvedValueOnce(anInvitationAccepted())
    const api = fakeApi({ acceptInvitation: accept })
    renderInvitation(api)

    await fillIn('Camille', 'password1234', 'password1234')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['password.tooCommon'])
    expect(screen.getByLabelText(fr.auth.invitationName)).toHaveValue('Camille')
    expect(screen.getByLabelText(fr.auth.password)).toHaveValue('password1234')

    // A refusal spends nothing server-side, so the page offers the same form, not a dead end.
    await userEvent.clear(screen.getByLabelText(fr.auth.password))
    await userEvent.clear(screen.getByLabelText(fr.auth.invitationConfirmPassword))
    await userEvent.type(screen.getByLabelText(fr.auth.password), CHOSEN_PASSWORD)
    await userEvent.type(screen.getByLabelText(fr.auth.invitationConfirmPassword), CHOSEN_PASSWORD)
    await submit()

    expect(await screen.findByText(/Évènement à/)).toBeVisible()
    expect(accept).toHaveBeenCalledTimes(2)
  })

  it('says what is wrong with a name the server refuses, in words and not as an unknown error', async () => {
    const api = fakeApi({
      acceptInvitation: vi.fn(() => Promise.reject(new ApiError(400, 'accountName.tooLong'))),
    })
    renderInvitation(api)

    await fillIn('Camille', CHOSEN_PASSWORD, CHOSEN_PASSWORD)
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['accountName.tooLong'])
    expect(fr.errors['accountName.tooLong']).not.toBe(fr.errors.unknown)
  })

  it.each([
    ['an empty name', ['', CHOSEN_PASSWORD, CHOSEN_PASSWORD], fr.errors['accountName.empty']],
    ['a name of spaces', ['   ', CHOSEN_PASSWORD, CHOSEN_PASSWORD], fr.errors['accountName.empty']],
    ['an empty password', ['Camille', '', ''], fr.errors['password.tooShort']],
  ] as const)(
    'does not send %s, and says which box is empty',
    async (_name, [name, password, confirmation], sentence) => {
      // The server's schema refuses an empty string with the generic `request.invalid`, before
      // the rules that have a sentence of their own: the page says which box instead.
      const api = fakeApi()
      renderInvitation(api)

      await fillIn(name, password, confirmation)
      await submit()

      expect(await screen.findByText(sentence)).toBeVisible()
      expect(api.acceptInvitation).not.toHaveBeenCalled()
    },
  )

  it('takes the empty-box message away as soon as the box is touched', async () => {
    renderInvitation(fakeApi())
    await fillIn('', CHOSEN_PASSWORD, CHOSEN_PASSWORD)
    await submit()
    await screen.findByText(fr.errors['accountName.empty'])

    await userEvent.type(screen.getByLabelText(fr.auth.invitationName), 'C')

    expect(screen.queryByText(fr.errors['accountName.empty'])).toBeNull()
  })

  it('says what to do when the venue network dropped, and keeps the form', async () => {
    const api = fakeApi({ acceptInvitation: vi.fn(() => Promise.reject(ApiError.network())) })
    renderInvitation(api)

    await fillIn()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.getByLabelText(fr.auth.password)).toHaveValue(CHOSEN_PASSWORD)
  })

  it('says it is too many attempts for a rate-limited acceptance, and keeps the form', async () => {
    const api = fakeApi({
      acceptInvitation: vi.fn(() => Promise.reject(new ApiError(429, 'rate.limited'))),
    })
    renderInvitation(api)

    await fillIn()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rate.limited'])
  })
})

describe('AcceptInvitationPage: an address that already has an account', () => {
  const signInRequired = () =>
    fakeApi({
      acceptInvitation: vi.fn(() => Promise.reject(new ApiError(409, 'invitation.signInRequired'))),
    })

  it('tells the person to sign in with that account and come back, and creates nothing', async () => {
    renderInvitation(signInRequired())

    await fillIn()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['invitation.signInRequired'],
    )
    expect(screen.queryByText(/Évènement à/)).toBeNull()
  })

  it('sends the sign-in page back to this very link afterwards', async () => {
    renderInvitation(signInRequired())

    await userEvent.click(await screen.findByRole('link', { name: fr.auth.submit }))

    // `LoginPage` reads `from` out of the navigation state and returns there; the token is in
    // history state, never in a query string of the sign-in page.
    expect(JSON.parse((await screen.findByTestId('login-state')).textContent ?? '')).toEqual({
      from: `/invite/${TOKEN}`,
    })
  })

  it('accepts as the account the person signed in with, sending no password at all', async () => {
    const api = fakeApi(signedInAs('camille@example.org'))
    renderInvitation(api)

    expect(
      await screen.findByText(fr.auth.invitationSignedInAs('camille@example.org')),
    ).toBeVisible()
    // Nothing to choose: the session is what names the account.
    expect(screen.queryByLabelText(fr.auth.password)).toBeNull()
    expect(screen.queryByLabelText(fr.auth.invitationName)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.auth.invitationAcceptAs }))

    await waitFor(() =>
      expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, { kind: 'signedInAccount' }),
    )
    expect(await screen.findByText(/Évènement à/)).toBeVisible()
  })

  it('says the link is for another address, and lets the person leave the account', async () => {
    const session = vi
      .fn<Api['session']>()
      .mockResolvedValueOnce({ authenticated: true, user: aSessionUser() })
      .mockResolvedValue({ authenticated: false })
    const api = fakeApi({
      session,
      acceptInvitation: vi.fn(() => Promise.reject(new ApiError(403, 'invitation.wrongAccount'))),
    })
    renderInvitation(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.invitationAcceptAs }))
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['invitation.wrongAccount'])

    await userEvent.click(screen.getByRole('button', { name: fr.auth.invitationUseAnother }))

    // Signed out, and the page asks again who is signed in: the form for making an account.
    expect(await screen.findByLabelText(fr.auth.invitationName)).toBeVisible()
    expect(api.logout).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks again who is signed in when the session lapsed under the page, and shows the form', async () => {
    // The page said "accept as <this account>", the session ended in the minute it was open,
    // and the server answers that it has no account to attach. A sentence over a form with no
    // fields would be a dead end.
    const session = vi
      .fn<Api['session']>()
      .mockResolvedValueOnce({ authenticated: true, user: aSessionUser() })
      .mockResolvedValue({ authenticated: false })
    const api = fakeApi({
      session,
      acceptInvitation: vi.fn(() =>
        Promise.reject(new ApiError(400, 'invitation.credentialsRequired')),
      ),
    })
    renderInvitation(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.invitationAcceptAs }))

    expect(await screen.findByLabelText(fr.auth.invitationName)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(fr.errors['invitation.credentialsRequired'])
  })

  it('says so when it cannot sign the person out of the account', async () => {
    const api = fakeApi({
      ...signedInAs('camille@example.org'),
      logout: vi.fn(() => Promise.reject(ApiError.network())),
    })
    renderInvitation(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.invitationUseAnother }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.getByText(fr.auth.invitationSignedInAs('camille@example.org'))).toBeVisible()
  })
})

describe('AcceptInvitationPage: a link that opens nothing', () => {
  const deadAs = (error: ApiError) => fakeApi({ invitation: vi.fn(() => Promise.reject(error)) })

  it.each([
    ['an unknown, spent, replaced or expired link', new ApiError(404, 'invitation.notFound')],
    ['a link to an event that was archived since', new ApiError(409, 'event.immutable')],
  ])('answers %s with one sentence, and no form', async (_name, error) => {
    renderInvitation(deadAs(error))

    expect(await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })).toBeVisible()
    expect(screen.getByText(fr.errors['invitation.notFound'])).toBeVisible()
    expect(screen.queryByLabelText(fr.auth.password)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.auth.invitationSubmit })).toBeNull()
  })

  it('says the same thing for every one of them, down to the markup', async () => {
    const first = renderInvitation(deadAs(new ApiError(404, 'invitation.notFound')))
    await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })
    const notFound = first.container.innerHTML
    first.unmount()

    const second = renderInvitation(deadAs(new ApiError(409, 'event.immutable')))
    await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })

    // Not "similar": the server took care to give one answer, and a second sentence here would
    // be the oracle it refused to be.
    expect(second.container.innerHTML).toBe(notFound)
  })

  it('treats a link that died between the preview and the press the same way', async () => {
    const api = fakeApi({
      acceptInvitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
    })
    renderInvitation(api)

    await fillIn()
    await submit()

    expect(await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })).toBeVisible()
    expect(screen.queryByLabelText(fr.auth.password)).toBeNull()
  })

  it('says the same thing for a client invitation that waits for an owner, or whose approval was withdrawn', async () => {
    // The operator guard (G2-12): an invitation into a client that has an event or a member opens
    // nothing until one of its owners approves it, and is judged again when it is spent. The
    // server answers `404 invitation.notFound` for both, at the preview and at the press, so the
    // page has one sentence for "waiting", "withdrawn" and "never existed" — which is the
    // property: a stranger holding the link learns nothing about the client, and the person it
    // was written for is told to ask the person who sent it.
    const client = anInvitationPreview({ kind: 'client', role: 'owner', targetName: 'Studio Lune' })
    const waiting = renderInvitation(
      fakeApi({
        invitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
      }),
    )
    await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })
    const atThePreview = waiting.container.innerHTML
    waiting.unmount()

    const withdrawn = renderInvitation(
      fakeApi({
        invitation: vi.fn(async () => client),
        acceptInvitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
      }),
    )
    await fillIn()
    await submit()
    await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })

    expect(withdrawn.container.innerHTML).toBe(atThePreview)
    expect(screen.getByText(fr.errors['invitation.notFound'])).toBeVisible()
    expect(document.body.textContent).not.toContain('Studio Lune')
  })

  it('does not call a dropped connection a dead link, and offers to ask again', async () => {
    const invitation = vi
      .fn<Api['invitation']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue(anInvitationPreview())
    renderInvitation(fakeApi({ invitation }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.queryByRole('heading', { name: fr.auth.deadLinkTitle })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByLabelText(fr.auth.invitationName)).toBeVisible()
    expect(invitation).toHaveBeenCalledTimes(2)
  })

  it('does not call a rate limit a dead link either', async () => {
    renderInvitation(deadAs(new ApiError(429, 'rate.limited')))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rate.limited'])
    expect(screen.queryByRole('heading', { name: fr.auth.deadLinkTitle })).toBeNull()
  })

  it('offers the sign-in, which is the one thing somebody with a dead link may still do', async () => {
    renderInvitation(deadAs(new ApiError(404, 'invitation.notFound')))

    expect(await screen.findByRole('link', { name: fr.auth.submit })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})

describe('AcceptInvitationPage: accessibility', () => {
  it('moves the keyboard to the heading once the link has been read', async () => {
    renderInvitation(fakeApi())

    await screen.findByLabelText(fr.auth.invitationName)

    // Without it the keyboard is on whatever was removed, and a screen reader says nothing
    // about the page that replaced the spinner.
    expect(screen.getByRole('heading', { name: fr.auth.invitationTitle })).toHaveFocus()
  })

  it('moves the keyboard to the heading of a dead link too', async () => {
    renderInvitation(
      fakeApi({
        invitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
      }),
    )

    expect(await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })).toHaveFocus()
  })

  it('labels every field, with the autocomplete hints a password manager needs', async () => {
    renderInvitation(fakeApi())

    expect(await screen.findByLabelText(fr.auth.invitationName)).toHaveAttribute(
      'autocomplete',
      'name',
    )
    expect(screen.getByLabelText(fr.auth.password)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(fr.auth.password)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(fr.auth.invitationConfirmPassword)).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
  })

  it('announces a refusal where the person is looking, as an alert', async () => {
    const api = fakeApi({
      acceptInvitation: vi.fn(() => Promise.reject(new ApiError(400, 'password.tooShort'))),
    })
    renderInvitation(api)

    await fillIn()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['password.tooShort'])
  })

  it('can be submitted from the keyboard, with Enter in the last field', async () => {
    const api = fakeApi()
    renderInvitation(api)

    await fillIn()
    await userEvent.type(screen.getByLabelText(fr.auth.invitationConfirmPassword), '{Enter}')

    await waitFor(() => expect(api.acceptInvitation).toHaveBeenCalledTimes(1))
  })

  it('hands the keyboard to the new heading when the person leaves the account they were in', async () => {
    const session = vi
      .fn<Api['session']>()
      .mockResolvedValueOnce({ authenticated: true, user: aSessionUser() })
      .mockResolvedValue({ authenticated: false })
    renderInvitation(fakeApi({ session }))

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.invitationUseAnother }))
    await screen.findByLabelText(fr.auth.invitationName)

    expect(screen.getByRole('heading', { name: fr.auth.invitationTitle })).toHaveFocus()
  })
})

describe('AcceptInvitationPage: while the page is open', () => {
  it('changes language without asking the server about the link again, and keeps what was typed', async () => {
    // The picker is the invitee's remedy for not reading French. Re-asking would spend the
    // preview's rate limit, and an answer that failed the second time would replace the form.
    const invitation = vi
      .fn<Api['invitation']>()
      .mockResolvedValueOnce(anInvitationPreview())
      .mockRejectedValue(ApiError.network())
    renderWithProviders(
      <>
        <LanguagePicker />
        <Routes>
          <Route path="/invite/:token" element={<AcceptInvitationPage />} />
        </Routes>
      </>,
      { api: fakeApi({ invitation }), route: `/invite/${TOKEN}` },
    )
    await fillIn('Camille')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: fr.app.language }), 'en')

    expect(
      await screen.findByRole('button', { name: 'Create my account and accept' }),
    ).toBeVisible()
    expect(screen.getByDisplayValue('Camille')).toBeVisible()
    expect(invitation).toHaveBeenCalledTimes(1)
  })

  it('words a failure to ask in the language the page is in by then', async () => {
    const invitation = vi.fn<Api['invitation']>().mockRejectedValue(ApiError.network())
    renderWithProviders(
      <>
        <LanguagePicker />
        <Routes>
          <Route path="/invite/:token" element={<AcceptInvitationPage />} />
        </Routes>
      </>,
      { api: fakeApi({ invitation }), route: `/invite/${TOKEN}` },
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: fr.app.language }), 'de')

    expect(screen.getByRole('alert')).toHaveTextContent(de.errors.network)
    expect(invitation).toHaveBeenCalledTimes(1)
  })

  it('shows the wait, and not the previous link, when the address changes to another link', async () => {
    let answerSecond: (value: ReturnType<typeof anInvitationPreview>) => void = () => undefined
    const invitation = vi
      .fn<Api['invitation']>()
      .mockResolvedValueOnce(anInvitationPreview({ targetName: 'Premier évènement' }))
      .mockImplementationOnce(() => new Promise((resolve) => (answerSecond = resolve)))
    renderWithProviders(
      <>
        <Link to="/invite/AUTRE-LIEN">autre</Link>
        <Routes>
          <Route path="/invite/:token" element={<AcceptInvitationPage />} />
        </Routes>
      </>,
      { api: fakeApi({ invitation }), route: `/invite/${TOKEN}` },
    )
    expect(await screen.findByText(/Premier évènement/)).toBeVisible()

    await userEvent.click(screen.getByRole('link', { name: 'autre' }))

    // Not another person's invitation under this address while the right one is on its way.
    expect(screen.queryByText(/Premier évènement/)).toBeNull()
    expect(screen.queryByLabelText(fr.auth.invitationName)).toBeNull()
    answerSecond(anInvitationPreview({ targetName: 'Second évènement' }))
    expect(await screen.findByText(/Second évènement/)).toBeVisible()
    expect(invitation).toHaveBeenLastCalledWith('AUTRE-LIEN', expect.any(AbortSignal))
  })

  it.each([
    ['a link that was dead', () => Promise.reject(new ApiError(404, 'invitation.notFound'))],
    ['a dropped connection', () => Promise.reject(ApiError.network())],
    [
      'another invitation',
      () => Promise.resolve(anInvitationPreview({ targetName: 'Évènement périmé' })),
    ],
  ])(
    'ignores the late answer of a request it has already left behind: %s',
    async (_name, lateAnswer) => {
      // The first link is slow, the person moves on to the second, and the second answers.
      // What the first one eventually says is about a read nobody is waiting for any more, and
      // it must not take the second one's place on the screen.
      const settlers: (() => void)[] = []
      const invitation = vi
        .fn<Api['invitation']>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              settlers.push(() => {
                lateAnswer().then(resolve, reject)
              })
            }),
        )
        .mockResolvedValue(anInvitationPreview({ targetName: 'Évènement frais' }))
      renderWithProviders(
        <>
          <Link to="/invite/AUTRE-LIEN">autre</Link>
          <Routes>
            <Route path="/invite/:token" element={<AcceptInvitationPage />} />
          </Routes>
        </>,
        { api: fakeApi({ invitation }), route: `/invite/${TOKEN}` },
      )
      await userEvent.click(screen.getByRole('link', { name: 'autre' }))
      expect(await screen.findByText(/Évènement frais/)).toBeVisible()

      settlers.forEach((settle) => settle())
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(screen.getByText(/Évènement frais/)).toBeVisible()
      expect(screen.queryByText(/Évènement périmé/)).toBeNull()
      expect(screen.queryByRole('heading', { name: fr.auth.deadLinkTitle })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )
})

describe('AcceptInvitationPage: the token stays where it was put', () => {
  it('is not in the title, in storage, or anywhere the page prints', async () => {
    const titleBefore = document.title
    renderInvitation(fakeApi())

    await screen.findByLabelText(fr.auth.invitationName)

    expect(document.title).toBe(titleBefore)
    expect(document.title).not.toContain(TOKEN)
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN)
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN)
  })

  it('is not on the dead-link page either', async () => {
    renderInvitation(
      fakeApi({
        invitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
      }),
    )

    await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })

    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('goes to the server in a path segment, escaped, and in no request body but the one for this link', async () => {
    const api = fakeApi()
    renderInvitation(api)
    await fillIn()
    await submit()

    await waitFor(() => expect(api.acceptInvitation).toHaveBeenCalled())
    const [token, body] = vi.mocked(api.acceptInvitation).mock.calls[0] ?? []
    expect(token).toBe(TOKEN)
    expect(JSON.stringify(body)).not.toContain(TOKEN)
  })

  it('links nowhere that carries it in a query string', async () => {
    renderInvitation(fakeApi())

    const link = await screen.findByRole('link', { name: fr.auth.submit })

    expect(link.getAttribute('href')).toBe('/login')
  })
})

// -------------------------------------------------------- the terms of use --

/**
 * G2-20. On a box whose operator asks for its terms, the preview carries them and the page ends
 * both ways in with a required, unticked box and a link to read them. On every other box the
 * page is the one it always was, and nothing extra is sent.
 */
describe('AcceptInvitationPage: the terms of use', () => {
  const TERMS = { url: 'https://hosted.example.org/legal/cgu', version: '2027-01' }

  const asking = (overrides: Partial<Api> = {}): Api =>
    fakeApi({
      invitation: vi.fn(async () => anInvitationPreview({ terms: TERMS })),
      ...overrides,
    })

  const termsBox = () =>
    screen.findByRole('checkbox', { name: fr.auth.invitationAcceptTerms(TERMS.version) })

  describe('on a box that asks for none', () => {
    it('shows no box and no link, and sends the body it always did', async () => {
      const api = fakeApi()
      renderInvitation(api)

      await fillIn('Camille')
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.queryByText(fr.auth.invitationReadTerms)).toBeNull()
      await submit()

      await waitFor(() =>
        expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, {
          kind: 'newAccount',
          displayName: 'Camille',
          password: CHOSEN_PASSWORD,
        }),
      )
    })

    it('shows none for an account that is signed in either, and sends nothing with it', async () => {
      const api = fakeApi(signedInAs('camille@example.org'))
      renderInvitation(api)

      await userEvent.click(await screen.findByRole('button', { name: fr.auth.invitationAcceptAs }))

      expect(screen.queryByRole('checkbox')).toBeNull()
      await waitFor(() =>
        expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, { kind: 'signedInAccount' }),
      )
    })
  })

  describe('on a box that asks for them', () => {
    it('shows a box that is unticked and required, with the version in its sentence', async () => {
      renderInvitation(asking())

      const box = await termsBox()

      expect(box).not.toBeChecked()
      expect(box).toBeRequired()
      expect(box).toBeEnabled()
    })

    it('links the terms in a tab of their own, and says so to a screen reader', async () => {
      renderInvitation(asking())

      const link = await screen.findByRole('link', {
        name: new RegExp(fr.auth.invitationReadTerms),
      })

      expect(link).toHaveAttribute('href', TERMS.url)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link).toHaveAccessibleName(
        new RegExp(`${fr.auth.invitationReadTerms} \\(${fr.about.opensInNewTab}\\)`),
      )
    })

    it('describes the box by that link, so a screen reader hears where the terms are as it lands', async () => {
      renderInvitation(asking())

      const box = await termsBox()

      expect(box).toHaveAccessibleDescription(new RegExp(fr.auth.invitationReadTerms))
    })

    it('links a path on this site, which is where a hosted instance serves its own pages', async () => {
      const api = asking({
        invitation: vi.fn(async () =>
          anInvitationPreview({ terms: { url: '/legal/cgu', version: '2027-01' } }),
        ),
      })
      renderInvitation(api)

      expect(
        await screen.findByRole('link', { name: new RegExp(fr.auth.invitationReadTerms) }),
      ).toHaveAttribute('href', '/legal/cgu')
    })

    it.each([
      ['a javascript: address', 'javascript:alert(1)'],
      ['a plain http address', 'http://hosted.example.org/legal/cgu'],
      ['a protocol-relative address', '//evil.example.org/cgu'],
    ])('links nothing for %s, and still asks for the box', async (_what, url) => {
      const api = asking({
        invitation: vi.fn(async () =>
          anInvitationPreview({ terms: { url, version: TERMS.version } }),
        ),
      })
      renderInvitation(api)

      expect(await termsBox()).toBeVisible()
      expect(
        screen.queryByRole('link', { name: new RegExp(fr.auth.invitationReadTerms) }),
      ).toBeNull()
    })

    it('sends nothing and says so under the box when the form is sent with the box empty', async () => {
      const api = asking()
      renderInvitation(api)
      await fillIn('Camille')

      await submit()

      const box = await termsBox()
      expect(await screen.findByText(fr.errors['terms.notAccepted'])).toBeVisible()
      expect(box).toHaveAttribute('aria-invalid', 'true')
      expect(box).toHaveAccessibleDescription(new RegExp(fr.errors['terms.notAccepted']))
      expect(box).toHaveFocus()
      expect(api.acceptInvitation).not.toHaveBeenCalled()
    })

    it('says the first thing wrong first: a form with no name does not also scold about the box', async () => {
      const api = asking()
      renderInvitation(api)
      await fillIn('', CHOSEN_PASSWORD, CHOSEN_PASSWORD)

      await submit()

      expect(await screen.findByText(fr.errors['accountName.empty'])).toBeVisible()
      expect(screen.queryByText(fr.errors['terms.notAccepted'])).toBeNull()
      expect(api.acceptInvitation).not.toHaveBeenCalled()
    })

    it('takes the message away as soon as the box is ticked, and then sends the tick with the form', async () => {
      const api = asking()
      renderInvitation(api)
      await fillIn('Camille')
      await submit()
      await screen.findByText(fr.errors['terms.notAccepted'])

      await userEvent.click(await termsBox())

      expect(screen.queryByText(fr.errors['terms.notAccepted'])).toBeNull()
      await submit()
      await waitFor(() =>
        expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, {
          kind: 'newAccount',
          displayName: 'Camille',
          password: CHOSEN_PASSWORD,
          acceptTerms: true,
        }),
      )
      expect(await screen.findByText(/Évènement à \/admin\/events\/camille-et-sacha/)).toBeVisible()
    })

    it('is ticked with the keyboard, space on the focused box', async () => {
      renderInvitation(asking())
      const box = await termsBox()

      box.focus()
      await userEvent.keyboard(' ')

      expect(box).toBeChecked()
    })

    it('does not tick the box by pressing the link to read the terms', async () => {
      renderInvitation(asking())
      const box = await termsBox()

      await userEvent.click(
        screen.getByRole('link', { name: new RegExp(fr.auth.invitationReadTerms) }),
      )

      expect(box).not.toBeChecked()
    })

    it('asks the signed-in account too, and sends the tick with it', async () => {
      const api = asking(signedInAs('camille@example.org'))
      renderInvitation(api)

      await userEvent.click(await screen.findByRole('button', { name: fr.auth.invitationAcceptAs }))
      expect(await screen.findByText(fr.errors['terms.notAccepted'])).toBeVisible()
      expect(api.acceptInvitation).not.toHaveBeenCalled()

      await userEvent.click(await termsBox())
      await userEvent.click(screen.getByRole('button', { name: fr.auth.invitationAcceptAs }))

      await waitFor(() =>
        expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, {
          kind: 'signedInAccount',
          acceptTerms: true,
        }),
      )
    })

    it('says the server’s own words when it refuses for the box, which is worded like the page’s', async () => {
      // A page read before the operator switched the terms on has no box to show, and the
      // server then answers with the same sentence the page would have given.
      const api = fakeApi({
        acceptInvitation: vi.fn(() => Promise.reject(new ApiError(400, 'terms.notAccepted'))),
      })
      renderInvitation(api)
      await fillIn('Camille')

      await submit()

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['terms.notAccepted'])
    })

    it('says it in the language of the reader, the sentence and the refusal', async () => {
      const api = asking()
      renderInvitation(api, { locale: 'de' })

      const box = await screen.findByRole('checkbox', {
        name: de.auth.invitationAcceptTerms(TERMS.version),
      })
      await userEvent.type(screen.getByLabelText(de.auth.invitationName), 'Camille')
      await userEvent.type(screen.getByLabelText(de.auth.password), CHOSEN_PASSWORD)
      await userEvent.type(
        screen.getByLabelText(de.auth.invitationConfirmPassword),
        CHOSEN_PASSWORD,
      )
      await userEvent.click(screen.getByRole('button', { name: de.auth.invitationSubmit }))

      expect(await screen.findByText(de.errors['terms.notAccepted'])).toBeVisible()
      expect(box).toHaveAttribute('aria-invalid', 'true')
    })

    it('shows nothing of them on a dead link, which is the one dead-link page', async () => {
      const api = asking({
        invitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
      })
      renderInvitation(api)

      expect(await screen.findByText(fr.errors['invitation.notFound'])).toBeVisible()
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(document.body).not.toHaveTextContent(TERMS.version)
    })
  })
})
