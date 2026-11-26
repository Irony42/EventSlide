import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  forgetEditToken,
  forgetHouseholdToken,
  readStoredEditToken,
  readStoredHouseholdToken,
  storeEditToken,
  storeHouseholdToken,
} from '../../lib/rsvp/rsvpDevice'
import type { Api } from '../../lib/api/client'
import {
  aGuestOwnRsvp,
  aGuestRsvpPage,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { GuestRsvpBlock } from './GuestRsvpBlock'

/**
 * A household's personal link on the guest's phone (spec 30, lot 3, `#f=<token>`): read once and gone
 * from the address bar (StrictMode-safe, like `#r=`), the same form as the common link filled in with
 * the household's name, its places as the ceiling and the counter always asked, one reply for the
 * household (a second answer changes it), the device's memory, and every state of the link.
 */

const TOKEN = '7QX0M4TZ2KD9WB3H'
const LINK = 'AAAAAAAAAAAAAAAA'
const t = fr.rsvp.guest
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

const MARTIN = { household: { name: 'Famille Martin', places: 4, moments: [] } }

const render = (api: Partial<Api> = {}, page = aGuestRsvpPage(), strict = false) => {
  const block = <GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />
  return renderWithProviders(strict ? <StrictMode>{block}</StrictMode> : block, {
    api: fakeApi({ guestHousehold: vi.fn(async () => MARTIN), ...api }),
  })
}

const arriveBy = (hash: string): void => window.history.replaceState(null, '', `/i/${TOKEN}${hash}`)

beforeEach(() => {
  window.localStorage.clear()
  forgetEditToken(TOKEN)
  forgetHouseholdToken(TOKEN)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('the household link: reading it', () => {
  it('reads the link once, removes it from the address bar and keeps it for the device', async () => {
    arriveBy(`?x=1#f=${LINK}`)
    const guestHousehold = vi.fn(async () => MARTIN)
    render({ guestHousehold })

    await screen.findByText(plain(t.householdGreeting('Famille Martin')))

    expect(guestHousehold).toHaveBeenCalledWith(TOKEN, LINK, expect.anything())
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?x=1')
    expect(readStoredHouseholdToken(TOKEN)).toBe(LINK)
  })

  it('survives StrictMode running the initializer twice: the link is read, not lost with the first look', async () => {
    arriveBy(`#f=${LINK}`)
    const guestHousehold = vi.fn(async () => MARTIN)
    render({ guestHousehold }, aGuestRsvpPage(), true)

    await screen.findByText(plain(t.householdGreeting('Famille Martin')))

    expect(guestHousehold).toHaveBeenCalledWith(TOKEN, LINK, expect.anything())
    expect(guestHousehold).not.toHaveBeenCalledWith(
      TOKEN,
      expect.not.stringMatching(LINK),
      expect.anything(),
    )
    expect(window.location.hash).toBe('')
  })

  it('finds the household again from the device’s memory, with no fragment', async () => {
    storeHouseholdToken(TOKEN, LINK)
    const guestHousehold = vi.fn(async () => MARTIN)
    render({ guestHousehold })

    await screen.findByText(plain(t.householdGreeting('Famille Martin')))

    expect(guestHousehold).toHaveBeenCalledWith(TOKEN, LINK, expect.anything())
  })

  it('prefers a link on the address to what the device remembers, and still offers the older reply token', async () => {
    storeHouseholdToken(TOKEN, 'REMEMBEREDHOUSEH')
    storeEditToken(TOKEN, 'remembered-reply-token')
    arriveBy(`#f=${LINK}`)
    const guestHousehold = vi.fn(async () => MARTIN)
    const guestRsvp = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))
    render({ guestHousehold, guestRsvp })

    await screen.findByText(plain(t.householdGreeting('Famille Martin')))

    expect(guestHousehold).toHaveBeenCalledWith(TOKEN, LINK, expect.anything())
    // The reply token the device also holds is read too: offered aside, never silently shadowed.
    expect(guestRsvp).toHaveBeenCalledWith(TOKEN, 'remembered-reply-token', expect.anything())
    expect(await screen.findByText(plain(t.olderReply('Léa Martin')))).toBeInTheDocument()
  })

  it('prefers the household the device remembers, and still offers the older reply token', async () => {
    storeHouseholdToken(TOKEN, LINK)
    storeEditToken(TOKEN, 'remembered-reply-token')
    const guestHousehold = vi.fn(async () => MARTIN)
    const guestRsvp = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))
    render({ guestHousehold, guestRsvp })

    await screen.findByText(plain(t.householdGreeting('Famille Martin')))
    expect(guestHousehold).toHaveBeenCalledWith(TOKEN, LINK, expect.anything())
    expect(guestRsvp).toHaveBeenCalledWith(TOKEN, 'remembered-reply-token', expect.anything())
    expect(await screen.findByText(plain(t.olderReply('Léa Martin')))).toBeInTheDocument()
  })

  it('works with no memory at all: the link is enough for the visit', async () => {
    arriveBy(`#f=${LINK}`)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render()

    expect(
      await screen.findByText(plain(t.householdGreeting('Famille Martin'))),
    ).toBeInTheDocument()
  })

  it('takes a fragment that is not a token out of the bar and treats the link as the common one', async () => {
    arriveBy('#f=<script>')
    const guestHousehold = vi.fn(async () => MARTIN)
    render({ guestHousehold })

    expect(await screen.findByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(guestHousehold).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('does not read it in the host’s preview, and still takes it out of the bar', async () => {
    arriveBy(`#f=${LINK}`)
    const guestHousehold = vi.fn(async () => MARTIN)
    renderWithProviders(
      <GuestRsvpBlock rsvp={aGuestRsvpPage()} token={TOKEN} locale="fr" interactive={false} />,
      { api: fakeApi({ guestHousehold }) },
    )

    await screen.findByRole('group')
    expect(guestHousehold).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(readStoredHouseholdToken(TOKEN)).toBeNull()
  })
})

describe('the household link: the form', () => {
  it('greets the household and says its places, the form filled in with its name', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    render()

    expect(
      await screen.findByText(plain(t.householdGreeting('Famille Martin'))),
    ).toBeInTheDocument()
    expect(screen.getByText(t.householdPlaces(4))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.yes }))
    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Famille Martin')
  })

  it('says "one place" for a household of one', async () => {
    arriveBy(`#f=${LINK}`)
    render({
      guestHousehold: vi.fn(async () => ({ household: { name: 'Hugo', places: 1, moments: [] } })),
    })

    expect(await screen.findByText(t.householdPlaces(1))).toBeInTheDocument()
  })

  it('takes the places as the ceiling, not the form’s maximum of 4', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    render({
      guestHousehold: vi.fn(async () => ({
        household: { name: 'Les Roux', places: 6, moments: [] },
      })),
    })
    await screen.findByText(t.householdPlaces(6))
    await user.click(screen.getByRole('button', { name: t.yes }))

    const more = screen.getByRole('button', { name: `${t.more} · ${t.adults}` })
    for (let i = 0; i < 8; i += 1) await user.click(more)

    expect(screen.getByLabelText(t.adults, { selector: 'output' })).toHaveTextContent('6')
    expect(screen.getByText(t.howManyHint(6))).toBeInTheDocument()
  })

  it('always asks how many, even when the host does not: a household of four is not one person', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const page = aGuestRsvpPage({
      form: { ...aGuestRsvpPage().form, partySize: { enabled: false, max: 4 } },
    })
    render({}, page)
    await screen.findByText(t.householdPlaces(4))

    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.getByLabelText(t.adults, { selector: 'output' })).toBeInTheDocument()
  })

  it('asks the companions’ first names for the whole household when the host asks them', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const page = aGuestRsvpPage({ form: { ...aGuestRsvpPage().form, companionNames: true } })
    render({}, page)
    await screen.findByText(t.householdPlaces(4))
    await user.click(screen.getByRole('button', { name: t.yes }))

    await user.click(screen.getByRole('button', { name: `${t.more} · ${t.adults}` }))
    await user.click(screen.getByRole('button', { name: `${t.more} · ${t.adults}` }))

    expect(screen.getByLabelText(t.companionLabel(1))).toBeInTheDocument()
    expect(screen.getByLabelText(t.companionLabel(2))).toBeInTheDocument()
  })

  it('answers with the household’s link, no reply token, and shows the recap with no link to copy', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestHouseholdRsvpCreate = vi.fn(async () => ({
      rsvp: aGuestOwnRsvp({ name: 'Famille Martin', adults: 3, kids: 1 }),
    }))
    const guestRsvpCreate = vi.fn()
    render({ guestHouseholdRsvpCreate, guestRsvpCreate })
    await screen.findByText(t.householdPlaces(4))
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.click(screen.getByRole('button', { name: `${t.more} · ${t.adults}` }))
    await user.click(screen.getByRole('button', { name: `${t.more} · ${t.adults}` }))
    await user.click(screen.getByRole('button', { name: `${t.more} · ${t.kids}` }))
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(guestHouseholdRsvpCreate).toHaveBeenCalledWith(
        TOKEN,
        LINK,
        expect.objectContaining({ name: 'Famille Martin', answer: 'yes', adults: 3, kids: 1 }),
      ),
    )
    expect(guestRsvpCreate).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('heading', { name: t.doneYes('Famille Martin') }),
    ).toBeInTheDocument()
    expect(screen.queryByText(t.linkTitle)).not.toBeInTheDocument()
    expect(readStoredEditToken(TOKEN)).toBeNull()
    expect(screen.getByRole('button', { name: t.edit })).toBeInTheDocument()
  })

  it('takes no first name from the household’s name: "Personne 1" for its menu, no box to show it; a person’s name brings both back', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const page = aGuestRsvpPage({
      form: {
        ...aGuestRsvpPage().form,
        visibility: 'names',
        meals: { enabled: true, options: ['Volaille', 'Végétarien'] },
      },
    })
    render({}, page)
    await screen.findByText(t.householdPlaces(4))
    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.getByLabelText(t.mealFor(t.personFallback(1)))).toBeInTheDocument()
    expect(screen.queryByLabelText(/Menu de Famille/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: t.showNameLabel })).not.toBeInTheDocument()

    const name = screen.getByLabelText(new RegExp(t.nameLabel))
    await user.clear(name)
    await user.type(name, 'Paul Martin')

    expect(screen.getByLabelText(t.mealFor('Paul'))).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: t.showNameLabel })).toBeInTheDocument()
    expect(screen.getByText(plain(t.showNameShown('Paul')))).toBeInTheDocument()
  })
})

