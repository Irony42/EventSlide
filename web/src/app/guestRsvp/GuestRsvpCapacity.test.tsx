import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { forgetEditToken, forgetHouseholdToken } from '../../lib/rsvp/rsvpDevice'
import type { Api } from '../../lib/api/client'
import type { GuestRsvpCreateInput } from '../../lib/api/client/invite'
import {
  aGuestOwnRsvp,
  aGuestRsvpPage,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { GuestRsvpBlock } from './GuestRsvpBlock'

/**
 * Limited places on the guest's phone (spec 30, lot 4, PR 14): when the places are taken the page
 * says "C'est complet" and a yes becomes "M'inscrire sur la liste d'attente"; the reply the server
 * stored as a waiting-list entry is told as such, and can still be changed or erased.
 */

const TOKEN = '7QX0M4TZ2KD9WB3H'
const t = fr.rsvp.guest
const flat = (words: string): string => words.replaceAll(String.fromCharCode(160), ' ')

const full = aGuestRsvpPage({ state: 'full' })

const render = (api: Partial<Api> = {}, page = full) =>
  renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />, {
    api: fakeApi(api),
  })

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  forgetEditToken(TOKEN)
  forgetHouseholdToken(TOKEN)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a page whose places are all taken', () => {
  it('says it is full and offers the waiting list in place of a yes', async () => {
    render()

    expect(screen.getByText(t.fullTitle)).toBeInTheDocument()
    expect(screen.getByText((content) => flat(content) === flat(t.fullSub))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.waitlistJoin })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
    // A maybe and a no are never held back.
    expect(screen.getByRole('button', { name: t.maybe })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.no })).toBeInTheDocument()
  })

  it('does not say it when places are free', () => {
    render({}, aGuestRsvpPage())

    expect(screen.queryByText(t.fullTitle)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.yes })).toBeInTheDocument()
  })

  it('sends the yes with the waiting-list label, and tells the reply stored as a waiting-list entry', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async (_token: string, _input: GuestRsvpCreateInput) => ({
      rsvp: aGuestOwnRsvp({ answer: 'waitlist' }),
      editToken: 'tok',
    }))
    render({ guestRsvpCreate })

    await user.click(screen.getByRole('button', { name: t.waitlistJoin }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    // The answer's button and the form's submit carry the same words: the submit is the last.
    const buttons = screen.getAllByRole('button', { name: t.waitlistJoin })
    await user.click(buttons[buttons.length - 1] as HTMLElement)

    expect(guestRsvpCreate.mock.calls[0]?.[1]).toMatchObject({ answer: 'yes' })
    expect(await screen.findByRole('heading', { name: t.doneWaitlist })).toBeInTheDocument()
    expect(screen.getByText(t.waitlistSub)).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent(t.recapWaitlist)
  })

  it('keeps the way to change or erase a waiting-list reply, as for any other', async () => {
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render({
      guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ answer: 'waitlist' }) })),
    })

    expect(await screen.findByRole('button', { name: t.edit })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.delete })).toBeInTheDocument()
  })

  it('does not call a confirmed yes a waiting-list entry, and lets it be changed as a yes', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render({
      guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ answer: 'yes' }) })),
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.getByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.waitlistJoin })).not.toBeInTheDocument()
  })
})

describe('places that are limited, before and after answering', () => {
  const limited = aGuestRsvpPage({ form: { ...aGuestRsvpPage().form, limited: true } })

  it('says the places are limited before answering, and not once the page is full or unlimited', () => {
    const { unmount } = render({}, limited)
    expect(screen.getByText(t.limitedPlaces)).toBeInTheDocument()
    unmount()

    render({}, aGuestRsvpPage())
    expect(screen.queryByText(t.limitedPlaces)).not.toBeInTheDocument()
  })

  it('says it plainly when a waiting-list reply is changed, with no "Oui" as a way out', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render(
      { guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ answer: 'waitlist' }) })) },
      aGuestRsvpPage(),
    )

    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.getByText(t.stayWaitlist)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.stayWaitlistChoice })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: t.maybe })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.no })).toBeInTheDocument()
  })

  it('shows the refusal of a growth beyond the places in the page, and keeps what was typed', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    const guestRsvpUpdate = vi.fn(async (..._args: never[]): Promise<never> => {
      throw new ApiError(409, 'rsvp.full')
    })
    render(
      {
        guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ answer: 'yes' }) })),
        guestRsvpUpdate: guestRsvpUpdate as never,
      },
      aGuestRsvpPage({ state: 'full' }),
    )

    await user.click(await screen.findByRole('button', { name: t.edit }))
    await user.click(screen.getByRole('button', { name: t.save }))

    const alert = await screen.findByRole('alert')
    expect(flat(alert.textContent ?? '')).toBe(flat(fr.errors['rsvp.full']))
    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Léa Martin')
  })
})
