import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { forgetEditToken } from '../../lib/rsvp/rsvpDevice'
import type { Api } from '../../lib/api/client'
import {
  aGuestOwnRsvp,
  aGuestRsvpPage,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { GuestRsvpBlock } from './GuestRsvpBlock'

/**
 * "Qui vient" on the guest's phone (spec 30, PR 7): the count or the first names under the buttons,
 * and the box "Montrer mon prénom", the guest's own choice, off until they tick it.
 */

const TOKEN = '7QX0M4TZ2KD9WB3H'
const t = fr.rsvp.guest
const plain = (sentence: string): string => sentence.replaceAll(String.fromCharCode(160), ' ')

const withVisibility = (
  visibility: 'off' | 'count' | 'names',
  proof?: { count: number; names: string[] },
) =>
  aGuestRsvpPage({
    form: { ...aGuestRsvpPage().form, visibility },
    ...(proof === undefined ? {} : { proof }),
  })

const render = (page = withVisibility('names'), api: Partial<Api> = {}) =>
  renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />, {
    api: fakeApi(api),
  })

beforeEach(() => {
  window.localStorage.clear()
  forgetEditToken(TOKEN)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('who comes, under the buttons', () => {
  it('says the first names and how many others come', () => {
    render(withVisibility('names', { count: 25, names: ['Léa', 'Hugo', 'Inès'] }))

    expect(screen.getByText(plain(t.proofNamesAndMany('Léa, Hugo, Inès', 22)))).toBeInTheDocument()
  })

  it('says the number alone when the host counts, and nothing when the page carries no proof', () => {
    const { unmount } = render(withVisibility('count', { count: 50, names: [] }))
    expect(screen.getByText(plain(t.proofCount(50)))).toBeInTheDocument()
    unmount()

    render(withVisibility('off'))
    expect(screen.queryByText(/ont dit oui/)).not.toBeInTheDocument()
  })
})

describe('the box "Montrer mon prénom"', () => {
  it('is there for a yes while first names are shown, unticked, and with the notice that says so', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.getByRole('checkbox', { name: t.showNameLabel })).not.toBeChecked()
    expect(screen.getByText(t.noticeNames)).toBeInTheDocument()
    expect(screen.queryByText(t.notice)).not.toBeInTheDocument()
  })

  it('is absent for a maybe, a no, and when the host shows a count or nothing', async () => {
    const user = userEvent.setup()
    const { unmount } = render()
    await user.click(screen.getByRole('button', { name: t.maybe }))
    expect(screen.queryByRole('checkbox', { name: t.showNameLabel })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.no }))
    expect(screen.queryByRole('checkbox', { name: t.showNameLabel })).not.toBeInTheDocument()
    unmount()

    for (const visibility of ['count', 'off'] as const) {
      const view = render(withVisibility(visibility))
      await user.click(screen.getByRole('button', { name: t.yes }))
      expect(screen.queryByRole('checkbox', { name: t.showNameLabel })).not.toBeInTheDocument()
      expect(
        screen.getByText(visibility === 'count' ? t.noticeCount : t.notice),
      ).toBeInTheDocument()
      view.unmount()
    }
  })

  it('shows, live, exactly the first word of the name that would be published', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: t.yes }))
    expect(screen.queryByText(/Sera montré/)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')

    expect(screen.getByText(plain(t.showNameShown('Léa')))).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: t.showNameLabel })).toBeInTheDocument()
  })

  it('says in the notice that the first name or the count is seen by anyone with the link', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.getByText(t.noticeNames)).toHaveTextContent(/toute personne qui a le lien/)
    expect(t.noticeCount).toMatch(/toute personne qui a le lien/)
    expect(t.noticeNames).not.toMatch(/que par l’organisateur/)
  })

  it('sends the tick, and nothing at all when the host does not show names', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async () => ({ rsvp: aGuestOwnRsvp(), editToken: 'tok' }))
    const view = render(withVisibility('names'), { guestRsvpCreate })
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('checkbox', { name: t.showNameLabel }))
    await user.click(screen.getByRole('button', { name: t.send }))
    await screen.findByRole('button', { name: t.edit })
    expect(guestRsvpCreate).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ showName: true }))
    view.unmount()
    window.localStorage.clear()

    const quiet = vi.fn(async (_token: string, _input: unknown) => ({
      rsvp: aGuestOwnRsvp(),
      editToken: 'tok2',
    }))
    render(withVisibility('count'), { guestRsvpCreate: quiet })
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: t.send }))
    await screen.findByRole('button', { name: t.edit })
    expect(quiet.mock.calls[0]?.[1]).not.toHaveProperty('showName')
  })

  it('is ticked again when the guest changes a reply that agreed, and the confirmation says so', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render(withVisibility('names'), {
      guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ showName: true }) })),
    })

    expect(await screen.findByText(t.recapShowName)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.edit }))

    expect(screen.getByRole('checkbox', { name: t.showNameLabel })).toBeChecked()
  })
})
