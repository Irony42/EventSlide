import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'

const plain = (sentence: string): string => sentence.replaceAll(String.fromCharCode(160), ' ')
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
 * The lot 2 form on the guest's phone (spec 30): the companions' first names, a menu per person and
 * the host's questions, asked after "je viens" on the same screen.
 */

const TOKEN = '7QX0M4TZ2KD9WB3H'
const t = fr.rsvp.guest

const page = aGuestRsvpPage({
  form: {
    ...aGuestRsvpPage().form,
    companionNames: true,
    meals: { enabled: true, options: ['Poisson', 'Végé'] },
    questions: [
      { id: 'aaaaaaa1', label: 'Un chant ?', kind: 'text' },
      { id: 'aaaaaaa2', label: 'Venez-vous en voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
    ],
  },
})

const render = (api: Partial<Api> = {}, withPage = page) =>
  renderWithProviders(<GuestRsvpBlock rsvp={withPage} token={TOKEN} locale="fr" />, {
    api: fakeApi(api),
  })

beforeEach(() => {
  window.localStorage.clear()
  forgetEditToken(TOKEN)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the lot 2 fields', () => {
  it('asks for a companion per extra person, and a menu per person, once the answer is yes', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: t.yes }))
    // One adult: nobody comes along, but there is a menu for the guest.
    expect(screen.queryByLabelText(t.companionLabel(1))).not.toBeInTheDocument()
    expect(screen.getAllByRole('combobox', { name: /Menu de/ })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.adults}`) }))
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.kids}`) }))

    expect(screen.getByLabelText(t.companionLabel(1))).toBeInTheDocument()
    expect(screen.getByLabelText(t.companionLabel(2))).toBeInTheDocument()
    expect(screen.queryByLabelText(t.companionLabel(3))).not.toBeInTheDocument()
    expect(screen.getAllByRole('combobox', { name: /Menu de/ })).toHaveLength(3)
  })

  it('names a person in the menu field by the first name typed for them', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.adults}`) }))
    await user.type(screen.getByLabelText(t.companionLabel(1)), 'Hugo')

    expect(screen.getByRole('combobox', { name: t.mealFor('Léa') })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: t.mealFor('Hugo') })).toBeInTheDocument()
  })

  it('sends the companions, the menus chosen and the answers, by question id', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async () => ({ rsvp: aGuestOwnRsvp(), editToken: 'tok' }))
    render({ guestRsvpCreate })

    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.adults}`) }))
    await user.type(screen.getByLabelText(t.companionLabel(1)), 'Hugo')
    await user.selectOptions(screen.getByRole('combobox', { name: t.mealFor('Léa') }), 'Poisson')
    await user.selectOptions(screen.getByRole('combobox', { name: t.mealFor('Hugo') }), 'Végé')
    await user.type(screen.getByLabelText(/Un chant/), 'Le Temps des cerises')
    await user.selectOptions(screen.getByLabelText(/Venez-vous en voiture/), 'Oui')
    await user.click(screen.getByRole('button', { name: t.send }))

    await screen.findByRole('button', { name: t.edit })
    expect(guestRsvpCreate).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        companions: ['Hugo'],
        meals: ['Poisson', 'Végé'],
        answers: [
          { questionId: 'aaaaaaa1', value: 'Le Temps des cerises' },
          { questionId: 'aaaaaaa2', value: 'Oui' },
        ],
      }),
    )
  })

  it('asks no menu of a maybe and nothing of a no, but still the questions of a maybe', async () => {
    const user = userEvent.setup()
    render({}, aGuestRsvpPage({ form: { ...page.form, maybe: true } }))

    await user.click(screen.getByRole('button', { name: t.maybe }))
    expect(screen.queryByRole('combobox', { name: /Menu de/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Un chant/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t.no }))
    expect(screen.queryByLabelText(/Un chant/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(t.companionLabel(1))).not.toBeInTheDocument()
  })

  it('shows what was sent in the confirmation, a removed question’s answer included', async () => {
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render({
      guestRsvp: vi.fn(async () => ({
        rsvp: aGuestOwnRsvp({
          adults: 2,
          companions: ['Hugo'],
          meals: ['Poisson', 'Végé'],
          answers: [
            { questionId: 'aaaaaaa1', label: 'Un chant ?', value: 'Oh' },
            { questionId: 'gone', label: 'Une ancienne question ?', value: 'Oui' },
            { questionId: 'aaaaaaa2', label: 'Venez-vous en voiture ?', value: '' },
          ],
        }),
      })),
    })

    expect(await screen.findByText(plain(t.recapCompanions('Hugo')))).toBeInTheDocument()
    expect(screen.getByText(plain(t.recapMeals('Poisson, Végé')))).toBeInTheDocument()
    expect(screen.getByText(plain(t.recapAnswer('Un chant ?', 'Oh')))).toBeInTheDocument()
    expect(
      screen.getByText(plain(t.recapAnswer('Une ancienne question ?', 'Oui'))),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Venez-vous en voiture/)).not.toBeInTheDocument()
  })

  it('starts a change from what the reply holds', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, JSON.stringify({ editToken: 'tok' }))
    render({
      guestRsvp: vi.fn(async () => ({
        rsvp: aGuestOwnRsvp({
          name: 'Léa Martin',
          adults: 2,
          kids: 0,
          companions: ['Hugo'],
          meals: ['Poisson', 'Végé'],
          answers: [{ questionId: 'aaaaaaa1', label: 'Un chant ?', value: 'Oh' }],
        }),
      })),
    })

    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.getByLabelText(t.companionLabel(1))).toHaveValue('Hugo')
    expect(screen.getByRole('combobox', { name: t.mealFor('Hugo') })).toHaveValue('Végé')
    expect(screen.getByLabelText(/Un chant/)).toHaveValue('Oh')
  })
})

describe('a page the host changed meanwhile, and a reply too large', () => {
  const sendOne = async (guestRsvpCreate: Api['guestRsvpCreate'], onStale = vi.fn()) => {
    const user = userEvent.setup()
    renderWithProviders(
      <GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" onStale={onStale} />,
      { api: fakeApi({ guestRsvpCreate }) },
    )
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.type(screen.getByLabelText(/Un chant/), 'Le Temps des cerises')
    await user.click(screen.getByRole('button', { name: t.send }))
    return onStale
  }

  it('asks the page to read the form again when a menu is no longer offered, keeping what was typed', async () => {
    const onStale = await sendOne(
      vi.fn().mockRejectedValue(new ApiError(400, 'rsvp.mealNotOffered')),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/ont changé/)
    expect(onStale).toHaveBeenCalled()
    expect(screen.getByLabelText(/Un chant/)).toHaveValue('Le Temps des cerises')
    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Léa Martin')
  })

  it('does the same for a choice that is gone', async () => {
    const onStale = await sendOne(
      vi.fn().mockRejectedValue(new ApiError(400, 'rsvp.answerNotAnOption')),
    )

    await screen.findByRole('alert')
    expect(onStale).toHaveBeenCalled()
  })

  it('does not ask for a new page for any other refusal', async () => {
    const onStale = await sendOne(vi.fn().mockRejectedValue(new ApiError(400, 'rsvp.nameEmpty')))

    await screen.findByRole('alert')
    expect(onStale).not.toHaveBeenCalled()
  })

  it('says a reply that is too large to be sent in a readable sentence', async () => {
    await sendOne(vi.fn().mockRejectedValue(new ApiError(413, 'request.tooLarge')))

    expect(await screen.findByRole('alert')).toHaveTextContent(t.tooLarge)
  })
})
