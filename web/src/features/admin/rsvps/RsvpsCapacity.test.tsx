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
const settings = { ...base, form: { ...base.form, capacity: 10 } }
const tight = { ...base, form: { ...base.form, capacity: 2 } }

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
  rsvpDigest: false,
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

describe('promoting past the capacity, and the order of the list', () => {
  const older = anRsvp({
    id: 'r-old',
    name: 'Ancien Attente',
    answer: 'waitlist',
    adults: 1,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-23T08:00:00.000Z',
  })
  const newer = anRsvp({
    id: 'r-new',
    name: 'Récent Attente',
    answer: 'waitlist',
    adults: 1,
    createdAt: '2026-11-22T08:00:00.000Z',
    updatedAt: '2026-11-22T08:00:00.000Z',
  })

  it('sorts the waiting-list tab oldest first by arrival, not by last change, and says so', async () => {
    const user = userEvent.setup()
    render({ rsvps: vi.fn(async () => ({ ...list(), rsvps: [coming, newer, older] })) })

    await user.click(
      within(await screen.findByRole('group', { name: text.tabsLabel })).getByRole('button', {
        name: new RegExp(`^${text.tabWaitlist}`),
      }),
    )

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ancien Attente'),
      expect.stringContaining('Récent Attente'),
    ])
    const flat = (words: string): string => words.replaceAll(String.fromCharCode(160), ' ')
    expect(
      screen.getByText((content) => flat(content) === flat(text.waitlistOrderHint)),
    ).toBeInTheDocument()
  })

  it('asks once more before a promotion that goes past the capacity, and promotes on the second click', async () => {
    const user = userEvent.setup()
    const updateRsvp = vi.fn(async (_slug: string, _id: string, _input: RsvpReplyInput) => ({
      rsvp: waiting,
    }))
    // Two people already come under a capacity of two: the waiting reply of three goes past it.
    render({ updateRsvp, rsvps: vi.fn(async () => ({ ...list(), rsvpForm: tight })) })

    await user.click(await screen.findByRole('button', { name: 'Hugo Attente' }))
    const detail = await screen.findByRole('dialog', { name: 'Hugo Attente' })
    await user.click(within(detail).getByRole('button', { name: text.promote }))

    expect(updateRsvp).not.toHaveBeenCalled()
    expect(within(detail).getByRole('alert')).toHaveTextContent(text.promoteOver(2))
    await user.click(within(detail).getByRole('button', { name: text.promoteAnyway }))
    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(1))
  })

  it('promotes at once when the reply still fits', async () => {
    const user = userEvent.setup()
    const updateRsvp = vi.fn(async (_slug: string, _id: string, _input: RsvpReplyInput) => ({
      rsvp: waiting,
    }))
    const roomy = {
      ...list([coming, older]),
      rsvpForm: { ...settings, form: { ...settings.form, capacity: 10 } },
    }
    render({ updateRsvp, rsvps: vi.fn(async () => roomy) })

    await user.click(await screen.findByRole('button', { name: 'Ancien Attente' }))
    const detail = await screen.findByRole('dialog', { name: 'Ancien Attente' })
    await user.click(within(detail).getByRole('button', { name: text.promote }))

    await waitFor(() => expect(updateRsvp).toHaveBeenCalledTimes(1))
  })

  it('hints on the yes tile when the people coming are past the capacity, and not otherwise', async () => {
    const over = {
      ...list(),
      rsvpForm: tight,
      stats: { ...list().stats, yes: { responses: 1, people: 5, adults: 5, kids: 0 } },
    }
    const { unmount } = render({ rsvps: vi.fn(async () => over) })
    expect(await screen.findByText(new RegExp(text.overCapacity(2)))).toBeInTheDocument()
    unmount()

    render()
    await screen.findByRole('table')
    expect(screen.queryByText(new RegExp(text.overCapacity(10)))).not.toBeInTheDocument()
  })
})
