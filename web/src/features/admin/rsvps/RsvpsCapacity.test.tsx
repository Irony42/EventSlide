import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import type { RsvpReplyInput } from '../../../lib/api/client/invite'
import type { RsvpListResponseDto } from '../../../lib/api/dto'
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
 * The waiting list on the host's replies page (spec 30, lot 4, PR 14): its tab and tile appear while
 * somebody is on it, a reply on it can be promoted with one click (not held to the places), and the
 * host's own form keeps it on the list unless another answer is picked.
 */

const text = fr.rsvp.list
const base = aRsvpSettings({ enabled: true, state: 'full' })
const settings = { ...base, form: { ...base.form, capacity: 2 } }

const coming = anRsvp({ id: 'r-yes', name: 'Léa Martin', adults: 2, kids: 0 })
const waiting = anRsvp({
  id: 'r-wait',
  name: 'Hugo Attente',
  answer: 'waitlist',
  adults: 3,
  kids: 0,
})

const list = (rsvps = [coming, waiting]): RsvpListResponseDto => ({
  rsvpForm: settings,
  rsvps,
  stats: anRsvpStats({
    yes: { responses: 1, people: 2, adults: 2, kids: 0 },
    waitlist: {
      responses: rsvps.includes(waiting) ? 1 : 0,
      people: rsvps.includes(waiting) ? 3 : 0,
    },
  }),
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

describe('the waiting list on the replies page', () => {
  it('has a tab with its count and a tile while somebody is on it, and filters the table', async () => {
    const user = userEvent.setup()
    render()

    const tab = within(await screen.findByRole('group', { name: text.tabsLabel })).getByRole(
      'button',
      { name: new RegExp(`^${text.tabWaitlist}`) },
    )
    expect(within(tab).getByText('1')).toBeInTheDocument()
    expect(screen.getAllByText(text.tileWaitlist).length).toBeGreaterThan(0)
    await user.click(tab)

    const table = screen.getByRole('table')
    expect(within(table).getByRole('button', { name: 'Hugo Attente' })).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Léa Martin' })).not.toBeInTheDocument()
  })

  it('has neither while nobody is waiting', async () => {
    render({ rsvps: vi.fn(async () => list([coming])) })

    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: new RegExp(`^${text.tabWaitlist}`) })).toBeNull()
    expect(screen.queryByText(text.tileWaitlist)).not.toBeInTheDocument()
  })

  it('promotes a waiting-list reply with a yes, the same fields sent back', async () => {
    const user = userEvent.setup()
    const updateRsvp = vi.fn(async (_slug: string, _id: string, _input: RsvpReplyInput) => ({
      rsvp: waiting,
    }))
    render({ updateRsvp })

    await user.click(await screen.findByRole('button', { name: 'Hugo Attente' }))
    const detail = await screen.findByRole('dialog', { name: 'Hugo Attente' })
    const flat = (words: string): string => words.replaceAll(String.fromCharCode(160), ' ')
    expect(
      within(detail).getByText((content) => flat(content) === flat(text.detailWaitlistHint)),
    ).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: text.promote }))

    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(1))
    expect(updateRsvp).toHaveBeenCalledWith(
      'camille-et-sacha',
      'r-wait',
      expect.objectContaining({ name: 'Hugo Attente', answer: 'yes', adults: 3 }),
    )
  })

  it('offers no promotion for a reply that is not on the list', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: 'Léa Martin' }))

    const detail = await screen.findByRole('dialog', { name: 'Léa Martin' })
    expect(within(detail).queryByRole('button', { name: text.promote })).not.toBeInTheDocument()
  })

  it('shows the refusal of a promotion in the detail', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('../../../lib/http')
    const updateRsvp = vi.fn(async () => {
      throw new ApiError(400, 'rsvp.momentsRequired')
    })
    render({ updateRsvp })

    await user.click(await screen.findByRole('button', { name: 'Hugo Attente' }))
    const detail = await screen.findByRole('dialog', { name: 'Hugo Attente' })
    await user.click(within(detail).getByRole('button', { name: text.promote }))

    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      fr.errors['rsvp.momentsRequired'],
    )
  })

  it('keeps a waiting-list reply on the list when the host corrects it, and promotes it when asked', async () => {
    const user = userEvent.setup()
    const updateRsvp = vi.fn(async (_slug: string, _id: string, _input: RsvpReplyInput) => ({
      rsvp: waiting,
    }))
    render({ updateRsvp })

    await user.click(await screen.findByRole('button', { name: 'Hugo Attente' }))
    await user.click(await screen.findByRole('button', { name: text.edit }))
    const form = await screen.findByRole('dialog', { name: text.formEditTitle })
    expect(within(form).getByLabelText(text.answerWaitlist)).toBeChecked()
    await user.click(within(form).getByRole('button', { name: text.formSave }))
    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(1))
    expect(updateRsvp.mock.calls[0]?.[2]).toMatchObject({ answer: 'waitlist' })

    await user.click(await screen.findByRole('button', { name: 'Hugo Attente' }))
    await user.click(await screen.findByRole('button', { name: text.edit }))
    const again = await screen.findByRole('dialog', { name: text.formEditTitle })
    await user.click(within(again).getByLabelText(text.answerYes))
    await user.click(within(again).getByRole('button', { name: text.formSave }))
    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(2))
    expect(updateRsvp.mock.calls[1]?.[2]).toMatchObject({ answer: 'yes' })
  })

  it('offers the waiting list as an answer only for a reply that is on it', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: text.add }))

    const form = await screen.findByRole('dialog', { name: text.formAddTitle })
    expect(within(form).queryByLabelText(text.answerWaitlist)).not.toBeInTheDocument()
  })
})