describe('the household link: one reply for the household', () => {
  it('shows the reply the household already gave, on any device that opens the link, and changes it instead of adding one', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestHouseholdRsvpUpdate = vi.fn(async () => ({
      rsvp: aGuestOwnRsvp({ name: 'Famille Martin', answer: 'no', adults: 0, kids: 0 }),
    }))
    const guestHouseholdRsvpCreate = vi.fn()
    render({
      guestHousehold: vi.fn(async () => ({
        household: {
          ...MARTIN.household,
          rsvp: aGuestOwnRsvp({ name: 'Famille Martin', adults: 3, kids: 0 }),
        },
      })),
      guestHouseholdRsvpUpdate,
      guestHouseholdRsvpCreate,
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))
    await user.click(screen.getByRole('button', { name: t.no }))
    await user.click(screen.getByRole('button', { name: t.save }))

    await waitFor(() =>
      expect(guestHouseholdRsvpUpdate).toHaveBeenCalledWith(
        TOKEN,
        LINK,
        expect.objectContaining({ answer: 'no' }),
      ),
    )
    expect(guestHouseholdRsvpCreate).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('heading', { name: t.doneNo('Famille Martin') }),
    ).toBeInTheDocument()
  })

  it('deletes the household’s reply with its link, keeps the link, and lets the household answer again', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestHouseholdRsvpDelete = vi.fn(async () => undefined)
    render({
      guestHousehold: vi.fn(async () => ({
        household: { ...MARTIN.household, rsvp: aGuestOwnRsvp({ name: 'Famille Martin' }) },
      })),
      guestHouseholdRsvpDelete,
    })

    await user.click(await screen.findByRole('button', { name: t.delete }))
    await user.click(screen.getByRole('button', { name: t.deleteYes }))

    await waitFor(() => expect(guestHouseholdRsvpDelete).toHaveBeenCalledWith(TOKEN, LINK))
    expect(await screen.findByText(t.deleted)).toBeInTheDocument()
    expect(readStoredHouseholdToken(TOKEN)).toBe(LINK)
  })

  it('reads the reply back from the memory on a later visit, with no fragment', async () => {
    storeHouseholdToken(TOKEN, LINK)
    render({
      guestHousehold: vi.fn(async () => ({
        household: { ...MARTIN.household, rsvp: aGuestOwnRsvp({ name: 'Famille Martin' }) },
      })),
    })

    expect(
      await screen.findByRole('heading', { name: t.doneYes('Famille Martin') }),
    ).toBeInTheDocument()
  })

  it('shows the closed state with the reply the link holds, and keeps the right to erase', async () => {
    arriveBy(`#f=${LINK}`)
    render(
      {
        guestHousehold: vi.fn(async () => ({
          household: { ...MARTIN.household, rsvp: aGuestOwnRsvp({ name: 'Famille Martin' }) },
        })),
      },
      aGuestRsvpPage({ state: 'closed' }),
    )

    expect(await screen.findByText(t.closedTitle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.delete })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.edit })).not.toBeInTheDocument()
  })
})

