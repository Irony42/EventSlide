import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { ApiError } from '../../lib/http'
import type { Api } from '../../lib/api/client'
import type { SiteClientDto } from '../../lib/api/dto'
import {
  aSiteClient,
  aSiteEvent,
  aSiteInvitation,
  CLIENT_ID,
  EVENT_ID,
  noCeilings,
  OTHER_CLIENT_ID,
} from '../../testing/siteFixtures'
import {
  consoleApi,
  NEVER_FROM_THE_CONSOLE,
  openConsole,
  stepUpRequired,
} from '../../testing/siteConsole'

/**
 * One client's page: what it is using, the acts on the client itself, its ceilings and the reason
 * for changing them, an invitation into its account, and its events as shapes and sizes.
 *
 * Ring 5, through the route table. The writes of this page are the console's whole purpose, so each
 * one is held at its three edges: it is sent with exactly what the operator chose, it is refused
 * with the server's own sentence, and it asks for a confirmation when the server says it must.
 */

const SUSPENDED_AT = '2026-06-21T10:00:00.000Z'

const withClient = (client: SiteClientDto = aSiteClient(), extra: Partial<Api> = {}) =>
  consoleApi({
    siteClients: vi.fn(async () => ({ items: [client], next: null })),
    siteClientEvents: vi.fn(async () => ({ items: [aSiteEvent()], next: null })),
    ...extra,
  })

const open = (api: Api) => openConsole(`/admin/site/clients/${CLIENT_ID}`, api)

const heading = () => screen.findByRole('heading', { level: 1, name: 'Atelier Alpha' })

const dialog = (name: string) => screen.findByRole('dialog', { name })

/** Confirms the person in the prompt the server asked for. */
const confirmYourself = async () => {
  const prompt = await dialog(fr.site.stepUpTitle)
  await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
  await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
  await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))
}

describe('a client’s page: reading it', () => {
  it('waits, saying so, while the client is on its way', async () => {
    const api = consoleApi({ siteClients: vi.fn(() => new Promise<never>(() => {})) })

    open(api)

    await screen.findByRole('link', { name: fr.site.allClients })
    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('says it could not read the client, with a retry that reads it again', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockRejectedValueOnce(new ApiError(500, 'server.unexpected'))
      .mockResolvedValue({ items: [aSiteClient()], next: null })

    open(
      consoleApi({ siteClients, siteClientEvents: vi.fn(async () => ({ items: [], next: null })) }),
    )

    const failure = await screen.findByRole('alert')
    await userEvent.click(within(failure).getByRole('button', { name: fr.app.retry }))

    expect(await heading()).toBeVisible()
  })

  it('says the client does not exist, in the server’s words, for an id nobody holds', async () => {
    open(consoleApi({ siteClients: vi.fn(async () => ({ items: [], next: null })) }))

    expect(await screen.findByRole('heading', { name: fr.errors['client.notFound'] })).toBeVisible()
    expect(screen.getAllByRole('link', { name: fr.site.allClients }).length).toBeGreaterThan(0)
  })

  it('finds a client that is not on the first page of the listing, by following the cursor', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({
        items: [aSiteClient({ id: OTHER_CLIENT_ID })],
        next: OTHER_CLIENT_ID,
      })
      .mockResolvedValue({ items: [aSiteClient()], next: null })

    open(
      consoleApi({
        siteClients,
        siteClientEvents: vi.fn(async () => ({ items: [], next: null })),
      }),
    )

    expect(await heading()).toBeVisible()
    expect(siteClients).toHaveBeenLastCalledWith(
      { after: OTHER_CLIENT_ID, limit: 200 },
      expect.anything(),
    )
  })

  it('shows what the client holds and how much of each ceiling it uses', async () => {
    open(withClient())
    await heading()

    expect(screen.getAllByText(fr.site.eventsCell(1, 1)).length).toBeGreaterThan(0)
    expect(screen.getByText(fr.site.memberCount(2))).toBeVisible()
    expect(screen.getByText(fr.site.storageOf('1 Mo', '5 Go'))).toBeVisible()
    expect(screen.getByRole('progressbar', { name: fr.site.storageColumn })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: fr.site.eventsColumn })).toBeVisible()
  })

  it('says a client has no storage ceiling rather than drawing a meter against nothing', async () => {
    open(withClient(aSiteClient({ ceilings: noCeilings() })))
    await heading()

    expect(screen.getByText(`1 Mo · ${fr.site.noCeiling}`)).toBeVisible()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('says since when a client is suspended, and when its albums will be purged', async () => {
    open(
      withClient(
        aSiteClient({ suspendedAt: SUSPENDED_AT, purgeAfter: '2026-07-21T10:00:00.000Z' }),
      ),
    )
    await heading()

    expect(screen.getByText(fr.site.statusOffboarding)).toBeVisible()
    expect(screen.getByText(/Suspendu depuis le/)).toBeVisible()
    expect(screen.getByText(/Les albums seront purgés le/)).toBeVisible()
  })

  it('points at this client’s slice of the log', async () => {
    open(withClient())

    const link = await screen.findByRole('link', { name: fr.site.auditLink })

    expect(link).toHaveAttribute('href', `/admin/site/audit?clientId=${CLIENT_ID}`)
  })

  it('draws no photograph and asks for nothing outside the operator’s namespace', async () => {
    const api = withClient()

    const { container } = open(api)
    await heading()
    await screen.findByRole('table', { name: fr.site.eventsTableLabel })

    expect(container.querySelectorAll('img, video, picture, canvas, audio')).toHaveLength(0)
    for (const method of NEVER_FROM_THE_CONSOLE) {
      expect(api[method], `${method} was asked for`).not.toHaveBeenCalled()
    }
  })
})

