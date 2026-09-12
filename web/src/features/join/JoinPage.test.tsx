import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { JoinPage } from './JoinPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aJoinResponse,
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