describe('the household link: when it does not work', () => {
  it('forgets a link the box refuses and answers as the common link, saying so once', async () => {
    arriveBy(`#f=${LINK}`)
    render({
      guestHousehold: vi.fn(async () => {
        throw new ApiError(404, 'rsvp.notFound')
      }),
    })

    expect(await screen.findByText(plain(t.householdGone))).toBeInTheDocument()
    expect(readStoredHouseholdToken(TOKEN)).toBeNull()
    expect(screen.getByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(screen.queryByText(plain(t.householdGreeting('Famille Martin')))).not.toBeInTheDocument()
  })

  it('keeps the memory and offers to ask again when the network fails, and reads the household then', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestHousehold = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue(MARTIN)
    render({ guestHousehold })

    expect(await screen.findByRole('alert')).toHaveTextContent(plain(t.householdFailed))
    expect(readStoredHouseholdToken(TOKEN)).toBe(LINK)
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.householdRetry }))

    expect(
      await screen.findByText(plain(t.householdGreeting('Famille Martin'))),
    ).toBeInTheDocument()
    expect(guestHousehold).toHaveBeenCalledTimes(2)
  })

  it('drops the link when the household answers a write with "not found", and says so', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    render({
      guestHouseholdRsvpCreate: vi.fn(async () => {
        throw new ApiError(404, 'rsvp.notFound')
      }),
    })
    await screen.findByText(t.householdPlaces(4))
    await user.click(screen.getByRole('button', { name: t.no }))
    await user.click(screen.getByRole('button', { name: t.send }))

    expect(await screen.findByText(plain(t.householdGone))).toBeInTheDocument()
    expect(readStoredHouseholdToken(TOKEN)).toBeNull()
  })

  it('shows the sentence of a refusal in the form, the closed window included', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    render({
      guestHouseholdRsvpCreate: vi.fn(async () => {
        throw new ApiError(409, 'rsvp.closed')
      }),
    })
    await screen.findByText(t.householdPlaces(4))
    await user.click(screen.getByRole('button', { name: t.no }))
    await user.click(screen.getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(plain(fr.errors['rsvp.closed']))
    expect(within(screen.getByRole('alert')).queryByText(t.householdGone)).not.toBeInTheDocument()
  })

  it('shows nothing while replies are not asked and the household holds no reply', async () => {
    arriveBy(`#f=${LINK}`)
    const view = render({}, aGuestRsvpPage({ state: 'off' }))

    await waitFor(() => expect(view.container.querySelector('[aria-busy]')).toBeNull())
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
  })
})