describe('a client’s page: its events', () => {
  it('shows each event as a shape and a size, told apart by the start of its id and by nothing a person wrote', async () => {
    const planted = {
      ...aSiteEvent(),
      name: 'PLANTED-NAME',
      slug: 'PLANTED-SLUG',
      joinCode: 'PLANTED-CODE',
      caption: 'PLANTED-CAPTION',
    }
    open(
      withClient(aSiteClient(), {
        siteClientEvents: vi.fn(async () => ({ items: [planted], next: null })),
      }),
    )

    const table = await screen.findByRole('table', { name: fr.site.eventsTableLabel })
    const row = within(within(table).getByRole('row', { name: new RegExp(EVENT_ID.slice(0, 8)) }))

    expect(row.getByText(fr.site.eventStatuses.live)).toBeVisible()
    expect(row.getByText(fr.site.photoCount(42))).toBeVisible()
    expect(row.getByText(fr.site.storageOf('500 Mo', '2 Go'))).toBeVisible()
    expect(document.body).not.toHaveTextContent(/PLANTED/)
  })

  it('says the client has no event rather than drawing an empty table', async () => {
    open(
      withClient(aSiteClient(), {
        siteClientEvents: vi.fn(async () => ({ items: [], next: null })),
      }),
    )

    expect(await screen.findByText(fr.site.eventsEmpty)).toBeVisible()
    expect(screen.queryByRole('table', { name: fr.site.eventsTableLabel })).toBeNull()
  })

  it('says it could not read the events, and keeps the rest of the page', async () => {
    const siteClientEvents = vi
      .fn<Api['siteClientEvents']>()
      .mockRejectedValueOnce(new ApiError(404, 'client.notFound'))
      .mockResolvedValue({ items: [aSiteEvent()], next: null })
    open(withClient(aSiteClient(), { siteClientEvents }))

    expect(await screen.findByText(fr.admin.loadFailed)).toBeVisible()
    expect(await heading()).toBeVisible()

    const alert = screen.getByText(fr.admin.loadFailed).closest('[role="alert"]') as HTMLElement
    await userEvent.click(within(alert).getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('table', { name: fr.site.eventsTableLabel })).toBeVisible()
  })

  it('reads the next page of events with the cursor the server gave', async () => {
    const siteClientEvents = vi
      .fn<Api['siteClientEvents']>()
      .mockResolvedValueOnce({ items: [aSiteEvent()], next: EVENT_ID })
      .mockResolvedValueOnce({
        items: [aSiteEvent({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'archived' })],
        next: null,
      })
    open(withClient(aSiteClient(), { siteClientEvents }))

    await userEvent.click(await screen.findByRole('button', { name: fr.site.more }))

    expect(await screen.findByText(fr.site.eventStatuses.archived)).toBeVisible()
    expect(siteClientEvents).toHaveBeenLastCalledWith(CLIENT_ID, { after: EVENT_ID }, undefined)
  })
})

