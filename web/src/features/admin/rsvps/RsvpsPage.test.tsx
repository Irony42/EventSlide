import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, Route, Routes } from 'react-router-dom'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import type { RsvpDto, RsvpListResponseDto } from '../../../lib/api/dto'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import {
  aGuestInviteHost,
  anEventDto,
  anRsvp,
  anRsvpStats,
  aRsvpSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { RsvpsPage } from './RsvpsPage'

const text = fr.rsvp.list
const host = fr.rsvp.host
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

const lea = anRsvp({
  id: 'r-lea',
  name: 'Léa Martin',
  answer: 'yes',
  adults: 2,
  kids: 1,
  diet: 'Sans gluten',
  message: 'On a hâte',
  updatedAt: '2026-11-22T17:30:00.000Z',
})
const tom = anRsvp({
  id: 'r-tom',
  name: 'Tom Durand',
  answer: 'maybe',
  adults: 1,
  kids: 0,
  updatedAt: '2026-11-22T16:00:00.000Z',
})
const ana = anRsvp({
  id: 'r-ana',
  name: 'Ana Lopez',
  answer: 'no',
  adults: 1,
  kids: 0,
  updatedAt: '2026-11-22T15:00:00.000Z',
})

const STATS = anRsvpStats({
  yes: { responses: 1, people: 3, adults: 2, kids: 1 },
  maybe: { responses: 1, people: 1 },
  no: { responses: 1 },
})

const list = (overrides: Partial<RsvpListResponseDto> = {}): RsvpListResponseDto => ({
  rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }),
  rsvps: [lea, tom, ana],
  stats: STATS,
  unseen: 0,
  ...overrides,
})

const answering = (response: RsvpListResponseDto, extra: Partial<Api> = {}): Api =>
  fakeApi({ rsvps: vi.fn(async () => response), ...extra })

const render = (api: Api) =>
  renderWithProviders(<RsvpsPage />, {
    api,
    route: '/admin/events/camille-et-sacha/rsvps',
    path: '/admin/events/:slug/rsvps',
  })

