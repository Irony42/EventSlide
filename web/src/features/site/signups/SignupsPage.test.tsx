import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { ApiError } from '../../../lib/http'
import type { Api } from '../../../lib/api/client'
import type { SiteSignupDto, SiteSignupPageDto, SiteSignupStatus } from '../../../lib/api/dto'
import { anAbout } from '../../../testing/renderWithProviders'
import { aSiteClientDefaults, aSiteInvitation, CLIENT_ID } from '../../../testing/siteFixtures'
import {
  consoleApi,
  callsOutsideTheConsole,
  openConsole,
  stepUpRequired,
} from '../../../testing/siteConsole'

/**
 * The operator's page of signup requests (spec 31), through the route table: the entry and its
 * count, what each mode lists, and the two decisions with what they send. The server's routes
 * land in another PR: the answers here are the contract of spec 31 §5.
 */

const aSignup = (overrides: Partial<SiteSignupDto> = {}): SiteSignupDto => ({
  id: '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e',
  email: 'lea@example.org',
  clientName: 'Mariage de Léa et Hugo',
  note: 'Mariage au printemps',
  eventDate: '2027-05-15',
  locale: 'fr',
  status: 'pending',
  createdAt: '2026-11-27T08:00:00.000Z',
  confirmedAt: '2026-11-27T08:05:00.000Z',
  decidedAt: null,
  clientId: null,
  existingAccount: false,
  ...overrides,
})

/** A fake `Api` for a box with the given `SIGNUP` mode, answering each status from `byStatus`. */
const withSignups = (
  mode: 'off' | 'review' | 'open',
  byStatus: Partial<Record<SiteSignupStatus, readonly SiteSignupDto[]>> = {},
  extra: Partial<Api> = {},
) => {
  const pendingCount = byStatus.pending?.length ?? 0
  return consoleApi({
    about: vi.fn(async () =>
      anAbout({ features: { siteAdmin: true, forgotPassword: false, signup: mode } }),
    ),
    siteSignups: vi.fn(async (status: SiteSignupStatus): Promise<SiteSignupPageDto> => ({
      items: byStatus[status] ?? [],
      pendingCount,
    })),
    ...extra,
  })
}

/** A sentence as the page shows it: the French copy's no-break spaces read as spaces by the queries. */
const sentence = (text: string) => (content: string) =>
  content === text.replaceAll(String.fromCharCode(160), ' ')

const open = (api: Api) => openConsole('/admin/site/signups', api)
const confirmYourself = async () => {
  const prompt = await screen.findByRole('dialog', { name: fr.site.stepUpTitle })
  await userEvent.type(within(prompt).getByLabelText(fr.auth.password), 'le mot de passe')
  await userEvent.type(within(prompt).getByLabelText(fr.auth.secondFactorCode), '123456')
  await userEvent.click(within(prompt).getByRole('button', { name: fr.auth.stepUpSubmit }))
}

describe('the signups page: where it exists', () => {
  it('has no entry and no page, and asks for nothing, when signing up is off', async () => {
    const api = withSignups('off')

    openConsole('/admin/site', api)

    expect(await screen.findByRole('link', { name: fr.site.navClients })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: fr.siteSignups.nav })).not.toBeInTheDocument()
    expect(api.siteSignups).not.toHaveBeenCalled()
  })

  it('answers the not-found screen at its address when signing up is off', async () => {
    const api = withSignups('off')

    openConsole('/admin/site/signups', api)

    await vi.waitFor(() => expect(document.title).toBe(`${fr.titles.notFound} · ${fr.app.name}`))
    expect(screen.queryByRole('heading', { name: fr.siteSignups.title })).not.toBeInTheDocument()
    expect(api.siteSignups).not.toHaveBeenCalled()
  })

  it('shows the entry with the number of requests waiting', async () => {
    open(withSignups('review', { pending: [aSignup(), aSignup({ id: 'b' })] }))

    expect(await screen.findByRole('link', { name: fr.siteSignups.navPending(2) })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows the entry without a number when nothing waits', async () => {
    open(withSignups('review'))

    expect(await screen.findByRole('link', { name: fr.siteSignups.nav })).toBeInTheDocument()
  })
})