describe('a client’s page: freezing it', () => {
  const press = async (name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }))
    return dialog(name === fr.site.suspend ? fr.site.suspendTitle : fr.site.resumeTitle)
  }

  it('says what a suspension does, and does not, before it is confirmed', async () => {
    open(withClient())
    await heading()

    const confirm = await press(fr.site.suspend)

    expect(confirm).toHaveAccessibleDescription(fr.site.suspendBody)
  })

  it('suspends the client on a confirmation, says so, and reads it again', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient()], next: null })
      .mockResolvedValue({ items: [aSiteClient({ suspendedAt: SUSPENDED_AT })], next: null })
    const api = withClient(aSiteClient(), { siteClients })
    open(api)
    await heading()

    const confirm = await press(fr.site.suspend)
    await userEvent.click(within(confirm).getByRole('button', { name: fr.site.suspend }))

    await waitFor(() => expect(api.siteSuspendClient).toHaveBeenCalledWith(CLIENT_ID))
    expect(await screen.findByText(fr.site.suspended)).toBeVisible()
    expect(await screen.findByRole('button', { name: fr.site.resume })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.site.suspend })).toBeNull()
  })

  it('sends nothing when the confirmation is declined', async () => {
    const api = withClient()
    open(api)
    await heading()

    const confirm = await press(fr.site.suspend)
    await userEvent.click(within(confirm).getByRole('button', { name: fr.app.cancel }))

    expect(api.siteSuspendClient).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks the operator to confirm themselves when the server says so, and suspends on that confirmation', async () => {
    const siteSuspendClient = vi
      .fn<Api['siteSuspendClient']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue(undefined)
    const api = withClient(aSiteClient(), { siteSuspendClient })
    open(api)
    await heading()

    const confirm = await press(fr.site.suspend)
    await userEvent.click(within(confirm).getByRole('button', { name: fr.site.suspend }))
    await confirmYourself()

    expect(await screen.findByText(fr.site.suspended)).toBeVisible()
    expect(api.stepUp).toHaveBeenCalledWith('le mot de passe', { code: '123456' })
    expect(siteSuspendClient).toHaveBeenCalledTimes(2)
  })

  it('does not suspend, and does not scold, when the operator walks away from the prompt', async () => {
    const siteSuspendClient = vi.fn<Api['siteSuspendClient']>().mockRejectedValue(stepUpRequired())
    open(withClient(aSiteClient(), { siteSuspendClient }))
    await heading()

    const confirm = await press(fr.site.suspend)
    await userEvent.click(within(confirm).getByRole('button', { name: fr.site.suspend }))
    const prompt = await dialog(fr.site.stepUpTitle)
    await userEvent.click(within(prompt).getByRole('button', { name: fr.app.cancel }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(siteSuspendClient).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(fr.errors['auth.stepUpRequired'])).toBeNull()
    expect(screen.queryByText(fr.site.suspended)).toBeNull()
  })

  it('says what the server said when it refuses, and leaves the client as it was', async () => {
    const siteSuspendClient = vi
      .fn<Api['siteSuspendClient']>()
      .mockRejectedValue(new ApiError(404, 'client.notFound'))
    open(withClient(aSiteClient(), { siteSuspendClient }))
    await heading()

    const confirm = await press(fr.site.suspend)
    await userEvent.click(within(confirm).getByRole('button', { name: fr.site.suspend }))

    expect(await screen.findByText(fr.errors['client.notFound'])).toBeVisible()
    expect(screen.getByRole('button', { name: fr.site.suspend })).toBeVisible()
  })

  it('lifts the suspension of a suspended client, on a confirmation', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient({ suspendedAt: SUSPENDED_AT })], next: null })
      .mockResolvedValue({ items: [aSiteClient()], next: null })
    const api = withClient(aSiteClient(), { siteClients })
    open(api)
    await heading()

    const confirm = await press(fr.site.resume)
    expect(confirm).toHaveAccessibleDescription(fr.site.resumeBody)
    await userEvent.click(within(confirm).getByRole('button', { name: fr.site.resume }))

    await waitFor(() => expect(api.siteResumeClient).toHaveBeenCalledWith(CLIENT_ID))
    expect(await screen.findByText(fr.site.resumed)).toBeVisible()
    expect(await screen.findByRole('button', { name: fr.site.suspend })).toBeVisible()
  })

  it('offers neither to a client whose engagement is ending, because the server would refuse to lift it', async () => {
    open(
      withClient(
        aSiteClient({ suspendedAt: SUSPENDED_AT, purgeAfter: '2026-07-21T10:00:00.000Z' }),
      ),
    )
    await heading()

    expect(screen.queryByRole('button', { name: fr.site.suspend })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.site.resume })).toBeNull()
  })
})

