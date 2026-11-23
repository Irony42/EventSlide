import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import type { HouseholdDto, RsvpListResponseDto } from '../../../lib/api/dto'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import {
  aGuestInviteHost,
  aHousehold,
  anRsvp,
  anRsvpStats,
  aRsvpSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { HouseholdsPage } from './HouseholdsPage'
import { RsvpsPage } from './RsvpsPage'

/**
 * The moments on the host's side (spec 30, lot 4): one column per moment in the table, the figures
 * per moment, the caterer's headcount, the detail, the host's own form and the moments a household is
 * invited to.
 */

const text = fr.rsvp.list
const households = fr.rsvp.households
const BRUNCH = { id: 'aaaaaaaa', label: 'Brunch' }
const DINNER = { id: 'bbbbbbbb', label: 'Dîner' }
const base = aRsvpSettings({ enabled: true, state: 'open' })
const settings = { ...base, form: { ...base.form, moments: [BRUNCH, DINNER] } }

const lea = anRsvp({
  id: 'r-lea',
  name: 'Léa Martin',
  adults: 2,
  kids: 0,
  details: {
    companions: [],
    meals: [],
    answers: [],
    moments: [DINNER.id, 'removed0'],
    showName: false,
  },
})
const hugo = anRsvp({
  id: 'r-hugo',
  name: 'Hugo Petit',
  answer: 'no',
  adults: 0,
  kids: 0,
  details: { companions: [], meals: [], answers: [], moments: [BRUNCH.id], showName: false },
})

const stats = anRsvpStats({
  yes: { responses: 1, people: 2, adults: 2, kids: 0 },
  no: { responses: 1 },
  moments: [
    { ...BRUNCH, yes: { responses: 0, people: 0 }, maybe: { responses: 0, people: 0 } },
    { ...DINNER, yes: { responses: 1, people: 2 }, maybe: { responses: 1, people: 3 } },
  ],
})

const list = (): RsvpListResponseDto => ({
  rsvpForm: settings,
  rsvps: [lea, hugo],
  stats,
  unseen: 0,
})

const render = (api: Partial<Api> = {}) =>
  renderWithProviders(<RsvpsPage />, {
    api: fakeApi({ rsvps: vi.fn(async () => list()), ...api }),
    route: '/admin/events/camille-et-sacha/rsvps',
    path: '/admin/events/:slug/rsvps',
  })

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the replies page, with moments', () => {
  it('has a column per moment of the form, a cell only for those who come to it', async () => {
    render()

    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: BRUNCH.label })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: DINNER.label })).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: /Léa Martin/ })
    expect(within(row).getByText(text.detailYes)).toBeInTheDocument()
    // A "non" comes to nothing, whatever it once ticked.
    const no = within(table).getByRole('row', { name: /Hugo Petit/ })
    expect(within(no).queryByText(text.detailYes)).not.toBeInTheDocument()
  })

  it('has no moment column for a form without moments', async () => {
    render({ rsvps: vi.fn(async () => ({ ...list(), rsvpForm: base, stats: anRsvpStats() })) })

    const table = await screen.findByRole('table')
    expect(within(table).queryByRole('columnheader', { name: DINNER.label })).toBeNull()
    expect(screen.queryByText(text.momentsTitle)).not.toBeInTheDocument()
  })

  it('says, per moment, how many come and how many maybe', async () => {
    render()
    const flat = (words: string): string => words.replaceAll(String.fromCharCode(160), ' ')
    const line =
      (label: string, yes: string, maybe: string | null): ((content: string) => boolean) =>
      (content) =>
        flat(content) === flat(text.momentLine(label, yes, maybe))

    expect(
      await screen.findByText(line(DINNER.label, '2 personnes', '3 personnes')),
    ).toBeInTheDocument()
    expect(screen.getByText(line(BRUNCH.label, '0 personnes', null))).toBeInTheDocument()
  })

  it('tells the caterer the people at each moment', async () => {
    render()

    const caterer = await screen.findByRole('region', { name: text.catererTitle })

    expect(within(caterer).getByText(text.catererMoments)).toBeInTheDocument()
    expect(within(caterer).getByText(DINNER.label).nextElementSibling).toHaveTextContent('2')
  })

  it('shows the moments of a reply in its detail by their labels, a removed one not at all', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))

    const detail = await screen.findByRole('dialog', { name: 'Léa Martin' })
    expect(within(detail).getByText(text.detailMoments)).toBeInTheDocument()
    expect(within(detail).getByText('Dîner')).toBeInTheDocument()
    expect(within(detail).queryByText(/removed0/)).not.toBeInTheDocument()
  })

  it('asks the moments in the host’s own form and sends the ones ticked', async () => {
    const user = userEvent.setup()
    const addRsvp = vi.fn(async () => ({ rsvp: lea }))
    render({ addRsvp })

    await user.click(await screen.findByRole('button', { name: text.add }))
    const form = await screen.findByRole('dialog', { name: text.formAddTitle })
    await user.type(within(form).getByLabelText(new RegExp(`^${text.formName}`)), 'Paul Petit')
    await user.click(within(form).getByLabelText(text.answerYes))
    await user.click(within(form).getByRole('checkbox', { name: BRUNCH.label }))
    await user.click(within(form).getByRole('button', { name: text.formSave }))

    await waitFor(() => expect(addRsvp).toHaveBeenCalledTimes(1))
    expect(addRsvp).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({ moments: [BRUNCH.id] }),
    )
  })

  it('starts a correction from the moments the reply holds, the removed ones not ticked', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))
    await user.click(await screen.findByRole('button', { name: text.edit }))

    const form = await screen.findByRole('dialog', { name: text.formEditTitle })
    expect(within(form).getByRole('checkbox', { name: DINNER.label })).toBeChecked()
    expect(within(form).getByRole('checkbox', { name: BRUNCH.label })).not.toBeChecked()
  })

  it('asks a reply filed under a household only the moments that household is invited to', async () => {
    const user = userEvent.setup()
    const filed = anRsvp({ ...lea, id: 'r-filed', name: 'Famille Roux', householdId: 'h-9' })
    render({
      rsvps: vi.fn(async () => ({ ...list(), rsvps: [filed] })),
      households: vi.fn(async () => ({
        households: [aHousehold({ id: 'h-9', moments: [DINNER.id] })],
      })),
    })

    await user.click(await screen.findByRole('button', { name: 'Famille Roux' }))
    await user.click(await screen.findByRole('button', { name: text.edit }))

    const form = await screen.findByRole('dialog', { name: text.formEditTitle })
    expect(within(form).getByRole('checkbox', { name: DINNER.label })).toBeInTheDocument()
    expect(within(form).queryByRole('checkbox', { name: BRUNCH.label })).not.toBeInTheDocument()
  })
})

