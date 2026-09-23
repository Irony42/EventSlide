import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatDateTime } from '../../lib/format'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aShareLink, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { ShareLinkPanel } from './ShareLinkPanel'
import type { Api } from '../../lib/api/client'

const SLUG = 'camille-et-sacha'

const render = (api: Api) => renderWithProviders(<ShareLinkPanel slug={SLUG} />, { api })

const withLink = (overrides: Parameters<typeof aShareLink>[0] = {}): Partial<Api> => ({
  shareLink: vi.fn(async () => ({ link: aShareLink(overrides) })),
})

describe('ShareLinkPanel', () => {
  it('says there is no link rather than showing nothing', async () => {
    render(fakeApi())

    expect(await screen.findByText(fr.admin.shareLinkNone)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.shareLinkCreate })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.shareLinkRevoke })).toBeNull()
  })

  it('makes a link for a month by default, with the password the host typed', async () => {
    const api = fakeApi()
    render(api)

    await userEvent.type(
      await screen.findByLabelText(new RegExp(fr.admin.shareLinkPassword)),
      'les mariés de juin',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCreate }))

    await waitFor(() =>
      expect(api.createShareLink).toHaveBeenCalledWith(SLUG, {
        expiresInDays: 30,
        password: 'les mariés de juin',
      }),
    )
  })

  it('makes a link for the lifetime chosen', async () => {
    const api = fakeApi()
    render(api)

    await userEvent.selectOptions(
      await screen.findByLabelText(fr.admin.shareLinkLifetime),
      fr.admin.shareLinkDays(7),
    )
    await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCreate }))

    await waitFor(() =>
      expect(api.createShareLink).toHaveBeenCalledWith(SLUG, { expiresInDays: 7, password: '' }),
    )
  })

  it('shows the address once, selectable and copyable, and says it will not be shown again', async () => {
    render(fakeApi())

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.shareLinkCreate }))

    expect(await screen.findByText(fr.admin.shareLinkCreated)).toBeVisible()
    expect(screen.getByLabelText(fr.admin.shareLinkUrl)).toHaveValue(
      'https://photos.example.test/g/le-jeton-du-lien',
    )
    expect(screen.getByRole('button', { name: fr.admin.shareLinkCopy })).toBeVisible()
  })

  it('copies the address to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(fakeApi())

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.shareLinkCreate }))
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.shareLinkCopy }))

    expect(writeText).toHaveBeenCalledWith('https://photos.example.test/g/le-jeton-du-lien')
    expect(await screen.findByText(fr.admin.shareLinkCopied)).toBeVisible()
  })

  it('reports a refused password on the password field', async () => {
    render(
      fakeApi({
        createShareLink: vi.fn(async () => {
          throw new ApiError(400, 'password.tooShort')
        }),
      }),
    )

    await userEvent.type(
      await screen.findByLabelText(new RegExp(fr.admin.shareLinkPassword)),
      'court',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCreate }))

    expect(await screen.findByText(fr.errors['password.tooShort'])).toBeVisible()
  })

  it('shows until when an open link works, and whether it asks for a password', async () => {
    render(fakeApi(withLink({ hasPassword: true })))

    const until = formatDateTime(aShareLink().expiresAt, 'fr') ?? ''
    expect(await screen.findByText(fr.admin.shareLinkActive(until))).toBeVisible()
    expect(screen.getByText(fr.admin.shareLinkProtected)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.shareLinkReplace })).toBeVisible()
    expect(screen.getByText(fr.admin.shareLinkReplaceHint)).toBeVisible()
  })

  it('says a link that no longer opens no longer opens, in words', async () => {
    render(fakeApi(withLink({ available: false })))

    expect(await screen.findByText(fr.admin.shareLinkUnavailable)).toBeVisible()
  })

  it('switches a link off only after the host confirms', async () => {
    const api = fakeApi(withLink())
    render(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.shareLinkRevoke }))
    expect(api.revokeShareLink).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: fr.admin.shareLinkRevokeTitle })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.admin.shareLinkRevoke }))

    await waitFor(() => expect(api.revokeShareLink).toHaveBeenCalledWith(SLUG))
    expect(await screen.findByText(fr.admin.shareLinkRevoked)).toBeVisible()
  })

  it('offers a retry when the status cannot be read', async () => {
    render(
      fakeApi({
        shareLink: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )

    expect(await screen.findByRole('button', { name: fr.app.retry })).toBeVisible()
  })
})