describe('the household link: what review of #548 asked', () => {
  const answered = (overrides = {}) => ({
    household: {
      ...MARTIN.household,
      rsvp: aGuestOwnRsvp({ name: 'Famille Martin', ...overrides }),
    },
  })

  it('keeps the link when the reply was erased on another phone: the household is asked again, the link is not dropped', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestHouseholdRsvpUpdate = vi.fn(async () => {
      throw new ApiError(404, 'rsvp.notFound')
    })
    const guestRsvpCreate = vi.fn()
    render({
      guestHousehold: vi.fn(async () => answered()),
      guestHouseholdRsvpUpdate,
      guestRsvpCreate,
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))
    await user.click(screen.getByRole('button', { name: t.no }))
    await user.click(screen.getByRole('button', { name: t.save }))

    await waitFor(() => expect(guestHouseholdRsvpUpdate).toHaveBeenCalledTimes(1))
    // Still the household's form, with its greeting and its link kept for the device.
    expect(
      await screen.findByText(plain(t.householdGreeting('Famille Martin'))),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(screen.queryByText(plain(t.householdGone))).not.toBeInTheDocument()
    expect(readStoredHouseholdToken(TOKEN)).toBe(LINK)
    // Answering again goes through the household's link, never as a stray open reply.
    const guestHouseholdRsvpCreate = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))
    expect(guestRsvpCreate).not.toHaveBeenCalled()
    expect(guestHouseholdRsvpCreate).not.toHaveBeenCalled()
  })

  it('answers again with the household’s link after that, and drops the link only when a POST says it is dead', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestHouseholdRsvpUpdate = vi.fn(async () => {
      throw new ApiError(404, 'rsvp.notFound')
    })
    const guestHouseholdRsvpCreate = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))
    const guestRsvpCreate = vi.fn()
    render({
      guestHousehold: vi.fn(async () => answered()),
      guestHouseholdRsvpUpdate,
      guestHouseholdRsvpCreate,
      guestRsvpCreate,
    })
    await user.click(await screen.findByRole('button', { name: t.edit }))
    await user.click(screen.getByRole('button', { name: t.save }))
    await screen.findByRole('button', { name: t.yes })

    await user.click(screen.getByRole('button', { name: t.no }))
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(guestHouseholdRsvpCreate).toHaveBeenCalledWith(TOKEN, LINK, expect.anything()),
    )
    expect(guestRsvpCreate).not.toHaveBeenCalled()
  })

  it('forgets the household when a reply link is opened: the reply link wins over the memory', async () => {
    storeHouseholdToken(TOKEN, LINK)
    arriveBy('#r=fragment-token-1234')
    const guestHousehold = vi.fn(async () => MARTIN)
    const guestRsvp = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))
    render({ guestHousehold, guestRsvp })

    expect(await screen.findByRole('heading', { name: t.doneYes('Léa') })).toBeInTheDocument()
    expect(guestHousehold).not.toHaveBeenCalled()
    expect(readStoredHouseholdToken(TOKEN)).toBeNull()
    expect(readStoredEditToken(TOKEN)).toBe('fragment-token-1234')
  })

  it('offers to erase the older reply this device holds when a household link is opened, and erases it', async () => {
    storeEditToken(TOKEN, 'older-token-1234')
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    const guestRsvpDelete = vi.fn(async () => undefined)
    render({ guestRsvpDelete })

    await screen.findByText(plain(t.householdGreeting('Famille Martin')))
    await user.click(await screen.findByRole('button', { name: t.olderReplyDelete }))

    await waitFor(() => expect(guestRsvpDelete).toHaveBeenCalledWith(TOKEN, 'older-token-1234'))
    await waitFor(() =>
      expect(screen.queryByText(plain(t.olderReply('Léa Martin')))).not.toBeInTheDocument(),
    )
    expect(readStoredEditToken(TOKEN)).toBeNull()
  })

  it('lets a shared phone drop the household with “Ce n’est pas votre foyer ?”, and asks afresh', async () => {
    arriveBy(`#f=${LINK}`)
    storeEditToken(TOKEN, 'older-token-1234')
    const user = userEvent.setup()
    render({ guestHousehold: vi.fn(async () => answered()) })

    await user.click(await screen.findByRole('button', { name: /Ce n.est pas votre foyer/ }))

    expect(await screen.findByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(screen.queryByText(plain(t.householdGreeting('Famille Martin')))).not.toBeInTheDocument()
    expect(readStoredHouseholdToken(TOKEN)).toBeNull()
    expect(readStoredEditToken(TOKEN)).toBeNull()
    expect(screen.queryByText(plain(t.olderReply('Léa Martin')))).not.toBeInTheDocument()
  })

  it('lets a shared phone drop a plain reply too: “Ce n’est pas votre réponse ?”', async () => {
    storeEditToken(TOKEN, 'held-token')
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: /Ce n.est pas votre réponse/ }))

    expect(await screen.findByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(readStoredEditToken(TOKEN)).toBeNull()
    expect(screen.queryByText(plain(t.forgotten))).not.toBeInTheDocument()
  })

  it('says a link that was cut off is incomplete, and asks as the common form', async () => {
    arriveBy('#f=abc')
    const guestHousehold = vi.fn(async () => MARTIN)
    render({ guestHousehold })

    expect(await screen.findByText(plain(t.householdIncomplete))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(guestHousehold).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('says a dead or cut-off link in the closed and off states too', async () => {
    arriveBy('#f=abc')
    const closed = render({}, aGuestRsvpPage({ state: 'closed' }))
    expect(await screen.findByText(plain(t.householdIncomplete))).toBeInTheDocument()
    expect(screen.getByText(t.closedTitle)).toBeInTheDocument()
    closed.unmount()

    forgetHouseholdToken(TOKEN)
    arriveBy(`#f=${LINK}`)
    render(
      {
        guestHousehold: vi.fn(async () => {
          throw new ApiError(404, 'rsvp.notFound')
        }),
      },
      aGuestRsvpPage({ state: 'off' }),
    )
    expect(await screen.findByText(plain(t.householdGone))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
  })

  it('says the dead link in a status region', async () => {
    arriveBy(`#f=${LINK}`)
    render({
      guestHousehold: vi.fn(async () => {
        throw new ApiError(404, 'rsvp.notFound')
      }),
    })

    const sentence = await screen.findByText(plain(t.householdGone))
    expect(sentence).toHaveAttribute('role', 'status')
  })

  it('keeps the household’s name in the empty form after a send and after an erasure', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    render({
      guestHouseholdRsvpCreate: vi.fn(async () => ({
        rsvp: aGuestOwnRsvp({ name: 'Famille Martin' }),
      })),
    })
    await screen.findByText(t.householdPlaces(4))
    await user.click(screen.getByRole('button', { name: t.no }))
    await user.click(screen.getByRole('button', { name: t.send }))
    await screen.findByRole('heading', { name: t.doneYes('Famille Martin') })

    await user.click(screen.getByRole('button', { name: t.delete }))
    await user.click(screen.getByRole('button', { name: t.deleteYes }))
    await screen.findByText(t.deleted)
    await user.click(screen.getByRole('button', { name: t.no }))

    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Famille Martin')
  })

  it('opens the change form inside the household’s places when the host lowered them', async () => {
    arriveBy(`#f=${LINK}`)
    const user = userEvent.setup()
    render({
      guestHousehold: vi.fn(async () => ({
        household: {
          name: 'Famille Martin',
          places: 2,
          moments: [],
          rsvp: aGuestOwnRsvp({ name: 'Famille Martin', adults: 3, kids: 2 }),
        },
      })),
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.getByLabelText(t.adults, { selector: 'output' })).toHaveTextContent('2')
    expect(screen.getByLabelText(t.kids, { selector: 'output' })).toHaveTextContent('0')
  })

  it('takes a link pasted into the tab that is already open: the bar is cleaned and the household read', async () => {
    const guestHousehold = vi.fn(async () => MARTIN)
    render({ guestHousehold })
    await screen.findByRole('button', { name: t.yes })

    window.history.replaceState(null, '', `/i/${TOKEN}#f=${LINK}`)
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(
      await screen.findByText(plain(t.householdGreeting('Famille Martin'))),
    ).toBeInTheDocument()
    expect(guestHousehold).toHaveBeenCalledWith(TOKEN, LINK, expect.anything())
    expect(window.location.hash).toBe('')
    expect(readStoredHouseholdToken(TOKEN)).toBe(LINK)
  })

  it('hides the dot between the greeting and the places from a screen reader', async () => {
    arriveBy(`#f=${LINK}`)
    render()

    const greeting = (await screen.findByText(t.householdPlaces(4))).closest('p')
    expect(greeting?.querySelector('[aria-hidden="true"]')).toHaveTextContent('·')
  })
})