describe('the guest list, with moments', () => {
  const martin = aHousehold({ id: 'h-1', name: 'Famille Martin', places: 4, moments: [DINNER.id] })
  const roux = aHousehold({ id: 'h-2', name: 'Famille Roux', places: 2, moments: null })

  const listing = (rows: readonly HouseholdDto[], extra: Partial<Api> = {}): Api =>
    fakeApi({
      households: vi.fn(async () => ({ households: rows })),
      guestInvite: vi.fn(async () => ({
        guestInvite: aGuestInviteHost({ url: 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H' }),
      })),
      rsvpForm: vi.fn(async () => ({ rsvpForm: settings })),
      ...extra,
    })

  const renderGuests = (api: Api) =>
    renderWithProviders(<HouseholdsPage />, {
      api,
      route: '/admin/events/camille-et-sacha/rsvps/guests',
      path: '/admin/events/:slug/rsvps/guests',
    })

  it('shows the moments each household is invited to, "all" by default', async () => {
    renderGuests(listing([martin, roux]))

    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: households.colMoments })).toBeVisible()
    expect(
      within(within(table).getByRole('row', { name: /Famille Martin/ })).getByText('Dîner'),
    ).toBeVisible()
    expect(
      within(within(table).getByRole('row', { name: /Famille Roux/ })).getByText(
        households.momentsAll,
      ),
    ).toBeVisible()
  })

  it('shows no moment column when the form has none', async () => {
    renderGuests(listing([martin], { rsvpForm: vi.fn(async () => ({ rsvpForm: base })) }))

    await screen.findByRole('table')
    expect(screen.queryByRole('columnheader', { name: households.colMoments })).toBeNull()
  })

  it('sends the moments ticked for a household, and null when every one is', async () => {
    const updateHousehold = vi.fn(async () => ({ household: martin }))
    const user = userEvent.setup()
    renderGuests(listing([martin], { updateHousehold }))

    await user.click(
      await screen.findByRole('button', { name: `${households.edit} · Famille Martin` }),
    )
    expect(screen.getByRole('checkbox', { name: BRUNCH.label })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: DINNER.label })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: BRUNCH.label }))
    await user.click(screen.getByRole('button', { name: households.formSave }))

    await waitFor(() =>
      expect(updateHousehold).toHaveBeenCalledWith('camille-et-sacha', 'h-1', {
        name: 'Famille Martin',
        places: 4,
        moments: null,
      }),
    )
  })

  it('sends a subset as the ids ticked, and refuses to save a household invited to nothing', async () => {
    const addHousehold = vi.fn(async () => ({ household: roux }))
    const user = userEvent.setup()
    renderGuests(listing([], { addHousehold }))

    await user.click(await screen.findByRole('button', { name: households.add }))
    await user.type(screen.getByLabelText(households.formName), 'Famille Roux')
    await user.click(screen.getByRole('checkbox', { name: BRUNCH.label }))
    await user.click(screen.getByRole('checkbox', { name: DINNER.label }))
    expect(screen.getByRole('button', { name: households.formSave })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: BRUNCH.label }))
    await user.click(screen.getByRole('button', { name: households.formSave }))

    await waitFor(() =>
      expect(addHousehold).toHaveBeenCalledWith('camille-et-sacha', {
        name: 'Famille Roux',
        places: 2,
        moments: [BRUNCH.id],
      }),
    )
  })

  it('asks no moment when the form has none, and sends none', async () => {
    const addHousehold = vi.fn(async () => ({ household: roux }))
    const user = userEvent.setup()
    renderGuests(listing([], { addHousehold, rsvpForm: vi.fn(async () => ({ rsvpForm: base })) }))

    await user.click(await screen.findByRole('button', { name: households.add }))
    await user.type(screen.getByLabelText(households.formName), 'Famille Roux')
    expect(screen.queryByText(households.formMoments)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: households.formSave }))

    await waitFor(() =>
      expect(addHousehold).toHaveBeenCalledWith('camille-et-sacha', {
        name: 'Famille Roux',
        places: 2,
      }),
    )
  })
})