describe('a client’s page: renaming it', () => {
  const openRename = async (api: Api) => {
    open(api)
    await heading()
    await userEvent.click(screen.getByRole('button', { name: fr.site.rename }))
    return screen.findByLabelText(fr.site.renameTitle)
  }

  it('renames the client with the name typed, trimmed, and reads it again', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [aSiteClient()], next: null })
      .mockResolvedValue({ items: [aSiteClient({ name: 'Atelier Omega' })], next: null })
    const api = withClient(aSiteClient(), { siteClients })
    const input = await openRename(api)
    expect(input).toHaveValue('Atelier Alpha')

    await userEvent.clear(input)
    await userEvent.type(input, '  Atelier Omega  ')
    await userEvent.click(
      within(input.closest('form') as HTMLElement).getByRole('button', { name: fr.site.rename }),
    )

    await waitFor(() =>
      expect(api.siteRenameClient).toHaveBeenCalledWith(CLIENT_ID, 'Atelier Omega'),
    )
    expect(await screen.findByText(fr.site.renamed)).toBeVisible()
    expect(await screen.findByRole('heading', { level: 1, name: 'Atelier Omega' })).toBeVisible()
  })

  it('keeps the form, with the name typed, and the server’s sentence when it refuses the name', async () => {
    const siteRenameClient = vi
      .fn<Api['siteRenameClient']>()
      .mockRejectedValue(new ApiError(400, 'clientName.tooLong'))
    const input = await openRename(withClient(aSiteClient(), { siteRenameClient }))

    await userEvent.type(input, ' et fils')
    await userEvent.click(
      within(input.closest('form') as HTMLElement).getByRole('button', { name: fr.site.rename }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['clientName.tooLong'])
    expect(input).toHaveValue('Atelier Alpha et fils')
  })
})

