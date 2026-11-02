import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { JoinPage } from './JoinPage'
import { readRememberedGuestSession, rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import notice from '../../design-system/components/Notice.module.css'
import { classesOf, cls } from '../../testing/classesOf'
import {
  aJoinResponse,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { JoinResponse } from '../../lib/api/dto'

/** Stands in for features/guest-upload, so "joined" is observable as a guest sees it. */
const UPLOAD_SCREEN = 'Vos photos sont attendues'

const renderJoin = (route: string, api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/join" element={<JoinPage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/e/:slug/upload" element={<h1>{UPLOAD_SCREEN}</h1>} />
    </Routes>,
    { route, api },
  )

describe('JoinPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('resolves a scanned code without the guest pressing anything', async () => {
    const api = fakeApi({
      join: vi.fn(async () => aJoinResponse({ event: aPublicEvent({ name: 'Kermesse' }) })),
    })

    renderJoin('/join/H7K2QM', api)

    expect(await screen.findByRole('heading', { name: fr.join.welcome('Kermesse') })).toBeVisible()
    expect(api.join).toHaveBeenCalledWith('H7K2QM', null)
  })

  it('shows the host welcome message as plain text, keeping its line breaks', async () => {
    const api = fakeApi({
      join: vi.fn(async () =>
        aJoinResponse({
          event: aPublicEvent({
            name: 'Kermesse',
            brand: { welcomeMessage: '<b>Bienvenue</b>\nUne photo du gâteau ?' },
          }),
        }),
      ),
    })

    renderJoin('/join/H7K2QM', api)

    const greeting = await screen.findByTestId('host-greeting')
    expect(greeting.textContent).toBe('<b>Bienvenue</b>\nUne photo du gâteau ?')
    expect(greeting.querySelector('b')).toBeNull()
    expect(greeting).toHaveAttribute('dir', 'auto')
  })

  it('draws no greeting when the host wrote none', async () => {
    const api = fakeApi({
      join: vi.fn(async () => aJoinResponse({ event: aPublicEvent({ name: 'Kermesse' }) })),
    })

    renderJoin('/join/H7K2QM', api)

    await screen.findByRole('heading', { name: fr.join.welcome('Kermesse') })
    expect(screen.queryByTestId('host-greeting')).toBeNull()
  })

  it('says it is working while a scanned code is being resolved', async () => {
    // A guest who scanned a QR code pressed nothing, so an unexplained blank screen
    // reads as a broken link and they put the phone away.
    const api = fakeApi({ join: vi.fn(() => new Promise<JoinResponse>(() => {})) })

    renderJoin('/join/H7K2QM', api)

    expect(await screen.findByRole('status')).toHaveTextContent(fr.join.submitting)
  })

  it('records the name a scanned guest adds, then hands them to the upload screen', async () => {
    const api = fakeApi()
    renderJoin('/join/H7K2QM', api)

    await userEvent.type(await screen.findByLabelText(/Votre prénom/), 'Léa')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    await waitFor(() => expect(api.join).toHaveBeenLastCalledWith('H7K2QM', 'Léa'))
    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
  })

  it('asks the server nothing more when a scanned guest gives no name', async () => {
    const api = fakeApi()
    renderJoin('/join/H7K2QM', api)

    await userEvent.click(await screen.findByRole('button', { name: fr.join.submit }))

    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
    expect(api.join).toHaveBeenCalledTimes(1)
  })

  it('accepts a code typed in the wrong case with a stray dash', async () => {
    // The tolerance is the server's, and the client must not second-guess it: a guest
    // reading a printed card in a dark room typing `h7k-2qm` is the common case, and
    // rejecting it locally is how they give up on the code.
    const api = fakeApi()
    renderJoin('/join', api)

    await userEvent.type(screen.getByLabelText(fr.join.codeLabel), 'h7k-2qm')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    expect(api.join).toHaveBeenCalledWith('h7k-2qm', null)
    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
  })

  it('keeps an unknown code on screen and editable instead of blaming the guest', async () => {
    const api = fakeApi({
      join: vi.fn(async () => {
        throw new ApiError(404, 'event.notFound')
      }),
    })
    renderJoin('/join', api)

    await userEvent.type(screen.getByLabelText(fr.join.codeLabel), 'ZZZZZZ')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.notFound'])
    const field = screen.getByLabelText(fr.join.codeLabel)
    expect(field).toHaveValue('ZZZZZZ')
    expect(field).toBeEnabled()
  })

  it('frames the welcome step’s failure the way the host’s forms frame theirs, not as a bare red line', async () => {
    // The same kind of failure on the guest's phone and on the host's laptop: one look. (A
    // refused code is told on the code box itself, which is the field's own error.)
    let attempt = 0
    const api = fakeApi({
      join: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) return aJoinResponse({ event: aPublicEvent({ name: 'Kermesse' }) })
        throw ApiError.network()
      }),
    })
    renderJoin('/join/H7K2QM', api)

    await userEvent.type(await screen.findByLabelText(/Votre prénom/), 'Léa')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    expect(classesOf(await screen.findByRole('alert'))).toContain(cls(notice, 'boxed'))
  })

  it('lets a guest stay anonymous on purpose', async () => {
    const api = fakeApi({ join: vi.fn(async () => aJoinResponse({ displayName: null })) })
    renderJoin('/join', api)

    await userEvent.type(screen.getByLabelText(fr.join.codeLabel), 'H7K2QM')
    // Typed and then abandoned: choosing anonymity is explicit, so it wins over what
    // is left in the field rather than being something the guest has to erase.
    await userEvent.type(screen.getByLabelText(/Votre prénom/), 'Léa')
    await userEvent.click(screen.getByRole('button', { name: fr.join.anonymous }))

    expect(api.join).toHaveBeenCalledWith('H7K2QM', null)
    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
  })

  it('offers nothing to press until a code has been typed', () => {
    renderJoin('/join', fakeApi())

    expect(screen.getByRole('button', { name: fr.join.submit })).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.join.anonymous })).toBeDisabled()
  })

  it('keeps a scanned guest on the welcome step when recording their name fails', async () => {
    let attempt = 0
    const api = fakeApi({
      join: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) return aJoinResponse({ event: aPublicEvent({ name: 'Kermesse' }) })
        throw ApiError.network()
      }),
    })
    renderJoin('/join/H7K2QM', api)

    await userEvent.type(await screen.findByLabelText(/Votre prénom/), 'Léa')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    // The code has already resolved, so sending them back to type it again would be
    // punishing the guest for the venue's Wi-Fi.
    expect(screen.getByRole('heading', { name: fr.join.welcome('Kermesse') })).toBeVisible()
  })

  it('hands a scanned guest who wants no name straight to the upload screen', async () => {
    // The code has already resolved on mount, so there is nothing left to ask the
    // server: a guest who chooses anonymity here should not pay a second round trip
    // for it on venue Wi-Fi.
    const api = fakeApi({
      join: vi.fn(async () => aJoinResponse({ event: aPublicEvent({ name: 'Kermesse' }) })),
    })
    renderJoin('/join/H7K2QM', api)
    await screen.findByRole('heading', { name: fr.join.welcome('Kermesse') })

    await userEvent.click(screen.getByRole('button', { name: fr.join.anonymous }))

    expect(api.join).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
  })

  it('sends a code read wrong across a room to the server exactly as typed', async () => {
    // The alphabet is Crockford base32: the server maps I and L to 1 and O to 0,
    // because a guest reading a projected code from the back of a room types the glyph
    // they see. Normalising or rejecting it here is how that mapping stops working.
    const api = fakeApi()
    renderJoin('/join', api)

    await userEvent.type(screen.getByLabelText(fr.join.codeLabel), 'HOIK2L')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    expect(api.join).toHaveBeenCalledWith('HOIK2L', null)
    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
  })

  it('still says something useful when the failure is not one the server described', async () => {
    const api = fakeApi({
      join: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    renderJoin('/join', api)

    await userEvent.type(screen.getByLabelText(fr.join.codeLabel), 'H7K2QM')
    await userEvent.click(screen.getByRole('button', { name: fr.join.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.unknown)
  })
})

/** What a browser answers when the page is running from the home-screen icon. */
const asInstalledApp = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('display-mode: standalone'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

const havingJoined = (slug: string): void => {
  rememberGuestSession({
    event: aPublicEvent({ slug, name: 'Kermesse' }),
    displayName: 'Léa',
    privacyNotice: aPrivacyNoticeState(),
  })
  // The tab is gone; the device remembers.
  sessionStorage.clear()
}

describe('JoinPage: the installed app reopens the event (A1)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('goes straight back to the event the phone joined last, asking the server nothing', async () => {
    havingJoined('kermesse')
    asInstalledApp()
    const api = fakeApi()

    renderJoin('/join', api)

    expect(await screen.findByRole('heading', { name: UPLOAD_SCREEN })).toBeVisible()
    expect(api.join).not.toHaveBeenCalled()
  })

  it('stays an empty code entry in an ordinary browser tab', () => {
    // A guest typing tomorrow's code in a tab must not be carried to last night's event.
    havingJoined('kermesse')

    renderJoin('/join', fakeApi())

    expect(screen.getByLabelText(fr.join.codeLabel)).toHaveValue('')
  })

  it('asks for a code when the installed app has nothing remembered', () => {
    asInstalledApp()

    renderJoin('/join', fakeApi())

    expect(screen.getByLabelText(fr.join.codeLabel)).toHaveValue('')
  })

  it('prefers a scanned code over what it remembers', async () => {
    havingJoined('kermesse')
    asInstalledApp()
    const api = fakeApi({
      join: vi.fn(async () => aJoinResponse({ event: aPublicEvent({ name: 'Gala' }) })),
    })

    renderJoin('/join/H7K2QM', api)

    expect(await screen.findByRole('heading', { name: fr.join.welcome('Gala') })).toBeVisible()
    expect(api.join).toHaveBeenCalledWith('H7K2QM', null)
  })
})

