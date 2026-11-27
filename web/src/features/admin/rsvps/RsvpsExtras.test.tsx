import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { RsvpListResponseDto, RsvpSettingsDto } from '../../../lib/api/dto'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import {
  anRsvp,
  anRsvpStats,
  aRsvpSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { RsvpsPage } from './RsvpsPage'

/**
 * The lot 2 columns and fields of the host's replies page (spec 30): companions, menus and one
 * column per question, the detail with every answer given, and the form the host fills for a guest.
 */

const text = fr.rsvp.list

const settings = aRsvpSettings({ enabled: true, state: 'open' })
const asking = {
  ...settings,
  form: {
    ...settings.form,
    companionNames: true,
    meals: { enabled: true, options: ['Poisson', 'Végé'] },
    questions: [
      { id: 'aaaaaaa1', label: 'Un chant ?', kind: 'text' as const },
      { id: 'aaaaaaa2', label: 'Voiture ?', kind: 'choice' as const, options: ['Oui', 'Non'] },
    ],
  },
}

const lea = anRsvp({
  id: 'r-lea',
  name: 'Léa Martin',
  adults: 2,
  kids: 0,
  details: {
    companions: ['Hugo'],
    meals: ['Poisson', 'Végé'],
    answers: [
      { questionId: 'aaaaaaa1', label: 'Un chant ?', value: 'Le Temps des cerises' },
      { questionId: 'gone', label: 'Une ancienne question ?', value: 'Oui' },
    ],
    moments: [],
    showName: false,
  },
})

const list = (form: RsvpSettingsDto = asking): RsvpListResponseDto => ({
  rsvpForm: form,
  rsvps: [lea],
  stats: anRsvpStats(),
  unseen: 0,
  rsvpDigest: false,
})

const render = (api = fakeApi({ rsvps: vi.fn(async () => list()) })) =>
  renderWithProviders(<RsvpsPage />, {
    api,
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

describe('the replies table, lot 2', () => {
  it('has a column for the companions, the menus and each question the form asks', async () => {
    render()

    const table = await screen.findByRole('table')
    for (const name of [text.colCompanions, text.colMeals, 'Un chant ?', 'Voiture ?']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    const row = within(table).getByRole('row', { name: /Léa Martin/ })
    expect(within(row).getByText('Hugo')).toBeInTheDocument()
    expect(within(row).getByText('Poisson, Végé')).toBeInTheDocument()
    expect(within(row).getByText('Le Temps des cerises')).toBeInTheDocument()
    // The question was never answered by this guest: a dash, not an empty cell.
    expect(within(row).getAllByText(text.none).length).toBeGreaterThan(0)
  })

  it('has none of these columns for a form that does not ask for them', async () => {
    render(fakeApi({ rsvps: vi.fn(async () => list(settings)) }))

    const table = await screen.findByRole('table')
    expect(within(table).queryByRole('columnheader', { name: text.colCompanions })).toBeNull()
    expect(within(table).queryByRole('columnheader', { name: text.colMeals })).toBeNull()
    expect(within(table).queryByRole('columnheader', { name: 'Un chant ?' })).toBeNull()
  })

  it('finds a reply by a companion’s first name', async () => {
    const user = userEvent.setup()
    render()

    await user.type(await screen.findByRole('searchbox'), 'hugo')

    expect(screen.getByRole('button', { name: 'Léa Martin' })).toBeInTheDocument()
  })
})

describe('the detail of a reply, lot 2', () => {
  it('shows the companions, the menus and every answer, a removed question’s included', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))

    const detail = await screen.findByRole('dialog', { name: 'Léa Martin' })
    expect(within(detail).getByText(text.detailCompanions)).toBeInTheDocument()
    expect(within(detail).getAllByText('Hugo').length).toBeGreaterThan(0)
    expect(within(detail).getByText(text.detailMeals)).toBeInTheDocument()
    expect(within(detail).getByText('Un chant ?')).toBeInTheDocument()
    expect(within(detail).getByText('Une ancienne question ?')).toBeInTheDocument()
    expect(within(detail).getByText('Oui')).toBeInTheDocument()
  })

  it('shows no line for what was not given', async () => {
    const user = userEvent.setup()
    render(
      fakeApi({
        rsvps: vi.fn(async () => ({
          ...list(),
          rsvps: [anRsvp({ id: 'r-2', name: 'Zoé Petit' })],
        })),
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'Zoé Petit' }))

    const detail = await screen.findByRole('dialog', { name: 'Zoé Petit' })
    expect(within(detail).queryByText(text.detailCompanions)).not.toBeInTheDocument()
    expect(within(detail).queryByText(text.detailMeals)).not.toBeInTheDocument()
  })
})

describe('the form the host fills for a guest, lot 2', () => {
  it('asks the companions, the menus and the questions of the form, and sends them', async () => {
    const user = userEvent.setup()
    const addRsvp = vi.fn(async () => ({ rsvp: lea }))
    render(fakeApi({ rsvps: vi.fn(async () => list()), addRsvp }))

    await user.click(await screen.findByRole('button', { name: text.add }))
    const form = await screen.findByRole('dialog', { name: text.formAddTitle })
    await user.type(within(form).getByLabelText(new RegExp(`^${text.formName}`)), 'Paul Petit')
    await user.click(within(form).getByLabelText(text.answerYes))
    // Two adults: one companion and two menus.
    const adults = within(form).getByLabelText(text.formAdults)
    fireEvent.change(adults, { target: { value: '2' } })
    await user.type(within(form).getByLabelText(new RegExp(text.formCompanion(1))), 'Max')
    await user.selectOptions(within(form).getByLabelText(text.formMeal('Paul')), 'Poisson')
    await user.selectOptions(within(form).getByLabelText(text.formMeal('Max')), 'Végé')
    await user.type(within(form).getByLabelText(/Un chant/), 'Sol')
    await user.selectOptions(within(form).getByLabelText(/Voiture/), 'Non')
    await user.click(within(form).getByRole('button', { name: text.formSave }))

    await waitFor(() => expect(addRsvp).toHaveBeenCalledTimes(1))
    expect(addRsvp).toHaveBeenCalledWith(
      'camille-et-sacha',
      expect.objectContaining({
        companions: ['Max'],
        meals: ['Poisson', 'Végé'],
        answers: [
          { questionId: 'aaaaaaa1', value: 'Sol' },
          { questionId: 'aaaaaaa2', value: 'Non' },
        ],
      }),
    )
  })

  it('starts a correction from what the reply holds', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))
    await user.click(await screen.findByRole('button', { name: text.edit }))

    const form = await screen.findByRole('dialog', { name: text.formEditTitle })
    expect(within(form).getByLabelText(new RegExp(text.formCompanion(1)))).toHaveValue('Hugo')
    expect(within(form).getByLabelText(text.formMeal('Hugo'))).toHaveValue('Végé')
    expect(within(form).getByLabelText(/Un chant/)).toHaveValue('Le Temps des cerises')
  })
})

describe('the first name a guest agreed to show', () => {
  it('is told in the detail, and the host’s form never carries it', async () => {
    const user = userEvent.setup()
    const named = anRsvp({
      id: 'r-named',
      name: 'Inès Lab',
      details: { ...lea.details, showName: true, companions: [], meals: [], answers: [] },
    })
    const updateRsvp = vi.fn(async (_slug: string, _id: string, _input: unknown) => ({
      rsvp: named,
    }))
    render(
      fakeApi({
        rsvps: vi.fn(async () => ({
          ...list({ ...asking, form: { ...asking.form, visibility: 'names' } }),
          rsvps: [named],
        })),
        updateRsvp,
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'Inès Lab' }))
    const detail = await screen.findByRole('dialog', { name: 'Inès Lab' })
    expect(within(detail).getByText(text.detailShowName)).toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: text.edit }))
    const form = await screen.findByRole('dialog', { name: text.formEditTitle })
    await user.click(within(form).getByRole('button', { name: text.formSave }))

    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(1))
    expect(updateRsvp.mock.calls[0]?.[2]).not.toHaveProperty('showName')
  })
})