const signal = (type: string): void => {
  act(() => FakeEventSource.latest('the page').emitSignal(type))
}

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the replies page: reading', () => {
  it('says how many people come, with the replies behind it, the "peut-être" and the refusals', async () => {
    render(answering(list()))

    const tiles = await screen.findByRole('group', { name: text.tilesLabel })
    expect(within(tiles).getByRole('button', { name: new RegExp(text.tileYes) })).toHaveTextContent(
      '31 réponse · 2 adultes, 1 enfant',
    )
    expect(
      within(tiles).getByRole('button', { name: new RegExp(text.tileMaybe) }),
    ).toHaveTextContent('11 réponse, en personnes')
    expect(within(tiles).getByRole('button', { name: new RegExp(text.tileNo) })).toHaveTextContent(
      '11 réponse',
    )
    expect(screen.getByText(/3 personnes attendues/)).toBeInTheDocument()
  })

  it('says the line under the title: how many replies, the deadline', async () => {
    render(
      answering(
        list({ rsvpForm: aRsvpSettings({ enabled: true, state: 'open', deadline: '2026-12-01' }) }),
      ),
    )

    expect(await screen.findByText('3 réponses · date limite le 1 décembre')).toBeInTheDocument()
  })

  it('lists every reply with its answer, people, diet, note and when it came', async () => {
    render(answering(list()))

    const table = await screen.findByRole('table')
    const row = within(table).getByRole('row', { name: /Léa Martin/ })
    expect(within(row).getByText(text.answerYes)).toBeInTheDocument()
    expect(within(row).getByText('2 + 1 enf.')).toBeInTheDocument()
    expect(within(row).getByText('Sans gluten')).toBeInTheDocument()
    expect(within(row).getByText('On a hâte')).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Ana Lopez/ })).toHaveTextContent(text.answerNo)
  })

  it('has no "peut-être" tile, tab or column of people when the form does not ask them', async () => {
    const settings = aRsvpSettings({ enabled: true, state: 'open' })
    render(
      answering(
        list({
          rsvpForm: {
            ...settings,
            form: {
              ...settings.form,
              maybe: false,
              partySize: { enabled: false, max: 1 },
              diet: false,
            },
          },
          rsvps: [lea, ana],
        }),
      ),
    )

    await screen.findByRole('table')
    expect(
      screen.queryByRole('button', { name: new RegExp(text.tileMaybe) }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${text.tabMaybe}`) }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: text.colPeople })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: text.colDiet })).not.toBeInTheDocument()
  })

  it('says when no reply has come yet, and that it will show up by itself', async () => {
    render(answering(list({ rsvps: [], stats: anRsvpStats() })))

    expect(await screen.findByText(text.emptyTitle)).toBeInTheDocument()
    expect(screen.getByText(text.emptyBody)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('sends the host to the settings when replies are not asked yet', async () => {
    render(answering(list({ rsvps: [], stats: anRsvpStats(), rsvpForm: aRsvpSettings() })))

    expect(await screen.findByText(text.emptyOff)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: text.settings })[0]).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/invitations',
    )
  })

  it('says the load failed, with a way to try again', async () => {
    const rsvps = vi.fn().mockRejectedValueOnce(ApiError.network()).mockResolvedValue(list())
    const user = userEvent.setup()
    render(fakeApi({ rsvps }))

    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('is the owner’s: a moderator is told so and shown nothing', async () => {
    const rsvps = vi.fn(async () => list())
    render(fakeApi({ rsvps, getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) }))

    expect(await screen.findByText(fr.guestInvite.host.ownerOnly)).toBeInTheDocument()
    expect(rsvps).not.toHaveBeenCalled()
  })

  it('links to the spreadsheet', async () => {
    render(answering(list()))

    expect(await screen.findByRole('link', { name: text.export })).toHaveAttribute(
      'href',
      '/api/events/camille-et-sacha/rsvps/export',
    )
  })

  it('says the day the replies are erased, in the invitation’s zone', async () => {
    render(
      answering(
        list({
          rsvpForm: aRsvpSettings({
            enabled: true,
            state: 'open',
            erasedAt: '2027-01-11T22:30:00.000Z',
          }),
        }),
        {
          guestInvite: vi.fn(async () => ({
            guestInvite: aGuestInviteHost({ timeZone: 'Asia/Tokyo' }),
          })),
        },
      ),
    )

    expect(await screen.findByText(host.erasedOn('12 janvier 2027'))).toBeInTheDocument()
  })
})

describe('the replies page: filtering', () => {
  it('shows the replies of a tab, with how many each holds', async () => {
    const user = userEvent.setup()
    render(answering(list()))
    const tabs = await screen.findByRole('group', { name: text.tabsLabel })

    expect(within(tabs).getByRole('button', { name: /Toutes\s*3/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(tabs).getByRole('button', { name: new RegExp(`^${text.tabMaybe}`) }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('Tom Durand')).toBeInTheDocument()
    expect(within(table).queryByText('Léa Martin')).not.toBeInTheDocument()
  })

  it('opens a tab from the tile of the same answer', async () => {
    const user = userEvent.setup()
    render(answering(list()))

    const tiles = await screen.findByRole('group', { name: text.tilesLabel })
    await user.click(within(tiles).getByRole('button', { name: new RegExp(text.tileNo) }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('Ana Lopez')).toBeInTheDocument()
    expect(within(table).queryByText('Tom Durand')).not.toBeInTheDocument()
  })

  it('searches a name', async () => {
    const user = userEvent.setup()
    render(answering(list()))

    await user.type(await screen.findByRole('searchbox', { name: text.searchLabel }), 'lopez')

    expect(within(screen.getByRole('table')).queryByText('Léa Martin')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Ana Lopez')).toBeInTheDocument()
  })

  it('says nothing matches', async () => {
    const user = userEvent.setup()
    render(answering(list()))

    await user.type(await screen.findByRole('searchbox', { name: text.searchLabel }), 'zzz')

    expect(screen.getByText(text.noneHere)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows twelve rows, then the others on request', async () => {
    const user = userEvent.setup()
    const many: RsvpDto[] = Array.from({ length: 15 }, (_, i) =>
      anRsvp({
        id: `r-${i}`,
        name: `Invité ${String(i).padStart(2, '0')}`,
        updatedAt: '2026-11-22T10:00:00.000Z',
      }),
    )
    render(answering(list({ rsvps: many })))

    await screen.findByRole('table')
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(screen.getByText(text.rowsOf(12, 15))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.showMore(3) }))

    expect(screen.getAllByRole('row')).toHaveLength(16)
  })

  it('says the last replies, newest first', async () => {
    render(answering(list()))

    await screen.findByRole('table')
    const items = within(
      screen.getByRole('heading', { name: text.latestTitle }).closest('section')!,
    )
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(items).toEqual([
      'Léa Martin vient à 3',
      'Tom Durand viendra peut-être',
      'Ana Lopez ne vient pas',
    ])
  })
})

describe('the replies page: working on a reply', () => {
  it('opens one reply in full, with who it came from', async () => {
    const user = userEvent.setup()
    render(answering(list()))

    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 adultes, 1 enfant')).toBeInTheDocument()
    expect(within(dialog).getByText('Sans gluten')).toBeInTheDocument()
    expect(within(dialog).getByText('On a hâte')).toBeInTheDocument()
    expect(dialog).toHaveTextContent(plain(text.sourceOpen))
  })

  it('changes a reply with the form of the guest, filled in, and reads the list again', async () => {
    const user = userEvent.setup()
    const updateRsvp = vi.fn(async () => ({ rsvp: lea }))
    const rsvps = vi.fn(async () => list())
    render(fakeApi({ rsvps, updateRsvp }))
    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: text.edit }),
    )

    const form = await screen.findByRole('dialog', { name: text.formEditTitle })
    expect(within(form).getByLabelText(new RegExp(`^${text.formName}`))).toHaveValue('Léa Martin')
    await user.clear(within(form).getByLabelText(new RegExp(`^${text.formDiet}`)))
    await user.type(within(form).getByLabelText(new RegExp(`^${text.formDiet}`)), 'Végétarien')
    await user.click(within(form).getByRole('button', { name: text.formSave }))

    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(1))
    expect(updateRsvp).toHaveBeenCalledWith('camille-et-sacha', 'r-lea', {
      name: 'Léa Martin',
      answer: 'yes',
      adults: 2,
      kids: 1,
      diet: 'Végétarien',
      message: 'On a hâte',
    })
    await waitFor(() => expect(rsvps).toHaveBeenCalledTimes(2))
  })

  it('adds a reply received by phone, asking what the host’s form asks', async () => {
    const user = userEvent.setup()
    const addRsvp = vi.fn(async () => ({ rsvp: lea }))
    render(fakeApi({ rsvps: vi.fn(async () => list()), addRsvp }))

    await user.click(await screen.findByRole('button', { name: text.add }))
    const form = await screen.findByRole('dialog', { name: text.formAddTitle })
    expect(within(form).getByRole('button', { name: text.formSave })).toBeDisabled()
    await user.type(within(form).getByLabelText(new RegExp(`^${text.formName}`)), 'Paul Petit')
    await user.click(within(form).getByLabelText(text.answerYes))
    await user.click(within(form).getByRole('button', { name: text.formSave }))

    await waitFor(() => expect(addRsvp).toHaveBeenCalledTimes(1))
    expect(addRsvp).toHaveBeenCalledWith('camille-et-sacha', {
      name: 'Paul Petit',
      answer: 'yes',
      adults: 1,
      kids: 0,
      diet: null,
      message: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not offer the "peut-être", the people nor the diet when the form does not ask them', async () => {
    const user = userEvent.setup()
    const settings = aRsvpSettings({ enabled: true, state: 'open' })
    render(
      answering(
        list({
          rsvpForm: {
            ...settings,
            form: {
              ...settings.form,
              maybe: false,
              partySize: { enabled: false, max: 1 },
              diet: false,
            },
          },
        }),
      ),
    )

    await user.click(await screen.findByRole('button', { name: text.add }))

    const form = await screen.findByRole('dialog', { name: text.formAddTitle })
    expect(within(form).queryByLabelText(text.answerMaybe)).not.toBeInTheDocument()
    await user.click(within(form).getByLabelText(text.answerYes))
    expect(within(form).queryByLabelText(new RegExp(`^${text.formAdults}`))).not.toBeInTheDocument()
    expect(within(form).queryByLabelText(new RegExp(`^${text.formDiet}`))).not.toBeInTheDocument()
  })

  it('says why a reply was refused, and keeps the form open', async () => {
    const user = userEvent.setup()
    const addRsvp = vi.fn().mockRejectedValue(new ApiError(409, 'rsvp.tooMany'))
    render(fakeApi({ rsvps: vi.fn(async () => list()), addRsvp }))
    await user.click(await screen.findByRole('button', { name: text.add }))
    const form = await screen.findByRole('dialog', { name: text.formAddTitle })
    await user.type(within(form).getByLabelText(new RegExp(`^${text.formName}`)), 'Paul')
    await user.click(within(form).getByLabelText(text.answerNo))

    await user.click(within(form).getByRole('button', { name: text.formSave }))

    expect(await within(form).findByRole('alert')).toHaveTextContent(fr.errors['rsvp.tooMany'])
    expect(screen.getByRole('dialog', { name: text.formAddTitle })).toBeInTheDocument()
  })

  it('deletes a reply after asking, and reads the list again', async () => {
    const user = userEvent.setup()
    const deleteRsvp = vi.fn(async () => undefined)
    const rsvps = vi.fn(async () => list())
    render(fakeApi({ rsvps, deleteRsvp }))
    await user.click(await screen.findByRole('button', { name: 'Ana Lopez' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: text.remove }),
    )

    const confirm = await screen.findByRole('dialog', {
      name: text.deleteTitle('Ana Lopez'),
    })
    expect(deleteRsvp).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: text.deleteYes }))

    await waitFor(() => expect(deleteRsvp).toHaveBeenCalledWith('camille-et-sacha', 'r-ana'))
    await waitFor(() => expect(rsvps).toHaveBeenCalledTimes(2))
  })

  it('keeps the reply when the host changes their mind', async () => {
    const user = userEvent.setup()
    const deleteRsvp = vi.fn(async () => undefined)
    render(fakeApi({ rsvps: vi.fn(async () => list()), deleteRsvp }))
    await user.click(await screen.findByRole('button', { name: 'Ana Lopez' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: text.remove }),
    )

    await user.click(
      within(await screen.findByRole('dialog', { name: text.deleteTitle('Ana Lopez') })).getByRole(
        'button',
        { name: fr.app.cancel },
      ),
    )

    expect(deleteRsvp).not.toHaveBeenCalled()
  })

  it('says why a deletion failed', async () => {
    const user = userEvent.setup()
    const deleteRsvp = vi.fn().mockRejectedValue(new ApiError(404, 'rsvp.notFound'))
    render(fakeApi({ rsvps: vi.fn(async () => list()), deleteRsvp }))
    await user.click(await screen.findByRole('button', { name: 'Ana Lopez' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: text.remove }),
    )
    await user.click(
      within(await screen.findByRole('dialog', { name: text.deleteTitle('Ana Lopez') })).getByRole(
        'button',
        { name: text.deleteYes },
      ),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rsvp.notFound'])
  })

  it('is read-only on an archived event: no add, no change, no delete', async () => {
    const user = userEvent.setup()
    render(answering(list(), { getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) }))

    expect(await screen.findByRole('button', { name: text.add })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Ana Lopez' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: text.edit })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: text.remove })).toBeDisabled()
  })
})

describe('the replies page: closing and reopening', () => {
  it('closes the replies and says so, then reopens them', async () => {
    const user = userEvent.setup()
    const closeRsvps = vi.fn(async () => ({
      rsvpForm: aRsvpSettings({
        enabled: true,
        state: 'closed',
        closedAt: '2026-11-23T10:00:00.000Z',
        closesAt: '2099-01-01T00:00:00.000Z',
      }),
    }))
    const reopenRsvps = vi.fn(async () => ({
      rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }),
    }))
    render(fakeApi({ rsvps: vi.fn(async () => list()), closeRsvps, reopenRsvps }))

    await user.click(await screen.findByRole('button', { name: host.closeAction }))
    expect(await screen.findByText(/réponses fermées/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: host.reopenAction }))

    await waitFor(() => expect(screen.queryByText(/réponses fermées/)).not.toBeInTheDocument())
    expect(closeRsvps).toHaveBeenCalledWith('camille-et-sacha')
    expect(reopenRsvps).toHaveBeenCalledWith('camille-et-sacha')
  })

  it('says why the act failed', async () => {
    const user = userEvent.setup()
    render(
      fakeApi({
        rsvps: vi.fn(async () => list()),
        closeRsvps: vi.fn().mockRejectedValue(new ApiError(409, 'rsvp.inviteRequired')),
      }),
    )

    await user.click(await screen.findByRole('button', { name: host.closeAction }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rsvp.inviteRequired'])
  })

  it('offers no button to a window closed by its deadline, and says to move the date', async () => {
    render(
      answering(
        list({
          rsvpForm: aRsvpSettings({
            enabled: true,
            state: 'closed',
            closedAt: null,
            deadline: '2026-11-01',
            closesAt: '2026-11-02T00:00:00.000Z',
          }),
        }),
      ),
    )

    expect(await screen.findByText(plain(host.closedByDate))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: host.closeAction })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: host.reopenAction })).not.toBeInTheDocument()
  })

  it('offers no button to reopen a window the host closed after the deadline went by', async () => {
    render(
      answering(
        list({
          rsvpForm: aRsvpSettings({
            enabled: true,
            state: 'closed',
            closedAt: '2026-10-30T10:00:00.000Z',
            deadline: '2026-11-01',
            closesAt: '2026-11-02T00:00:00.000Z',
          }),
        }),
      ),
    )

    expect(await screen.findByText(plain(host.reopenNeedsDate))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: host.reopenAction })).not.toBeInTheDocument()
  })

  it('does not close an archived event’s replies', async () => {
    render(answering(list(), { getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) }))

    expect(await screen.findByRole('button', { name: host.closeAction })).toBeDisabled()
  })
})

describe('the replies page: live', () => {
  it('reads the list again when the stream says the replies changed, once for a burst', async () => {
    const rsvps = vi.fn(async () => list())
    render(fakeApi({ rsvps }))
    await screen.findByRole('table')
    expect(rsvps).toHaveBeenCalledTimes(1)

    signal('rsvp.changed')
    signal('rsvp.changed')
    signal('rsvp.changed')

    await waitFor(() => expect(rsvps).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(rsvps).toHaveBeenCalledTimes(2)
  })

  it('shows a reply that arrives while the page is open', async () => {
    const rsvps = vi
      .fn()
      .mockResolvedValueOnce(list({ rsvps: [lea] }))
      .mockResolvedValue(list({ rsvps: [lea, anRsvp({ id: 'r-new', name: 'Nina Roux' })] }))
    render(fakeApi({ rsvps }))
    await screen.findByRole('table')
    expect(screen.queryByText('Nina Roux')).not.toBeInTheDocument()

    signal('rsvp.changed')

    expect(await screen.findByText('Nina Roux')).toBeInTheDocument()
  })

  it('does not read again for a signal about something else', async () => {
    const rsvps = vi.fn(async () => list())
    render(fakeApi({ rsvps }))
    await screen.findByRole('table')

    signal('photo.uploaded')
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(rsvps).toHaveBeenCalledTimes(1)
  })

  it('reads at once when the stream comes back from a drop', async () => {
    const rsvps = vi.fn(async () => list())
    render(fakeApi({ rsvps }))
    await screen.findByRole('table')

    act(() => FakeEventSource.latest('the page').emitOpen())
    act(() => FakeEventSource.latest('the page').emitDrop())
    act(() => FakeEventSource.latest('the page').emitOpen())

    await waitFor(() => expect(rsvps.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('marks the replies seen when it shows some the host had not, once per answer', async () => {
    const markRsvpsSeen = vi.fn(async () => undefined)
    const rsvps = vi.fn(async () => list({ unseen: 2 }))
    render(fakeApi({ rsvps, markRsvpsSeen }))
    await screen.findByRole('table')

    await waitFor(() => expect(markRsvpsSeen).toHaveBeenCalledWith('camille-et-sacha'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(markRsvpsSeen).toHaveBeenCalledTimes(1)
  })

  it('marks nothing seen when there is nothing new', async () => {
    const markRsvpsSeen = vi.fn(async () => undefined)
    render(fakeApi({ rsvps: vi.fn(async () => list({ unseen: 0 })), markRsvpsSeen }))
    await screen.findByRole('table')

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(markRsvpsSeen).not.toHaveBeenCalled()
  })

  it('goes on when marking seen fails: the page is still the replies', async () => {
    const markRsvpsSeen = vi.fn().mockRejectedValue(ApiError.network())
    render(fakeApi({ rsvps: vi.fn(async () => list({ unseen: 1 })), markRsvpsSeen }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    await waitFor(() => expect(markRsvpsSeen).toHaveBeenCalled())
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('the replies page: the menu’s badge', () => {
  it('tells the layout to read the event again once the replies are marked seen', async () => {
    const refresh = vi.fn()
    renderWithProviders(
      <Routes>
        <Route element={<Outlet context={{ refresh }} />}>
          <Route path="/admin/events/:slug/rsvps" element={<RsvpsPage />} />
        </Route>
      </Routes>,
      {
        api: fakeApi({ rsvps: vi.fn(async () => list({ unseen: 2 })) }),
        route: '/admin/events/camille-et-sacha/rsvps',
      },
    )
    await screen.findByRole('table')

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('does not tell the layout when marking seen failed', async () => {
    const refresh = vi.fn()
    renderWithProviders(
      <Routes>
        <Route element={<Outlet context={{ refresh }} />}>
          <Route path="/admin/events/:slug/rsvps" element={<RsvpsPage />} />
        </Route>
      </Routes>,
      {
        api: fakeApi({
          rsvps: vi.fn(async () => list({ unseen: 2 })),
          markRsvpsSeen: vi.fn().mockRejectedValue(ApiError.network()),
        }),
        route: '/admin/events/camille-et-sacha/rsvps',
      },
    )
    await screen.findByRole('table')

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(refresh).not.toHaveBeenCalled()
  })
})
