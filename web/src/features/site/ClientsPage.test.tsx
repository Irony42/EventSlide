import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { ApiError } from '../../lib/http'
import type { Api } from '../../lib/api/client'
import type { OperatorInvitationDto } from '../../lib/api/dto'
import {
  aSiteClient,
  aSiteClientDefaults,
  aLinkInvitation,
  aSiteInvitation,
  CLIENT_ID,
  OTHER_CLIENT_ID,
} from '../../testing/siteFixtures'
import {
  consoleApi,
  callsOutsideTheConsole,
  notTheOperator,
  openConsole,
  stepUpRequired,
} from '../../testing/siteConsole'

/**
 * The console's front page: every client of the box, and the way to open another.
 *
 * Ring 5, through the route table over a fake `Api`. The four states every screen owes (a wait, a
 * refusal with a retry, nothing yet, rows) and the refusal an account that does not operate the box
 * would meet are all here, as are the opening of a client and the step-up it may ask for.
 */

const withClients = (...clients: ReturnType<typeof aSiteClient>[]) =>
  consoleApi({ siteClients: vi.fn(async () => ({ items: clients, next: null })) })

describe('the console’s clients', () => {
  it('waits, saying so, while the first page is on its way', async () => {
    const api = consoleApi({ siteClients: vi.fn(() => new Promise<never>(() => {})) })

    openConsole('/admin/site', api)

    // The page's own heading first: the wait before it is the route's, and not what is under test.
    await screen.findByRole('heading', { name: fr.site.clientsTitle })
    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says there is no client yet, and what to do about it, rather than showing an empty table', async () => {
    openConsole('/admin/site', withClients())

    expect(await screen.findByRole('heading', { name: fr.site.clientsEmpty })).toBeVisible()
    expect(screen.getByText(fr.site.clientsEmptyHint)).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says it could not read the clients, with a retry that reads them again', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockRejectedValueOnce(new ApiError(500, 'server.unexpected'))
      .mockResolvedValue({ items: [aSiteClient()], next: null })

    openConsole('/admin/site', consoleApi({ siteClients }))

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent(fr.app.loadFailed)
    expect(screen.queryByRole('table')).toBeNull()

    await userEvent.click(within(failure).getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('link', { name: 'Atelier Alpha' })).toBeVisible()
  })

  it('shows the server’s refusal, and no table, to an account the server does not let in', async () => {
    const siteClients = vi.fn<Api['siteClients']>().mockRejectedValue(notTheOperator())

    openConsole('/admin/site', consoleApi({ siteClients }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists each client with where it stands, what it holds and how much of its storage it uses', async () => {
    openConsole(
      '/admin/site',
      withClients(
        aSiteClient(),
        aSiteClient({
          id: OTHER_CLIENT_ID,
          name: 'Bureau Beta',
          suspendedAt: '2026-06-21T10:00:00.000Z',
          ceilings: { ...aSiteClient().ceilings, maxTotalBytes: null },
          usage: { eventCount: 2, liveEventCount: 0, memberCount: 1, usedBytes: 2_000_000 },
        }),
        aSiteClient({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          name: 'Cabinet Gamma',
          suspendedAt: '2026-06-21T10:00:00.000Z',
          purgeAfter: '2026-07-21T10:00:00.000Z',
        }),
      ),
    )

    const table = await screen.findByRole('table', { name: fr.site.clientsTableLabel })

    const alpha = within(within(table).getByRole('row', { name: /Atelier Alpha/ }))
    expect(alpha.getByText(fr.site.statusActive)).toBeVisible()
    expect(alpha.getByText(fr.site.eventsCell(1, 1))).toBeVisible()
    expect(alpha.getByText(fr.site.storageOf('1 Mo', '5 Go'))).toBeVisible()

    const beta = within(within(table).getByRole('row', { name: /Bureau Beta/ }))
    expect(beta.getByText(fr.site.statusSuspended)).toBeVisible()
    expect(beta.getByText(`2 Mo · ${fr.site.noCeiling}`)).toBeVisible()

    // Winding down outranks the suspension that came with it: it is what the operator must know.
    const gamma = within(within(table).getByRole('row', { name: /Cabinet Gamma/ }))
    expect(gamma.getByText(fr.site.statusOffboarding)).toBeVisible()
    expect(gamma.queryByText(fr.site.statusSuspended)).toBeNull()
  })

  it('links each client to its own page', async () => {
    openConsole('/admin/site', withClients(aSiteClient()))

    const link = await screen.findByRole('link', { name: 'Atelier Alpha' })

    expect(link).toHaveAttribute('href', `/admin/site/clients/${CLIENT_ID}`)
  })

  it('reads the next page with the cursor the server gave, and keeps the rows already read', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient()], next: CLIENT_ID })
      .mockResolvedValueOnce({
        items: [aSiteClient({ id: OTHER_CLIENT_ID, name: 'Bureau Beta' })],
        next: null,
      })

    openConsole('/admin/site', consoleApi({ siteClients }))
    await userEvent.click(await screen.findByRole('button', { name: fr.site.more }))

    expect(await screen.findByRole('link', { name: 'Bureau Beta' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Atelier Alpha' })).toBeVisible()
    expect(siteClients).toHaveBeenLastCalledWith({ after: CLIENT_ID }, undefined)
    expect(screen.queryByRole('button', { name: fr.site.more })).toBeNull()
  })

  it('says the next page could not be read without taking away the rows already read', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient()], next: CLIENT_ID })
      .mockRejectedValueOnce(new ApiError(0, 'network'))

    openConsole('/admin/site', consoleApi({ siteClients }))
    await userEvent.click(await screen.findByRole('button', { name: fr.site.more }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.getByRole('link', { name: 'Atelier Alpha' })).toBeVisible()
  })
})