describe('a client’s page: changing its ceilings', () => {
  const client = aSiteClient({
    ceilings: { ...noCeilings(), maxEvents: 3, maxTotalBytes: 5_000_000_000 },
  })

  const save = () => userEvent.click(screen.getByRole('button', { name: fr.site.ceilingsSave }))

  const openCeilings = async (api: Api) => {
    open(api)
    await heading()
    return screen.findByLabelText(fr.site.maxEvents)
  }

  it('starts from what the client has, an empty box meaning no ceiling', async () => {
    const maxEvents = await openCeilings(withClient(client))

    expect(maxEvents).toHaveValue('3')
    expect(screen.getByLabelText(fr.site.maxTotalGigabytes)).toHaveValue('5')
    expect(screen.getByLabelText(fr.site.maxRetentionDays)).toHaveValue('')
    expect(screen.getByLabelText(fr.site.clipsAllowed)).toBeChecked()
  })

  it('sends only what changed, with the reason, and says the limits were saved', async () => {
    const api = withClient(client)
    const maxEvents = await openCeilings(api)

    await userEvent.clear(maxEvents)
    await userEvent.type(maxEvents, '5')
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Capacité supplémentaire')
    await save()

    await waitFor(() =>
      expect(api.siteSetCeilings).toHaveBeenCalledWith(
        CLIENT_ID,
        { maxEvents: 5 },
        'Capacité supplémentaire',
      ),
    )
    expect(await screen.findByText(fr.site.ceilingsSaved)).toBeVisible()
  })

  it('sends a ceiling removed as null and a switch turned off as false', async () => {
    const api = withClient(client)
    await openCeilings(api)

    await userEvent.clear(screen.getByLabelText(fr.site.maxTotalGigabytes))
    await userEvent.click(screen.getByLabelText(fr.site.clipsAllowed))
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Abus de vidéos')
    await save()

    await waitFor(() =>
      expect(api.siteSetCeilings).toHaveBeenCalledWith(
        CLIENT_ID,
        { maxTotalBytes: null, clipsAllowed: false },
        'Abus de vidéos',
      ),
    )
  })

  it('renews the period with an instant, and nothing else, when asked', async () => {
    const api = withClient(client)
    await openCeilings(api)

    await userEvent.click(screen.getByLabelText(fr.site.renewPeriod))
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Nouvelle période')
    await save()

    await waitFor(() => expect(api.siteSetCeilings).toHaveBeenCalledTimes(1))
    expect(api.siteSetCeilings).toHaveBeenCalledWith(
      CLIENT_ID,
      { periodStartedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) as string },
      'Nouvelle période',
    )
  })

  it('sends nothing, and says so, when no ceiling changed: a reason for no change is a line about nothing', async () => {
    const api = withClient(client)
    await openCeilings(api)

    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Rien du tout')
    await save()

    expect(await screen.findByText(fr.site.ceilingsUnchanged)).toBeVisible()
    expect(api.siteSetCeilings).not.toHaveBeenCalled()
  })

  it('names a box that is not a number and sends nothing', async () => {
    const api = withClient(client)
    const maxEvents = await openCeilings(api)

    await userEvent.clear(maxEvents)
    await userEvent.type(maxEvents, 'beaucoup')
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Capacité')
    await save()

    expect(await screen.findByText(fr.site.notANumber)).toBeVisible()
    expect(api.siteSetCeilings).not.toHaveBeenCalled()
  })

  it('sends a reason the browser would accept and leaves the judging of it to the server, which says why', async () => {
    const siteSetCeilings = vi
      .fn<Api['siteSetCeilings']>()
      .mockRejectedValue(new ApiError(400, 'audit.reasonInvalid', { max: 200 }))
    const api = withClient(client, { siteSetCeilings })
    const maxEvents = await openCeilings(api)

    await userEvent.clear(maxEvents)
    await userEvent.type(maxEvents, '4')
    // A reason with an address in it: the server refuses it, and its sentence is what is shown.
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'camille@example.com paie')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['audit.reasonInvalid'])
    expect(maxEvents).toHaveValue('4')
    expect(screen.getByLabelText(fr.site.ceilingsReason)).toHaveValue('camille@example.com paie')
  })

  it('shows the bounds the server refuses a ceiling for, in its words', async () => {
    const siteSetCeilings = vi
      .fn<Api['siteSetCeilings']>()
      .mockRejectedValue(new ApiError(400, 'clientCeilings.maxRetentionDaysInvalid'))
    const api = withClient(client, { siteSetCeilings })
    await openCeilings(api)

    await userEvent.type(screen.getByLabelText(fr.site.maxRetentionDays), '99999')
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Capacité')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['clientCeilings.maxRetentionDaysInvalid'],
    )
  })

  it('asks the operator to confirm themselves when the server says so, and saves on that confirmation', async () => {
    const siteSetCeilings = vi
      .fn<Api['siteSetCeilings']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ ceilings: client.ceilings, eventsCreatedInPeriod: 0 })
    const api = withClient(client, { siteSetCeilings })
    const maxEvents = await openCeilings(api)

    await userEvent.clear(maxEvents)
    await userEvent.type(maxEvents, '4')
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Capacité')
    await save()
    await confirmYourself()

    expect(await screen.findByText(fr.site.ceilingsSaved)).toBeVisible()
    expect(siteSetCeilings).toHaveBeenCalledTimes(2)
    expect(siteSetCeilings).toHaveBeenNthCalledWith(2, CLIENT_ID, { maxEvents: 4 }, 'Capacité')
  })

  it('reads the saved ceilings back into the form and empties the reason', async () => {
    const siteClients = vi
      .fn<Api['siteClients']>()
      .mockResolvedValueOnce({ items: [client], next: null })
      .mockResolvedValue({
        items: [aSiteClient({ ceilings: { ...client.ceilings, maxEvents: 8 } })],
        next: null,
      })
    const api = withClient(client, { siteClients })
    const maxEvents = await openCeilings(api)

    await userEvent.clear(maxEvents)
    await userEvent.type(maxEvents, '8')
    await userEvent.type(screen.getByLabelText(fr.site.ceilingsReason), 'Capacité')
    await save()

    await screen.findByText(fr.site.ceilingsSaved)
    await waitFor(() => expect(screen.getByLabelText(fr.site.maxEvents)).toHaveValue('8'))
    expect(screen.getByLabelText(fr.site.ceilingsReason)).toHaveValue('')
  })
})

