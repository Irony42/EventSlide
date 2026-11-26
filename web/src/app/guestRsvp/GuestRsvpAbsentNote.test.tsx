import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { ABSENT_NOTE_MAX_CHARS, ABSENT_NOTE_SIGNATURE_MAX_CHARS } from '../../lib/rsvp/absentNote'
import {
  forgetEditToken,
  forgetHouseholdToken,
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
 * The word of a guest who cannot come (spec 30, lot 4), on the invitation's page: offered on the guest's
 * own "no" while the page says a word can be left, one word per reply, the guestbook's sentences when it
 * refuses, the honeypot sent with it, and a household's link as the key too.
 */

const TOKEN = '7QX0M4TZ2KD9WB3H'
const t = fr.rsvp.absent
const no = aGuestOwnRsvp({ answer: 'no', adults: 0, kids: 0, name: 'Léa Martin' })

const render = (api: Partial<Api> = {}, page = aGuestRsvpPage({ absentNoteAvailable: true })) =>
  renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" />, {
    api: fakeApi({ guestRsvp: vi.fn(async () => ({ rsvp: no })), ...api }),
  })

beforeEach(() => {
  window.localStorage.clear()
  forgetEditToken(TOKEN)
  forgetHouseholdToken(TOKEN)
  storeEditToken(TOKEN, 'tok')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the word of those who cannot come', () => {
  it('is offered to a guest who said no, while the page says a word can be left', async () => {
    render()

    expect(await screen.findByRole('button', { name: t.offer })).toBeInTheDocument()
  })

  it.each([
    [
      'the guestbook is closed or the host switched it off',
      aGuestRsvpPage({ absentNoteAvailable: false }),
      no,
    ],
    [
      'the guest said yes',
      aGuestRsvpPage({ absentNoteAvailable: true }),
      aGuestOwnRsvp({ answer: 'yes' }),
    ],
    [
      'the guest said maybe',
      aGuestRsvpPage({ absentNoteAvailable: true }),
      aGuestOwnRsvp({ answer: 'maybe' }),
    ],
  ])('is not offered when %s', async (_name, page, reply) => {
    render({ guestRsvp: vi.fn(async () => ({ rsvp: reply })) }, page)

    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByRole('button', { name: t.offer })).toBeNull()
  })

  it('says a word was already left, and offers none again', async () => {
    render({ guestRsvp: vi.fn(async () => ({ rsvp: { ...no, absentNoteSent: true } })) })

    expect(await screen.findByText(t.already)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.offer })).toBeNull()
  })

  it('opens a form, sends the word with the reply’s token, and thanks the guest', async () => {
    const user = userEvent.setup()
    const guestAbsentNote = vi.fn(async () => ({ absentNoteSent: true as const }))
    render({ guestAbsentNote })

    await user.click(await screen.findByRole('button', { name: t.offer }))
    await user.type(screen.getByLabelText(t.label), 'Dommage, on pense à vous')
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(guestAbsentNote).toHaveBeenCalledWith(
        TOKEN,
        { editToken: 'tok' },
        { text: 'Dommage, on pense à vous', signature: 'Léa', website: '' },
      ),
    )
    expect(await screen.findByText(t.sent)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.offer })).toBeNull()
  })

  it('still says the word was sent after the guest changes their reply and comes back to the page', async () => {
    const user = userEvent.setup()
    const guestRsvpUpdate = vi.fn(async () => ({ rsvp: { ...no, absentNoteSent: true } }))
    render({ guestRsvpUpdate })
    await user.click(await screen.findByRole('button', { name: t.offer }))
    await user.type(screen.getByLabelText(t.label), 'Mon mot')
    await user.click(screen.getByRole('button', { name: t.send }))
    await screen.findByText(t.sent)

    await user.click(screen.getByRole('button', { name: fr.rsvp.guest.edit }))
    await user.click(await screen.findByRole('button', { name: fr.rsvp.guest.save }))

    expect(await screen.findByText(t.already)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.offer })).toBeNull()
  })

  it('uses a household’s link as the key, with no reply token of its own', async () => {
    const user = userEvent.setup()
    forgetEditToken(TOKEN)
    storeHouseholdToken(TOKEN, 'AAAAAAAAAAAAAAAA')
    const guestAbsentNote = vi.fn(async () => ({ absentNoteSent: true as const }))
    render({
      guestHousehold: vi.fn(async () => ({
        household: { name: 'Famille Martin', places: 4, moments: [], rsvp: no },
      })),
      guestAbsentNote,
    })

    await user.click(await screen.findByRole('button', { name: t.offer }))
    await user.type(screen.getByLabelText(t.label), 'Mon mot')
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(guestAbsentNote).toHaveBeenCalledWith(
        TOKEN,
        { household: 'AAAAAAAAAAAAAAAA' },
        { text: 'Mon mot', signature: 'Léa', website: '' },
      ),
    )
  })

  it('offers the household’s whole name as the signature of a reply named as the household', async () => {
    const user = userEvent.setup()
    forgetEditToken(TOKEN)
    storeHouseholdToken(TOKEN, 'AAAAAAAAAAAAAAAA')
    render({
      guestHousehold: vi.fn(async () => ({
        household: {
          name: 'Famille Martin',
          places: 4,
          moments: [],
          rsvp: { ...no, name: 'Famille Martin' },
        },
      })),
    })

    await user.click(await screen.findByRole('button', { name: t.offer }))

    expect(screen.getByLabelText(t.signatureLabel, { exact: false })).toHaveValue('Famille Martin')
  })

  describe('the signature, shown before sending', () => {
    const send = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText(t.label), 'Mon mot')
      await user.click(screen.getByRole('button', { name: t.send }))
    }

    it('starts as the first word of the reply’s name, and says what emptying it does', async () => {
      const user = userEvent.setup()
      render()
      await user.click(await screen.findByRole('button', { name: t.offer }))

      expect(screen.getByLabelText(t.signatureLabel, { exact: false })).toHaveValue('Léa')
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName === 'SMALL' && element.textContent === t.signatureHint,
        ),
      ).toBeInTheDocument()
    })

    it('is sent as the guest edited it', async () => {
      const user = userEvent.setup()
      const guestAbsentNote = vi.fn(async () => ({ absentNoteSent: true as const }))
      render({ guestAbsentNote })
      await user.click(await screen.findByRole('button', { name: t.offer }))
      await user.clear(screen.getByLabelText(t.signatureLabel, { exact: false }))
      await user.type(screen.getByLabelText(t.signatureLabel, { exact: false }), 'Léa et Hugo')

      await send(user)

      await waitFor(() =>
        expect(guestAbsentNote).toHaveBeenCalledWith(
          TOKEN,
          { editToken: 'tok' },
          { text: 'Mon mot', signature: 'Léa et Hugo', website: '' },
        ),
      )
    })

    it('is “Un invité absent”, in the guest’s language, when it is emptied', async () => {
      const user = userEvent.setup()
      const guestAbsentNote = vi.fn(async () => ({ absentNoteSent: true as const }))
      render({ guestAbsentNote })
      await user.click(await screen.findByRole('button', { name: t.offer }))
      await user.clear(screen.getByLabelText(t.signatureLabel, { exact: false }))
      expect(screen.getByPlaceholderText(t.anonymous)).toBeInTheDocument()

      await send(user)

      await waitFor(() =>
        expect(guestAbsentNote).toHaveBeenCalledWith(
          TOKEN,
          { editToken: 'tok' },
          { text: 'Mon mot', signature: t.anonymous, website: '' },
        ),
      )
    })

    it('is held to forty characters and the word to the guestbook’s, counted by code point like the server', async () => {
      const user = userEvent.setup()
      render()
      await user.click(await screen.findByRole('button', { name: t.offer }))

      const signature = screen.getByLabelText(t.signatureLabel, { exact: false })
      await user.clear(signature)
      fireEvent.change(signature, { target: { value: '😀'.repeat(55) } })
      const word = screen.getByLabelText(t.label)
      fireEvent.change(word, { target: { value: '😀'.repeat(520) } })

      expect([...(signature as HTMLInputElement).value]).toHaveLength(
        ABSENT_NOTE_SIGNATURE_MAX_CHARS,
      )
      expect([...(word as HTMLTextAreaElement).value]).toHaveLength(ABSENT_NOTE_MAX_CHARS)
    })
  })

  it('sends nothing for an empty word, and lets the guest go back', async () => {
    const user = userEvent.setup()
    const guestAbsentNote = vi.fn(async () => ({ absentNoteSent: true as const }))
    render({ guestAbsentNote })

    await user.click(await screen.findByRole('button', { name: t.offer }))
    expect(screen.getByRole('button', { name: t.send })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: fr.rsvp.guest.cancel }))

    expect(guestAbsentNote).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: t.offer })).toBeInTheDocument()
  })

  it.each([
    ['guestbook.tooLong', fr.guestbook.tooLong(500)],
    ['guestbook.empty', fr.guestbook.errors['guestbook.empty']],
    ['rsvp.absentNoteUnavailable', t.unavailable],
    ['rsvp.absentNoteSent', t.already],
  ])(
    "says the refusal %s in the guest's language and keeps the word typed",
    async (code, sentence) => {
      const user = userEvent.setup()
      render({ guestAbsentNote: vi.fn().mockRejectedValue(new ApiError(409, code)) })

      await user.click(await screen.findByRole('button', { name: t.offer }))
      await user.type(screen.getByLabelText(t.label), 'Mon mot')
      await user.click(screen.getByRole('button', { name: t.send }))

      expect(await screen.findByRole('alert')).toHaveTextContent(sentence.slice(0, 12))
      expect(screen.getByLabelText(t.label)).toHaveValue('Mon mot')
    },
  )

  it('says when the network failed, and when the page is asked too often', async () => {
    const user = userEvent.setup()
    const guestAbsentNote = vi
      .fn()
      .mockRejectedValueOnce(ApiError.network())
      .mockRejectedValueOnce(new ApiError(429, 'rate.limited'))
    render({ guestAbsentNote })
    await user.click(await screen.findByRole('button', { name: t.offer }))
    await user.type(screen.getByLabelText(t.label), 'Mon mot')

    await user.click(screen.getByRole('button', { name: t.send }))
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.rsvp.guest.failed)
    await user.click(screen.getByRole('button', { name: t.send }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(fr.rsvp.guest.busy.slice(0, 12)),
    )
  })

  it('sends what a script would put in the honeypot, which no person sees', async () => {
    const user = userEvent.setup()
    const guestAbsentNote = vi.fn(async () => ({ absentNoteSent: true as const }))
    render({ guestAbsentNote })
    await user.click(await screen.findByRole('button', { name: t.offer }))
    await user.type(screen.getByLabelText(t.label), 'Mon mot')

    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')
    expect(trap?.closest('label')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.change(trap as HTMLInputElement, { target: { value: 'http://spam.example' } })
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() =>
      expect(guestAbsentNote).toHaveBeenCalledWith(
        TOKEN,
        { editToken: 'tok' },
        { text: 'Mon mot', signature: 'Léa', website: 'http://spam.example' },
      ),
    )
  })

  it('is left out of the host’s preview, which never writes', async () => {
    renderWithProviders(
      <GuestRsvpBlock
        rsvp={aGuestRsvpPage({ absentNoteAvailable: true })}
        token={TOKEN}
        locale="fr"
        interactive={false}
      />,
      { api: fakeApi() },
    )

    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByRole('button', { name: t.offer })).toBeNull()
  })
})