describe('what the console prints', () => {
  it('prints only the fields it declares, whatever else an answer carries', async () => {
    // The server sends none of these (docs/SECURITY.md §18, and its contract sweep holds it to
    // that). This is the screen's own half: a row that did carry a slug or a caption, through a
    // server regression, is still not something the screen knows how to show.
    const planted = {
      ...aSiteClient(),
      slug: 'PLANTED-SLUG',
      joinCode: 'PLANTED-CODE',
      eventName: 'PLANTED-EVENT',
      caption: 'PLANTED-CAPTION',
      displayName: 'PLANTED-GUEST',
      contactEmail: 'planted@contact.example',
    }

    openConsole('/admin/site', withClients(planted))
    await screen.findByRole('table')

    expect(document.body).not.toHaveTextContent(/PLANTED/)
    expect(document.body).not.toHaveTextContent('planted@contact.example')
  })

  it('draws no photograph and no video, and asks for nothing outside the operator’s namespace', async () => {
    const api = withClients(aSiteClient())

    const { container } = openConsole('/admin/site', api)
    await screen.findByRole('table')

    expect(container.querySelectorAll('img, video, picture, canvas, audio')).toHaveLength(0)
    expect(callsOutsideTheConsole(api)).toEqual([])
  })
})

describe('opening a client', () => {
  const defaults = aSiteClientDefaults({
    maxEvents: 1,
    maxEventsPerPeriod: 6,
    maxTotalBytes: 5_000_000_000,
    maxRetentionDays: 30,
  })

  const openForm = async (api: Api) => {
    openConsole('/admin/site', api)
    await userEvent.click(await screen.findByRole('button', { name: fr.site.newClient }))
    return screen.findByRole('heading', { name: fr.site.newClientTitle })
  }

  const fill = async (name = 'Atelier Alpha', email = 'camille@example.com') => {
    await userEvent.type(screen.getByLabelText(fr.site.clientName), name)
    await userEvent.type(screen.getByLabelText(fr.site.ownerEmail), email)
  }

  const submit = () => userEvent.click(screen.getByRole('button', { name: fr.site.createClient }))

  it('starts the ceilings from what the box gives a new client, so the form shows what it would provision', async () => {
    const api = consoleApi({ siteClientDefaults: vi.fn(async () => defaults) })

    await openForm(api)

    expect(await screen.findByLabelText(fr.site.maxEvents)).toHaveValue('1')
    expect(screen.getByLabelText(fr.site.maxEventsPerPeriod)).toHaveValue('6')
    expect(screen.getByLabelText(fr.site.maxTotalGigabytes)).toHaveValue('5')
    expect(screen.getByLabelText(fr.site.maxRetentionDays)).toHaveValue('30')
    expect(screen.getByLabelText(fr.site.maxLiveDays)).toHaveValue('')
  })

  it('opens a client left at the defaults without naming a single ceiling, so the server applies its own', async () => {
    const api = consoleApi({ siteClientDefaults: vi.fn(async () => defaults) })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)

    await fill()
    await submit()

    await waitFor(() => expect(api.siteProvisionClient).toHaveBeenCalledTimes(1))
    expect(api.siteProvisionClient).toHaveBeenCalledWith({
      clientName: 'Atelier Alpha',
      ownerEmail: 'camille@example.com',
      locale: 'fr',
    })
  })

  it('sends the ceilings the operator changed, an emptied one as null, and the language of the invitation', async () => {
    const api = consoleApi({ siteClientDefaults: vi.fn(async () => defaults) })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)

    await fill()
    await userEvent.clear(screen.getByLabelText(fr.site.maxEvents))
    await userEvent.type(screen.getByLabelText(fr.site.maxEvents), '2')
    await userEvent.clear(screen.getByLabelText(fr.site.maxRetentionDays))
    await userEvent.selectOptions(screen.getByLabelText(fr.site.inviteLanguage), 'de')
    await submit()

    await waitFor(() => expect(api.siteProvisionClient).toHaveBeenCalledTimes(1))
    expect(api.siteProvisionClient).toHaveBeenCalledWith({
      clientName: 'Atelier Alpha',
      ownerEmail: 'camille@example.com',
      locale: 'de',
      ceilings: { maxEvents: 2, maxRetentionDays: null },
    })
  })

  it('names a box that is not a number, and sends nothing', async () => {
    const api = consoleApi({ siteClientDefaults: vi.fn(async () => defaults) })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)

    await fill()
    await userEvent.clear(screen.getByLabelText(fr.site.maxEvents))
    await userEvent.type(screen.getByLabelText(fr.site.maxEvents), 'beaucoup')
    await submit()

    expect(await screen.findByText(fr.site.notANumber)).toBeVisible()
    expect(api.siteProvisionClient).not.toHaveBeenCalled()
  })

  it('tells the operator the invitation went by mail, to the address they typed, and lists the client again', async () => {
    const api = consoleApi({
      siteClientDefaults: vi.fn(async () => defaults),
      siteProvisionClient: vi.fn(async () => ({
        clientId: CLIENT_ID,
        invitation: aSiteInvitation({ delivery: 'mail' }),
      })),
    })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)

    await fill('Atelier Alpha', 'camille@example.com')
    await submit()

    expect(await screen.findByText(fr.site.clientCreated)).toBeVisible()
    expect(screen.getByText(fr.site.invitationMailed('camille@example.com'))).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.site.newClientTitle })).toBeNull()
    await waitFor(() => expect(api.siteClients).toHaveBeenCalledTimes(2))
  })

  it('hands the operator the link, once, when no mail went out, and drops it when the box is closed', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) }
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    const api = consoleApi({
      siteClientDefaults: vi.fn(async () => defaults),
      siteProvisionClient: vi.fn(async () => ({
        clientId: CLIENT_ID,
        invitation: aLinkInvitation('https://photos.example.test/invite/UN-JETON'),
      })),
    })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)
    await fill()
    await submit()

    expect(await screen.findByText(fr.site.invitationLinkTitle)).toBeVisible()
    expect(screen.getByText('https://photos.example.test/invite/UN-JETON')).toBeVisible()

    // Shown, never opened and never kept: not a link to press, not in storage, not in the address.
    expect(document.querySelector('a[href*="UN-JETON"]')).toBeNull()
    expect(screen.queryByRole('link', { name: /UN-JETON/ })).toBeNull()
    expect(JSON.stringify({ ...localStorage })).not.toContain('UN-JETON')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('UN-JETON')
    expect(window.location.href).not.toContain('UN-JETON')

    await userEvent.click(screen.getByRole('button', { name: fr.site.copyLink }))
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(
        'https://photos.example.test/invite/UN-JETON',
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: fr.app.close }))

    expect(screen.queryByText('https://photos.example.test/invite/UN-JETON')).toBeNull()
  })

  it('prints no link when the invitation went by mail, even if an answer carried one it should not have', async () => {
    // The server sends a link only where no mail went out. A mail delivery that carries one is a
    // server regression, and the screen does not turn it into something to copy and paste.
    const api = consoleApi({
      siteClientDefaults: vi.fn(async () => defaults),
      siteProvisionClient: vi.fn(async () => ({
        clientId: CLIENT_ID,
        // The type cannot hold a mail delivery with a link: this is the answer of a server that regressed.
        invitation: {
          ...aSiteInvitation({ delivery: 'mail' }),
          link: 'https://photos.example.test/invite/PLANTED-TOKEN',
        } as unknown as OperatorInvitationDto,
      })),
    })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)
    await fill()
    await submit()

    await screen.findByText(fr.site.clientCreated)

    expect(screen.queryByText(fr.site.invitationLinkTitle)).toBeNull()
    expect(document.body).not.toHaveTextContent(/PLANTED-TOKEN|https?:\/\//)
  })

  it('asks the operator to confirm themselves when the server says so, and opens the client on that confirmation', async () => {
    const siteProvisionClient = vi
      .fn<Api['siteProvisionClient']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ clientId: CLIENT_ID, invitation: aSiteInvitation() })
    const api = consoleApi({
      siteClientDefaults: vi.fn(async () => defaults),
      siteProvisionClient,
    })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)
    await fill()
    await submit()

    const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
    await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
    await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))

    expect(await screen.findByText(fr.site.clientCreated)).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledWith('le mot de passe', { code: '123456' })
    expect(siteProvisionClient).toHaveBeenCalledTimes(2)
  })

  it('keeps the form, with what was typed, and the server’s sentence when it refuses the name', async () => {
    const api = consoleApi({
      siteClientDefaults: vi.fn(async () => defaults),
      siteProvisionClient: vi.fn(async () => {
        throw new ApiError(400, 'clientName.empty')
      }),
    })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)
    // A blank name is the server's to refuse: the browser's "required" lets a space through.
    await fill(' ')
    await submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.errors['clientName.empty'])
    expect(screen.getByLabelText(fr.site.ownerEmail)).toHaveValue('camille@example.com')
  })

  it('says it could not read the defaults, with a retry, rather than showing a form of blanks', async () => {
    const siteClientDefaults = vi
      .fn<Api['siteClientDefaults']>()
      .mockRejectedValueOnce(new ApiError(500, 'server.unexpected'))
      .mockResolvedValue(defaults)
    const api = consoleApi({ siteClientDefaults })
    openConsole('/admin/site', api)

    await userEvent.click(await screen.findByRole('button', { name: fr.site.newClient }))
    const failure = await screen.findByText(fr.app.loadFailed)
    expect(screen.queryByLabelText(fr.site.maxEvents)).toBeNull()

    await userEvent.click(
      within(failure.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: fr.app.retry,
      }),
    )

    expect(await screen.findByLabelText(fr.site.maxEvents)).toHaveValue('1')
  })

  it('reads the clients again from the first page once one is opened, and drops the rows of the old read', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient()], next: CLIENT_ID })
      .mockResolvedValueOnce({
        items: [aSiteClient({ id: OTHER_CLIENT_ID, name: 'Bureau Beta' })],
        next: null,
      })
      .mockResolvedValue({ items: [aSiteClient({ name: 'Atelier Alpha 2' })], next: CLIENT_ID })
    const api = consoleApi({ siteClients, siteClientDefaults: vi.fn(async () => defaults) })
    openConsole('/admin/site', api)
    await userEvent.click(await screen.findByRole('button', { name: fr.site.more }))
    await screen.findByRole('link', { name: 'Bureau Beta' })

    await userEvent.click(screen.getByRole('button', { name: fr.site.newClient }))
    await screen.findByLabelText(fr.site.maxEvents)
    await fill('Atelier Omega', 'omega@example.com')
    await submit()

    expect(await screen.findByRole('link', { name: 'Atelier Alpha 2' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Bureau Beta' })).toBeNull()
  })

  it('forgets a refusal of the next page once the listing is read again from its first page', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient()], next: CLIENT_ID })
      .mockRejectedValueOnce(new ApiError(0, 'network'))
      .mockResolvedValue({ items: [aSiteClient({ name: 'Atelier Alpha 2' })], next: null })
    const api = consoleApi({ siteClients, siteClientDefaults: vi.fn(async () => defaults) })
    openConsole('/admin/site', api)
    await userEvent.click(await screen.findByRole('button', { name: fr.site.more }))
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)

    await userEvent.click(screen.getByRole('button', { name: fr.site.newClient }))
    await screen.findByLabelText(fr.site.maxEvents)
    await fill('Atelier Omega', 'omega@example.com')
    await submit()

    expect(await screen.findByRole('link', { name: 'Atelier Alpha 2' })).toBeVisible()
    expect(screen.queryByText(fr.errors.network)).toBeNull()
  })

  it('closes the form without opening anything when the operator cancels', async () => {
    const api = consoleApi({ siteClientDefaults: vi.fn(async () => defaults) })
    await openForm(api)
    await screen.findByLabelText(fr.site.maxEvents)

    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(screen.queryByRole('heading', { name: fr.site.newClientTitle })).toBeNull()
    expect(api.siteProvisionClient).not.toHaveBeenCalled()
  })
})