describe('a client’s page: inviting into its account', () => {
  const invite = async (email = 'sacha@example.com') => {
    await userEvent.type(await screen.findByLabelText(fr.site.inviteEmail), email)
    await userEvent.click(screen.getByRole('button', { name: fr.site.inviteSend }))
  }

  const openInvite = async (api: Api) => {
    open(api)
    await heading()
  }

  it('invites a member in the language of the console, and says it went by mail to the address typed', async () => {
    const api = withClient()
    await openInvite(api)

    await invite()

    await waitFor(() =>
      expect(api.siteInviteToClient).toHaveBeenCalledWith(CLIENT_ID, {
        email: 'sacha@example.com',
        role: 'member',
        locale: 'fr',
      }),
    )
    expect(await screen.findByText(fr.site.invitationMailed('sacha@example.com'))).toBeVisible()
  })

  it('invites an owner, in the language chosen', async () => {
    const api = withClient()
    await openInvite(api)

    await userEvent.selectOptions(await screen.findByLabelText(fr.site.inviteRole), 'owner')
    await userEvent.selectOptions(screen.getByLabelText(fr.site.inviteLanguage), 'it')
    await invite()

    await waitFor(() =>
      expect(api.siteInviteToClient).toHaveBeenCalledWith(CLIENT_ID, {
        email: 'sacha@example.com',
        role: 'owner',
        locale: 'it',
      }),
    )
  })

  it('says an invitation is waiting for an owner of the client, rather than leaving the operator to wonder', async () => {
    const api = withClient(aSiteClient(), {
      siteInviteToClient: vi.fn(async () => ({
        invitation: aSiteInvitation({ pendingApproval: true }),
      })),
    })
    await openInvite(api)

    await invite()

    expect(await screen.findByText(fr.site.invitationPending)).toBeVisible()
  })

  it('hands the operator the link where no mail went out', async () => {
    const api = withClient(aSiteClient(), {
      siteInviteToClient: vi.fn(async () => ({
        invitation: aSiteInvitation({
          delivery: 'link',
          link: 'https://photos.example.test/invite/UN-JETON',
        }),
      })),
    })
    await openInvite(api)

    await invite()

    expect(await screen.findByText('https://photos.example.test/invite/UN-JETON')).toBeVisible()
    expect(screen.getByText(fr.site.invitationLinkBody)).toBeVisible()
  })

  it('says what the server said when the address has had its five an hour', async () => {
    const api = withClient(aSiteClient(), {
      siteInviteToClient: vi.fn(async () => {
        throw new ApiError(429, 'invitation.tooManyForAddress')
      }),
    })
    await openInvite(api)

    await invite()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['invitation.tooManyForAddress'],
    )
  })

  it('asks the operator to confirm themselves when the server says so, and invites on that confirmation', async () => {
    const siteInviteToClient = vi
      .fn<Api['siteInviteToClient']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ invitation: aSiteInvitation() })
    await openInvite(withClient(aSiteClient(), { siteInviteToClient }))

    await invite()
    await confirmYourself()

    expect(await screen.findByText(fr.site.invitationMailed('sacha@example.com'))).toBeVisible()
    expect(siteInviteToClient).toHaveBeenCalledTimes(2)
  })
})