describe('JoinPage: a way out of the wrong event (A10)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('goes back to an empty code entry and forgets the event it had just resolved', async () => {
    const api = fakeApi({
      join: vi.fn(async () => aJoinResponse({ event: aPublicEvent({ name: 'Kermesse' }) })),
    })
    renderJoin('/join/H7K2QM', api)
    await screen.findByRole('heading', { name: fr.join.welcome('Kermesse') })

    await userEvent.click(screen.getByRole('button', { name: fr.join.notYourEvening }))

    expect(await screen.findByLabelText(fr.join.codeLabel)).toHaveValue('')
    expect(readRememberedGuestSession()).toBeNull()
    expect(api.join).toHaveBeenCalledTimes(1)
  })

  it('does not offer it while the code is still being resolved or typed', () => {
    renderJoin('/join', fakeApi())

    expect(screen.queryByRole('button', { name: fr.join.notYourEvening })).toBeNull()
  })
})

describe('JoinPage: a code that opens nothing (A9)', () => {
  it('says the evening may not be open yet, or may be over, and what to do', async () => {
    const api = fakeApi({
      join: vi.fn(async () => {
        throw new ApiError(404, 'event.notFound')
      }),
    })
    renderJoin('/join/H7K2QM', api)

    expect(await screen.findByText(fr.join.notOpenHint)).toBeVisible()
    // Still the code box, still editable: one answer for every cause, so nothing more specific.
    expect(screen.getByLabelText(fr.join.codeLabel)).toHaveValue('H7K2QM')
  })

  it('says nothing of the kind for a failure that is the network’s', async () => {
    const api = fakeApi({
      join: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderJoin('/join/H7K2QM', api)

    await screen.findByRole('alert')
    expect(screen.queryByText(fr.join.notOpenHint)).toBeNull()
  })
})

describe('JoinPage: the organiser’s way in (H1)', () => {
  it('links the code entry to the sign-in page, and asks the server nothing for it', () => {
    const api = fakeApi()
    renderJoin('/join', api)

    expect(screen.getByRole('link', { name: fr.join.organiserLink })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(api.session).not.toHaveBeenCalled()
    expect(api.join).not.toHaveBeenCalled()
  })
})
