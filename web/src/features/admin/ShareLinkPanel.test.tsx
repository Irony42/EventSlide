import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router-dom'
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

  describe('a copy that fails, and a link that is never shown again', () => {
    const URL_SHOWN = 'https://photos.example.test/g/le-jeton-du-lien'

    const createLink = async () => {
      await userEvent.click(await screen.findByRole('button', { name: fr.admin.shareLinkCreate }))
      await screen.findByText(fr.admin.shareLinkCreated)
    }
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    const clipboard = (value: unknown) =>
      Object.defineProperty(navigator, 'clipboard', { value, configurable: true })

    it('says the copy failed, and leaves the address on screen and selected to copy by hand', async () => {
      clipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) })
      render(fakeApi())
      await createLink()

      await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCopy }))

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.admin.shareLinkCopyFailed)
      expect(screen.queryByText(fr.admin.shareLinkCopied)).toBeNull()
      const field = screen.getByLabelText<HTMLInputElement>(fr.admin.shareLinkUrl)
      expect(field).toHaveValue(URL_SHOWN)
      expect(field).toHaveFocus()
      expect(field.selectionStart).toBe(0)
      expect(field.selectionEnd).toBe(URL_SHOWN.length)
    })

    it('says the same when the browser has no clipboard at all', async () => {
      clipboard(undefined)
      render(fakeApi())
      await createLink()

      await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCopy }))

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.admin.shareLinkCopyFailed)
    })

    it('says nothing is wrong when the copy worked', async () => {
      clipboard({ writeText: vi.fn(async () => undefined) })
      render(fakeApi())
      await createLink()

      await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCopy }))

      expect(await screen.findByText(fr.admin.shareLinkCopied)).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('asks before the page is left while the address has never been copied', async () => {
      render(fakeApi())
      await createLink()

      expect(leave()).toBe(true)
    })

    it('stops asking once the address has been copied', async () => {
      clipboard({ writeText: vi.fn(async () => undefined) })
      render(fakeApi())
      await createLink()
      await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCopy }))
      await screen.findByText(fr.admin.shareLinkCopied)

      expect(leave()).toBe(false)
    })

    it('counts a copy the host made by hand from the field', async () => {
      render(fakeApi())
      await createLink()

      fireEvent.copy(screen.getByLabelText(fr.admin.shareLinkUrl))

      expect(leave()).toBe(false)
    })

    it('keeps asking after a copy that failed: the address has not left the page', async () => {
      clipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) })
      render(fakeApi())
      await createLink()
      await userEvent.click(screen.getByRole('button', { name: fr.admin.shareLinkCopy }))
      await screen.findByRole('alert')

      expect(leave()).toBe(true)
    })

    it('keeps the host on the page when they decline to follow a link of the app while the address is unsaved', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderWithProviders(
        <>
          <ShareLinkPanel slug={SLUG} />
          <Link to="/admin">Vos évènements</Link>
        </>,
        { api: fakeApi(), route: '/', path: '/' },
      )
      await createLink()

      await userEvent.click(screen.getByRole('link', { name: 'Vos évènements' }))

      expect(confirm).toHaveBeenCalledWith(fr.admin.shareLinkLeaveWarning)
      // Still here: the router did not take the link.
      expect(screen.getByLabelText(fr.admin.shareLinkUrl)).toHaveValue(URL_SHOWN)

      confirm.mockReturnValue(true)
      await userEvent.click(screen.getByRole('link', { name: 'Vos évènements' }))
      await waitFor(() => expect(screen.queryByLabelText(fr.admin.shareLinkUrl)).toBeNull())
    })

    it('says nothing about leaving when no link has been made on this page', async () => {
      render(fakeApi(withLink()))
      await screen.findByText(fr.admin.shareLinkReplaceHint)

      expect(leave()).toBe(false)
    })
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

  it('says it is waiting, and does not claim there is no link, until the status is known', async () => {
    render(fakeApi({ shareLink: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(await screen.findByRole('status')).toHaveTextContent(fr.app.loading)
    expect(screen.queryByText(fr.admin.shareLinkNone)).toBeNull()
  })

  it('does not claim there is no link when the status could not be read', async () => {
    render(
      fakeApi({
        shareLink: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    // Inside a card whose title is a level 2, so the failure is a level 3 and not a second 2.
    expect(screen.getByRole('heading', { level: 3, name: fr.app.loadFailed })).toBeVisible()
    expect(screen.queryByText(fr.admin.shareLinkNone)).toBeNull()
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
