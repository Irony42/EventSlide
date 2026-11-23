import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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
 * The moments on the guest's phone (spec 30, lot 4): a checkbox per moment of the party after "je
 * viens", none pre-ticked, only the moments a household is invited to, and what is sent is what is
 * ticked among what the form still offers.
 */

const TOKEN = '7QX0M4TZ2KD9WB3H'
const t = fr.rsvp.guest
const BRUNCH = { id: 'aaaaaaaa', label: 'Brunch' }
const DINNER = { id: 'bbbbbbbb', label: 'Dîner' }

const page = aGuestRsvpPage({ form: { ...aGuestRsvpPage().form, moments: [BRUNCH, DINNER] } })

const render = (api: Partial<Api> = {}, withPage = page) =>
  renderWithProviders(<GuestRsvpBlock rsvp={withPage} token={TOKEN} locale="fr" />, {
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

describe('the moments of the party, on the guest’s phone', () => {
  it('asks the moments after a yes or a maybe, none ticked, and not after a no', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: t.yes }))
    expect(screen.getByRole('checkbox', { name: BRUNCH.label })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: DINNER.label })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: t.maybe }))
    expect(screen.getByRole('checkbox', { name: BRUNCH.label })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.no }))
    expect(screen.queryByRole('checkbox', { name: BRUNCH.label })).not.toBeInTheDocument()
  })

  it('asks nothing when the host has no moment', async () => {
    const user = userEvent.setup()
    render({}, aGuestRsvpPage())

    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.queryByText(t.momentsLabel)).not.toBeInTheDocument()
  })

  it('sends the moments ticked', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async (_token: string, _input: GuestRsvpCreateInput) => ({
      rsvp: aGuestOwnRsvp({ moments: [DINNER.id] }),
      editToken: 'tok',
    }))
    render({ guestRsvpCreate })

    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('checkbox', { name: DINNER.label }))
    await user.click(screen.getByRole('button', { name: t.send }))

    expect(guestRsvpCreate.mock.calls[0]?.[1]).toMatchObject({ moments: [DINNER.id] })
    expect(
      await screen.findByText(
        (text) => text.replaceAll(String.fromCharCode(160), ' ') === 'Moments : Dîner',
      ),
    ).toBeInTheDocument()
  })

  it('shows the refusal in the page when no moment was ticked, and keeps what was typed', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async () => {
      throw new ApiError(400, 'rsvp.momentsRequired')
    })
    render({ guestRsvpCreate })

    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rsvp.momentsRequired'])
    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Léa Martin')
  })

  it('opens a change on the moments chosen that the form still offers', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render({
      guestRsvp: vi.fn(async () => ({
        rsvp: aGuestOwnRsvp({ moments: [BRUNCH.id, 'removed0'] }),
      })),
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.getByRole('checkbox', { name: BRUNCH.label })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: DINNER.label })).not.toBeChecked()
  })
})

describe('a household’s moments', () => {
  const LINK = '7QX0M4TZ2KD9WB3H'

  it('asks only the moments the household is invited to', async () => {
    window.history.replaceState(null, '', `/#f=${LINK}`)
    const user = userEvent.setup()
    render({
      guestHousehold: vi.fn(async () => ({
        household: { name: 'Famille Martin', places: 4, moments: [DINNER] },
      })),
    })

    await user.click(await screen.findByRole('button', { name: t.yes }))

    expect(screen.getByRole('checkbox', { name: DINNER.label })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: BRUNCH.label })).not.toBeInTheDocument()
  })
})

describe('a page left open while the moments changed', () => {
  const LINK = '7QX0M4TZ2KD9WB3H'
  const refused = (): never =>
    vi.fn(async () => {
      throw new ApiError(400, 'rsvp.momentsRequired')
    }) as never

  it('does not re-read anything for the plain case of nothing ticked', async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    renderWithProviders(
      <GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" onStale={onStale} />,
      {
        api: fakeApi({ guestRsvpCreate: refused() }),
      },
    )

    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onStale).not.toHaveBeenCalled()
  })

  it('links the hint and the refusal to the moments, and marks them invalid when none is ticked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />, {
      api: fakeApi({ guestRsvpCreate: refused() }),
    })

    await user.click(screen.getByRole('button', { name: t.yes }))
    const group = screen.getByRole('group', { name: t.momentsLabel })
    expect(group).toHaveAccessibleDescription(t.momentsHint)
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: t.send }))

    await screen.findByRole('alert')
    expect(group).toHaveAccessibleDescription(
      new RegExp(t.momentsHint + '.*' + fr.errors['rsvp.momentsRequired']),
    )
    expect(screen.getByRole('checkbox', { name: BRUNCH.label })).toBeInvalid()
  })

  it('explains, when a change opens on a reply whose moments are gone, that one must be chosen again', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />, {
      api: fakeApi({
        guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ moments: ['removed0'] }) })),
      }),
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))

    const flat = (words: string): string => words.replaceAll(String.fromCharCode(160), ' ')
    expect(screen.getByText((content) => flat(content) === flat(t.momentsGone))).toBeInTheDocument()
    expect(screen.getByRole('group', { name: t.momentsLabel })).toHaveAccessibleDescription(
      new RegExp(flat(t.momentsGone).slice(0, 20)),
    )
  })

  it('does not explain it when the reply still holds a moment', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />, {
      api: fakeApi({
        guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ moments: [BRUNCH.id] }) })),
      }),
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.queryByText(t.momentsGone)).not.toBeInTheDocument()
  })

  it('re-reads the page and the household when something was ticked and none survives', async () => {
    window.history.replaceState(null, '', `/#f=${LINK}`)
    const user = userEvent.setup()
    const onStale = vi.fn()
    const guestHousehold = vi.fn(async () => ({
      household: { name: 'Famille Martin', places: 4, moments: [DINNER] },
    }))
    renderWithProviders(
      <GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" onStale={onStale} />,
      {
        api: fakeApi({ guestHousehold, guestHouseholdRsvpCreate: refused() }),
      },
    )

    await user.click(await screen.findByRole('button', { name: t.yes }))
    await user.click(screen.getByRole('checkbox', { name: DINNER.label }))
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() => expect(onStale).toHaveBeenCalled())
    await waitFor(() => expect(guestHousehold.mock.calls.length).toBeGreaterThan(1))
  })
})