describe('the signups page: review mode', () => {
  it('lists the waiting requests with what the operator validates on, and flags an existing account', async () => {
    open(withSignups('review', { pending: [aSignup({ existingAccount: true })] }))

    const row = await screen.findByRole('row', { name: /lea@example\.org/ })
    expect(within(row).getByText('Mariage de Léa et Hugo')).toBeInTheDocument()
    expect(within(row).getByText('Mariage au printemps')).toBeInTheDocument()
    expect(within(row).getByText(fr.siteSignups.existingAccount)).toBeInTheDocument()
    expect(within(row).getByText('Français')).toBeInTheDocument()
  })

  it('says nothing waits', async () => {
    open(withSignups('review'))

    expect(await screen.findByText(fr.siteSignups.emptyPending)).toBeInTheDocument()
  })

  it('says it could not read, with a retry that reads again', async () => {
    const siteSignups = vi
      .fn<Api['siteSignups']>()
      .mockRejectedValue(new ApiError(500, 'server.unexpected'))
    open(withSignups('review', {}, { siteSignups }))

    const retry = await screen.findByRole('button', { name: fr.app.retry })
    const before = siteSignups.mock.calls.length
    await userEvent.click(retry)

    await vi.waitFor(() => expect(siteSignups.mock.calls.length).toBeGreaterThan(before))
  })

  it('lists the refused requests, and only those, in the second tab', async () => {
    const api = withSignups('review', {
      pending: [aSignup()],
      refused: [
        aSignup({
          id: 'r',
          email: 'non@example.org',
          status: 'refused',
          decidedAt: '2026-11-26T10:00:00.000Z',
        }),
      ],
    })
    open(api)
    await screen.findByRole('row', { name: /lea@example\.org/ })

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.tabProcessed }))

    expect(await screen.findByRole('row', { name: /non@example\.org/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /lea@example\.org/ })).not.toBeInTheDocument()
    expect(api.siteSignups).toHaveBeenCalledWith('refused', expect.anything())
  })
})

describe('the signups page: open mode', () => {
  it('lists the accounts opened, each with a link to its client page, and no held section when none is held', async () => {
    open(
      withSignups('open', {
        approved: [
          aSignup({
            status: 'approved',
            clientId: CLIENT_ID,
            decidedAt: '2026-11-27T08:06:00.000Z',
          }),
        ],
      }),
    )

    const row = await screen.findByRole('row', { name: /lea@example\.org/ })
    expect(within(row).getByRole('link', { name: fr.siteSignups.clientLink })).toHaveAttribute(
      'href',
      `/admin/site/clients/${CLIENT_ID}`,
    )
    expect(screen.queryByText(fr.siteSignups.heldHeading)).not.toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: fr.siteSignups.approve }),
    ).not.toBeInTheDocument()
  })

  it('adds the requests the disk guard held, with the decision buttons, only when there are some', async () => {
    open(
      withSignups('open', {
        approved: [],
        pending: [aSignup({ email: 'retenue@example.org' })],
      }),
    )

    expect(await screen.findByText(fr.siteSignups.heldHeading)).toBeInTheDocument()
    const row = await screen.findByRole('row', { name: /retenue@example\.org/ })
    expect(within(row).getByRole('button', { name: fr.siteSignups.approve })).toBeInTheDocument()
    expect(screen.getByText(fr.siteSignups.emptyOpened)).toBeInTheDocument()
  })
})

