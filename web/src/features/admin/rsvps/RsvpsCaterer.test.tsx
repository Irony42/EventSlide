import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { RsvpListResponseDto } from '../../../lib/api/dto'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import {
  anEventDto,
  anRsvp,
  anRsvpStats,
  aRsvpSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { RsvpsPage } from './RsvpsPage'

/**
 * "Traiteur" and "Imprimer la liste" on the host's replies page (spec 30, lot 2, PR 8): the figures
 * are the server's, the diets are the host's alone, and the sheet exists only while it is printed.
 */

const text = fr.rsvp.list
const plain = (sentence: string): string => sentence.replaceAll(String.fromCharCode(160), ' ')
const settings = aRsvpSettings({ enabled: true, state: 'open' })
const asking = {
  ...settings,
  form: {
    ...settings.form,
    companionNames: true,
    meals: { enabled: true, options: ['Poisson', 'Végé'] },
  },
}
const lea = anRsvp({
  id: 'r-lea',
  name: 'Léa Martin',
  adults: 2,
  kids: 1,
  diet: 'sans gluten',
  details: {
    companions: ['Hugo'],
    meals: ['Poisson', 'Poisson', 'Végé'],
    answers: [],
    moments: [],
    showName: false,
  },
})
const tom = anRsvp({
  id: 'r-tom',
  name: 'Tom Durand',
  answer: 'maybe',
  adults: 3,
  kids: 0,
  diet: 'noix',
})
const STATS = anRsvpStats({
  yes: { responses: 1, people: 3, adults: 2, kids: 1 },
  maybe: { responses: 1, people: 3 },
  diets: [
    { name: 'Léa Martin', diet: 'sans gluten' },
    { name: 'Tom Durand', diet: 'noix' },
  ],
  meals: [
    { label: 'Poisson', count: 2 },
    { label: 'Végé', count: 1 },
  ],
})

const list = (over: Partial<RsvpListResponseDto> = {}): RsvpListResponseDto => ({
  rsvpForm: asking,
  rsvps: [lea, tom],
  stats: STATS,
  unseen: 0,
  ...over,
})

const render = (response = list()) =>
  renderWithProviders(<RsvpsPage />, {
    api: fakeApi({
      rsvps: vi.fn(async () => response),
      getEvent: vi.fn(async () => anEventDto({ name: 'Mariage Camille', role: 'owner' })),
    }),
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

const panel = async () => await screen.findByRole('region', { name: text.catererTitle })

describe('the caterer panel', () => {
  it('tells the adults and children who come, the maybes apart, the menus and the diets', async () => {
    render()

    const caterer = await panel()
    expect(within(caterer).getByText(text.catererAdults).nextSibling).toHaveTextContent('2')
    expect(within(caterer).getByText(text.catererKids).nextSibling).toHaveTextContent('1')
    expect(within(caterer).getByText(text.catererMaybe).nextSibling).toHaveTextContent('3')
    expect(within(caterer).getByText('Poisson').nextSibling).toHaveTextContent('2')
    expect(within(caterer).getByText('Végé').nextSibling).toHaveTextContent('1')
    expect(within(caterer).getByText('sans gluten')).toBeInTheDocument()
    expect(within(caterer).getByText('noix')).toBeInTheDocument()
  })

  it('leaves out what the form does not ask: no maybe, no children, no menus, no diets', async () => {
    const quiet = {
      ...settings,
      form: { ...settings.form, maybe: false, kidsSeparate: false, diet: false },
    }
    render(list({ rsvpForm: quiet }))

    const caterer = await panel()
    expect(within(caterer).queryByText(text.catererMaybe)).toBeNull()
    expect(within(caterer).queryByText(text.catererKids)).toBeNull()
    expect(within(caterer).queryByText(text.catererMeals)).toBeNull()
    expect(within(caterer).queryByText(text.catererDiets)).toBeNull()
  })

  it('says no menu is chosen yet, and no diet either', async () => {
    render(list({ stats: anRsvpStats({ yes: { responses: 1, people: 1, adults: 1, kids: 0 } }) }))

    const caterer = await panel()
    expect(within(caterer).getByText(text.catererNoMeals)).toBeInTheDocument()
    expect(within(caterer).getAllByText(text.none).length).toBeGreaterThan(0)
  })

  it('says the diets are health data the host alone sees', async () => {
    render()

    expect(within(await panel()).getByText(plain(text.catererPrivate))).toBeInTheDocument()
  })

  it('links to the caterer’s file', async () => {
    render()

    const link = within(await panel()).getByRole('link', { name: text.catererExport })
    expect(link).toHaveAttribute('href', '/api/events/camille-et-sacha/rsvps/export?view=caterer')
  })

  it('is not there before the first reply', async () => {
    render(list({ rsvps: [], stats: anRsvpStats() }))

    await screen.findByRole('heading', { name: text.title })
    expect(screen.queryByRole('region', { name: text.catererTitle })).toBeNull()
  })
})

describe('"Imprimer la liste"', () => {
  it('draws the sheet only while printing, with those who come, and removes it afterwards', async () => {
    const user = userEvent.setup()
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render()

    expect(document.querySelector('[data-rsvp-print]')).toBeNull()
    await user.click(within(await panel()).getByRole('button', { name: text.catererPrint }))

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    const sheet = document.querySelector('[data-rsvp-print]') as HTMLElement
    expect(sheet.parentElement).toBe(document.body)
    expect(document.body).toHaveAttribute('data-printing-rsvps')
    expect(
      within(sheet).getByRole('heading', {
        name: text.printTitle('Mariage Camille'),
        hidden: true,
      }),
    ).toBeInTheDocument()
    expect(within(sheet).getByText(plain(text.printConfidential))).toBeInTheDocument()
    expect(
      within(sheet).getByRole('rowheader', { name: 'Léa Martin', hidden: true }),
    ).toBeInTheDocument()
    for (const name of [text.colCompanions, text.colMeals, text.colDiet]) {
      expect(within(sheet).getByRole('columnheader', { name, hidden: true })).toBeInTheDocument()
    }
    expect(within(sheet).getByText('Hugo')).toBeInTheDocument()
    expect(within(sheet).getByText('Poisson ×2, Végé')).toBeInTheDocument()
    expect(within(sheet).getByText('sans gluten')).toBeInTheDocument()
    // A "peut-être" is not on the list of those who come.
    expect(within(sheet).queryByText('Tom Durand')).toBeNull()

    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })

    await waitFor(() => expect(document.querySelector('[data-rsvp-print]')).toBeNull())
    expect(document.body).not.toHaveAttribute('data-printing-rsvps')
  })

  it('is not offered while nobody comes', async () => {
    render(list({ rsvps: [tom], stats: anRsvpStats({ maybe: { responses: 1, people: 3 } }) }))

    expect(within(await panel()).getByRole('button', { name: text.catererPrint })).toBeDisabled()
  })

  it('leaves the columns out that the form does not ask', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('print', vi.fn())
    render(
      list({
        rsvpForm: {
          ...settings,
          form: { ...settings.form, diet: false },
        },
      }),
    )

    await user.click(within(await panel()).getByRole('button', { name: text.catererPrint }))

    const sheet = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-rsvp-print]')
      if (found === null) throw new Error('not yet')
      return found
    })
    expect(
      within(sheet).queryByRole('columnheader', { name: text.colDiet, hidden: true }),
    ).toBeNull()
    expect(
      within(sheet).queryByRole('columnheader', { name: text.colMeals, hidden: true }),
    ).toBeNull()
    expect(
      within(sheet).queryByRole('columnheader', { name: text.colCompanions, hidden: true }),
    ).toBeNull()
  })

  it('closes the sheet by itself when the browser cannot print', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('print', undefined)
    render()

    await user.click(within(await panel()).getByRole('button', { name: text.catererPrint }))

    await waitFor(() => expect(document.querySelector('[data-rsvp-print]')).toBeNull())
  })
})