describe('the signups page: approving', () => {
  const ready = (extra: Partial<Api> = {}) =>
    withSignups(
      'review',
      { pending: [aSignup()] },
      {
        siteClientDefaults: vi.fn(async () => aSiteClientDefaults({ maxEvents: 1 })),
        ...extra,
      },
    )

  const startApproval = async () => {
    await userEvent.click(await screen.findByRole('button', { name: fr.siteSignups.approve }))
    await screen.findByLabelText(fr.site.maxEvents)
  }

  it('prefills the ceilings with the box’s defaults and sends none when the operator changed none', async () => {
    const api = ready()
    open(api)
    await startApproval()
    expect(screen.getByLabelText(fr.site.maxEvents)).toHaveValue('1')

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.approveConfirm }))

    await vi.waitFor(() =>
      expect(api.siteApproveSignup).toHaveBeenCalledWith(
        '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e',
        {},
      ),
    )
  })

  it('sends only the ceilings the operator changed', async () => {
    const api = ready()
    open(api)
    await startApproval()
    const field = screen.getByLabelText(fr.site.maxEvents)
    await userEvent.clear(field)
    await userEvent.type(field, '3')

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.approveConfirm }))

    await vi.waitFor(() =>
      expect(api.siteApproveSignup).toHaveBeenCalledWith('5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e', {
        ceilings: { maxEvents: 3 },
      }),
    )
  })

  it('says the person will have to sign in when the address already has an account, and not otherwise', async () => {
    const { unmount } = open(
      withSignups(
        'review',
        { pending: [aSignup({ existingAccount: true })] },
        { siteClientDefaults: vi.fn(async () => aSiteClientDefaults()) },
      ),
    )
    await startApproval()
    expect(screen.getByText(sentence(fr.siteSignups.existingAccountNotice))).toBeInTheDocument()
    unmount()

    open(ready())
    await startApproval()
    expect(
      screen.queryByText(sentence(fr.siteSignups.existingAccountNotice)),
    ).not.toBeInTheDocument()
  })

  it('tells the operator the account is open, says where the mail went, links the client and reads the list again', async () => {
    const api = ready({
      siteApproveSignup: vi.fn(async () => ({
        clientId: CLIENT_ID,
        invitation: aSiteInvitation(),
      })),
    })
    open(api)
    await startApproval()
    const reads = vi.mocked(api.siteSignups).mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.approveConfirm }))

    expect(
      await screen.findByText(sentence(fr.siteSignups.approvedDone('Mariage de Léa et Hugo'))),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: fr.siteSignups.clientLink })).toHaveAttribute(
      'href',
      `/admin/site/clients/${CLIENT_ID}`,
    )
    await vi.waitFor(() =>
      expect(vi.mocked(api.siteSignups).mock.calls.length).toBeGreaterThan(reads),
    )
  })

  it('asks the operator to confirm themselves when the server says so, then sends the same approval', async () => {
    const siteApproveSignup = vi
      .fn<Api['siteApproveSignup']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ clientId: CLIENT_ID, invitation: aSiteInvitation() })
    open(ready({ siteApproveSignup }))
    await startApproval()

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.approveConfirm }))
    await confirmYourself()

    expect(
      await screen.findByText(sentence(fr.siteSignups.approvedDone('Mariage de Léa et Hugo'))),
    ).toBeInTheDocument()
    expect(siteApproveSignup).toHaveBeenCalledTimes(2)
  })

  it('shows the server’s own sentence when it refuses, and keeps the dialog open', async () => {
    const siteApproveSignup = vi
      .fn<Api['siteApproveSignup']>()
      .mockRejectedValue(new ApiError(409, 'invitation.pendingExists'))
    open(ready({ siteApproveSignup }))
    await startApproval()

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.approveConfirm }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText(fr.site.maxEvents)).toBeInTheDocument()
  })

  it('refuses a ceiling that is not a number before sending anything', async () => {
    const api = ready()
    open(api)
    await startApproval()
    await userEvent.type(screen.getByLabelText(fr.site.maxEvents), 'x')

    await userEvent.click(screen.getByRole('button', { name: fr.siteSignups.approveConfirm }))

    expect(await screen.findByText(fr.site.notANumber)).toBeInTheDocument()
    expect(api.siteApproveSignup).not.toHaveBeenCalled()
  })
})

describe('the signups page: refusing', () => {
  const startRefusal = async (api: Api) => {
    open(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.siteSignups.refuse }))
    return screen.findByRole('dialog', {
      name: fr.siteSignups.refuseTitle('Mariage de Léa et Hugo'),
    })
  }

  it('tells the person by default, and sends that choice', async () => {
    const api = withSignups('review', { pending: [aSignup()] })
    const dialog = await startRefusal(api)
    expect(within(dialog).getByLabelText(fr.siteSignups.notify)).toBeChecked()

    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.siteSignups.refuseConfirm }),
    )

    await vi.waitFor(() =>
      expect(api.siteRefuseSignup).toHaveBeenCalledWith(
        '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e',
        true,
      ),
    )
    expect(await screen.findByText(fr.siteSignups.refusedDone)).toBeInTheDocument()
  })

  it('stays silent towards the person when the box is unchecked', async () => {
    const api = withSignups('review', { pending: [aSignup()] })
    const dialog = await startRefusal(api)
    await userEvent.click(within(dialog).getByLabelText(fr.siteSignups.notify))

    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.siteSignups.refuseConfirm }),
    )

    await vi.waitFor(() =>
      expect(api.siteRefuseSignup).toHaveBeenCalledWith(
        '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e',
        false,
      ),
    )
  })

  it('asks to confirm oneself first when the server says so', async () => {
    const siteRefuseSignup = vi
      .fn<Api['siteRefuseSignup']>()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue(undefined)
    const dialog = await startRefusal(
      withSignups('review', { pending: [aSignup()] }, { siteRefuseSignup }),
    )

    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.siteSignups.refuseConfirm }),
    )
    await confirmYourself()

    expect(await screen.findByText(fr.siteSignups.refusedDone)).toBeInTheDocument()
    expect(siteRefuseSignup).toHaveBeenCalledTimes(2)
  })
})

describe('the signups page: what it may ask', () => {
  it('stays inside the operator’s namespace', async () => {
    const api = withSignups('review', { pending: [aSignup()] })
    open(api)
    await screen.findByRole('row', { name: /lea@example\.org/ })

    expect(callsOutsideTheConsole(api)).toEqual([])
  })
})
