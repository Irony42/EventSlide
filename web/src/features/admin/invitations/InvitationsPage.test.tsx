import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { en } from '../../../lib/i18n/en'
import { fr } from '../../../lib/i18n/fr'
import {
  aGuestInviteHost,
  aRsvpSettings,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { zoneName } from '../../../lib/invite/timeZones'
import { InvitationsPage } from './InvitationsPage'

const text = fr.guestInvite.host

/** The table writes French with no-break spaces, which Testing Library has already folded in the DOM. */
/** A text matcher for an element whose own text starts with the sentence (the zone line ends in a button). */
const startingWith =
  (sentence: string) =>
  (content: string): boolean =>
    plain(content).startsWith(plain(sentence))

const NBSP = String.fromCodePoint(0x00a0)
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

const BLANK: GuestInviteDto = aGuestInviteHost({
  configured: false,
  url: null,
  title: null,
  startsAt: null,
  endsAt: null,
  timeZone: null,
  venueName: null,
  address: null,
  message: null,
  language: 'fr',
  defaultStartsAt: null,
})
const ON = aGuestInviteHost({ enabled: true })

const render = (api: Api, locale: 'fr' | 'en' = 'fr', search = '') =>
  renderWithProviders(<InvitationsPage />, {
    api,
    route: `/admin/events/camille-et-sacha/invitations${search}`,
    path: '/admin/events/:slug/invitations',
    locale,
  })

/** The browser is in Paris, so a typed time is Paris time unless the host says otherwise. */
const browserIn = (timeZone: string) =>
  vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions)

const answering = (invite: GuestInviteDto, extra: Partial<Api> = {}): Api =>
  fakeApi({ guestInvite: vi.fn(async () => ({ guestInvite: invite })), ...extra })

/** A change in the form: the text is saved as it is typed, there is no button to press. */
const touch = (form: HTMLElement) =>
  userEvent.type(within(form).getByLabelText(new RegExp(`^${text.titleLabel}`)), '!')

/** Opens the folded group of the address, the word and the language. */
const openMore = () => userEvent.click(screen.getByText(text.moreTitle))

const statusBar = () => screen.getByRole('region', { name: text.statusBarLabel })
const activateNow = () => within(statusBar()).getByRole('button', { name: text.activate })
const activateButton = async () => {
  await screen.findByRole('region', { name: text.statusBarLabel })
  return activateNow()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InvitationsPage', () => {
  it('says the invitations are on their way while the answers are', () => {
    render(fakeApi({ getEvent: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.eventLoading)
  })

  it('offers the way out, and a retry, when the event could not be read', async () => {
    render(
      fakeApi({
        getEvent: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )

    expect(await screen.findByRole('button', { name: fr.app.retry })).toBeVisible()
  })

  it('tells a moderator that only the owner writes the invitation, and asks the server nothing', async () => {
    const api = fakeApi({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })
    render(api)

    expect(await screen.findByText(text.ownerOnly)).toBeVisible()
    expect(api.guestInvite).not.toHaveBeenCalled()
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('names the event in the trail and the page in its heading', async () => {
    render(answering(BLANK))

    expect(await screen.findByRole('heading', { level: 1, name: text.title })).toBeVisible()
    expect(screen.getByRole('navigation', { name: fr.admin.breadcrumbLabel })).toHaveTextContent(
      'Camille & Sacha',
    )
  })

  describe('the invitation not yet written', () => {
    it('starts from the event’s own name as a hint and the event’s date in the invitation’s zone', async () => {
      browserIn('Europe/Paris')
      render(answering({ ...BLANK, defaultStartsAt: '2027-12-11T18:00:00.000Z' }))

      const form = await screen.findByRole('form', { name: text.formTitle })
      expect(within(form).getByLabelText(new RegExp(`^${text.titleLabel}`))).toHaveValue('')
      expect(within(form).getByText(plain(text.titleHint('Camille & Sacha')))).toBeVisible()
      expect(within(form).getByLabelText(new RegExp(`^${text.startLabel}`))).toHaveValue(
        '2027-12-11T19:00',
      )
      expect(
        within(form).getByText(startingWith(text.zoneLine(zoneName('Europe/Paris', 'fr')))),
      ).toBeVisible()
      await openMore()
      expect(within(form).getByText(text.addressWarning)).toBeVisible()
    })

    it('keeps the link panel to one button, which waits for a saved date', async () => {
      render(answering(BLANK))

      const activate = await activateButton()
      expect(activate).toBeDisabled()
      expect(screen.getByText(text.activateNeedsDate)).toBeVisible()
      expect(screen.getByText(text.statusOff)).toBeVisible()
    })

    it('locks the panel with the two steps and the action of the first, and leaves the four tabs to look at', async () => {
      render(answering(BLANK), 'fr', '?panel=partage')

      expect(await screen.findByText(text.locked)).toBeVisible()
      expect(screen.getByRole('tabpanel')).toHaveTextContent(text.shareLocked)
      const panel = screen.getByText(text.locked).closest('[role="status"]') as HTMLElement
      expect(within(panel).getByText(text.lockedStepDate)).toBeVisible()
      expect(within(panel).getByText(text.lockedStepActivate)).toBeVisible()
      expect(within(panel).getByRole('button', { name: text.lockedDateFocus })).toBeVisible()
      for (const name of [text.tabPrint, text.tabImage, text.tabEmail, text.tabGuest]) {
        expect(screen.getByRole('tab', { name })).not.toHaveAttribute('aria-disabled')
      }
    })
  })

  describe('saving', () => {
    it('sends the typed times read in the zone of the party, with that zone and the language', async () => {
      browserIn('Europe/Paris')
      const save = vi.fn(async () => ({ guestInvite: aGuestInviteHost() }))
      render(answering(BLANK, { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await userEvent.type(
        within(form).getByLabelText(new RegExp(`^${text.titleLabel}`)),
        'Léa fête',
      )
      fireEvent.change(within(form).getByLabelText(new RegExp(`^${text.startLabel}`)), {
        target: { value: '2027-12-11T19:00' },
      })
      await userEvent.type(
        within(form).getByLabelText(new RegExp(`^${text.venueLabel}`)),
        'La Guinguette',
      )
      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(save).toHaveBeenCalledWith('camille-et-sacha', {
        title: 'Léa fête',
        startsAt: '2027-12-11T18:00:00.000Z',
        endsAt: null,
        timeZone: 'Europe/Paris',
        venueName: 'La Guinguette',
        address: null,
        message: null,
        language: 'fr',
      })
      expect(await screen.findByText(text.savedAuto)).toBeVisible()
    })

    it('lets the host change the zone, and reads the same typed time in it', async () => {
      browserIn('Europe/Paris')
      const save = vi.fn(async () => ({ guestInvite: aGuestInviteHost() }))
      render(
        answering(
          { ...BLANK, defaultStartsAt: '2027-12-11T18:00:00.000Z' },
          { saveGuestInvite: save },
        ),
      )
      const form = await screen.findByRole('form', { name: text.formTitle })

      await userEvent.click(within(form).getByRole('button', { name: text.zoneChange }))
      await userEvent.selectOptions(within(form).getByLabelText(text.zoneLabel), 'America/New_York')
      expect(
        within(form).getByText(startingWith(text.zoneLine(zoneName('America/New_York', 'fr')))),
      ).toBeVisible()
      await touch(form)

      await waitFor(() => expect(save).toHaveBeenCalled())
      // 19:00 typed, in New York: five hours later than in Paris.
      expect(save).toHaveBeenCalledWith(
        'camille-et-sacha',
        expect.objectContaining({
          startsAt: '2027-12-12T00:00:00.000Z',
          timeZone: 'America/New_York',
        }),
      )
    })

    it('keeps the saved zone for a host who is somewhere else: nothing moves the hour', async () => {
      browserIn('Asia/Tokyo')
      const save = vi.fn(async () => ({ guestInvite: aGuestInviteHost() }))
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await touch(form)

      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(save).toHaveBeenCalledWith(
        'camille-et-sacha',
        expect.objectContaining({ startsAt: '2027-12-11T18:00:00.000Z', timeZone: 'Europe/Paris' }),
      )
    })

    it('says the hour does not exist, and sends nothing, when the clocks skip it', async () => {
      browserIn('Europe/Paris')
      const save = vi.fn()
      render(answering(BLANK, { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      fireEvent.change(within(form).getByLabelText(new RegExp(`^${text.startLabel}`)), {
        target: { value: '2027-03-28T02:30' },
      })
      await touch(form)

      const start = within(form).getByLabelText(new RegExp(`^${text.startLabel}`))
      await waitFor(() => expect(start).toHaveAttribute('aria-invalid', 'true'))
      expect(start).toHaveAccessibleDescription(text.nonexistentHour)
      expect(save).not.toHaveBeenCalled()
    })

    it('says in words what the server refused, by its code', async () => {
      const save = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.endBeforeStart')
      })
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await touch(form)

      const end = within(form).getByLabelText(new RegExp(`^${text.endLabel}`))
      await waitFor(() => expect(end).toHaveAttribute('aria-invalid', 'true'))
      expect(end).toHaveAccessibleDescription(fr.errors['guestInvite.endBeforeStart'])
      expect(screen.queryByText(text.savedAuto)).toBeNull()
    })

    it('says it is saving while the host types, then that it is saved, and the form never has a Save button', async () => {
      render(answering(aGuestInviteHost()))
      const form = await screen.findByRole('form', { name: text.formTitle })
      expect(within(form).queryByRole('button', { name: /^Enregistrer$/ })).toBeNull()

      await touch(form)
      expect(screen.getByText(text.saving)).toBeVisible()
      expect(await screen.findByText(text.savedAuto)).toBeVisible()

      await touch(form)
      expect(screen.queryByText(text.savedAuto)).toBeNull()
    })

    it('puts what is typed on the preview at once, before anything is saved', async () => {
      render(answering(ON, { saveGuestInvite: vi.fn(() => new Promise<never>(() => undefined)) }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await userEvent.type(within(form).getByLabelText(new RegExp(`^${text.titleLabel}`)), ' Bis')

      expect(document.querySelector('[data-format]')).toHaveTextContent('Léa fête ses 40 ans Bis')
    })

    it('shows the guest page from what is typed, in a frame the keyboard and the pointer cannot press', async () => {
      render(answering(ON, { saveGuestInvite: vi.fn(() => new Promise<never>(() => undefined)) }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await userEvent.type(within(form).getByLabelText(new RegExp(`^${text.titleLabel}`)), ' Bis')
      await userEvent.click(screen.getByRole('button', { name: new RegExp(fr.rsvp.host.title) }))

      const frame = screen.getByRole('group', { name: text.guestPreviewLabel })
      expect(frame).toHaveTextContent('Léa fête ses 40 ans Bis')
      expect(frame.querySelector('[inert]')).not.toBeNull()
    })

    it('sends what is still waiting when the page is left before the pause is over', async () => {
      const save = vi.fn(async () => ({ guestInvite: aGuestInviteHost() }))
      const view = render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await touch(form)
      expect(save).not.toHaveBeenCalled()

      view.unmount()

      expect(save).toHaveBeenCalledWith(
        'camille-et-sacha',
        expect.objectContaining({ title: 'Léa fête ses 40 ans!' }),
      )
    })

    it('does not say "saved" while a key typed during a request is still waiting', async () => {
      let finish: () => void = () => undefined
      const save = vi.fn(
        () =>
          new Promise<{ guestInvite: GuestInviteDto }>((resolve) => {
            finish = () => resolve({ guestInvite: aGuestInviteHost() })
          }),
      )
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await touch(form)
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))

      await touch(form)
      finish()

      await waitFor(() => expect(screen.getByText(text.saving)).toBeVisible())
      expect(screen.queryByText(text.savedAuto)).toBeNull()
    })

    it('says the last change was not saved, and tries again on request', async () => {
      const save = vi
        .fn<Api['saveGuestInvite']>()
        .mockRejectedValueOnce(ApiError.network())
        .mockResolvedValue({ guestInvite: aGuestInviteHost() })
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await touch(form)

      await userEvent.click(await screen.findByRole('button', { name: text.saveRetry }))

      expect(await screen.findByText(text.savedAuto)).toBeVisible()
      expect(save).toHaveBeenCalledTimes(2)
    })

    it('counts the host’s word against the 500', async () => {
      render(answering(aGuestInviteHost({ message: 'Apéro' })))
      await screen.findByRole('form', { name: text.formTitle })
      await openMore()

      expect(
        await screen.findByText(plain(`${text.messageCount(5, 500)} · ${text.lineCount(1, 8)}`)),
      ).toBeVisible()
    })

    it('unlocks the activation once the first save has given the invitation a date', async () => {
      browserIn('Europe/Paris')
      const saved = aGuestInviteHost({ url: 'https://photos.example.test/i/AAAAAAAAAAAAAAAA' })
      render(answering(BLANK, { saveGuestInvite: vi.fn(async () => ({ guestInvite: saved })) }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      expect(activateNow()).toBeDisabled()

      fireEvent.change(within(form).getByLabelText(new RegExp(`^${text.startLabel}`)), {
        target: { value: '2027-12-11T19:00' },
      })
      await touch(form)

      await waitFor(() => expect(activateNow()).toBeEnabled())
    })
  })

  describe('mistakes', () => {
    it.each([
      ['title', 'guestInvite.titleTooLong', /^Titre/],
      ['venue', 'guestInvite.venueTooLong', /^Lieu/],
      ['address', 'guestInvite.addressTooLong', /^Adresse/],
      ['message', 'guestInvite.messageTooLong', /^Votre mot/],
      ['start', 'guestInvite.startsAtInvalid', /^Début/],
    ] as const)(
      'ties the server’s refusal of the %s to that field, which says it is invalid and takes the focus',
      async (_name, code, label) => {
        const save = vi.fn(async () => {
          throw new ApiError(400, code)
        })
        render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
        const form = await screen.findByRole('form', { name: text.formTitle })

        await touch(form)

        const field = within(form).getByLabelText(label)
        await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
        expect(field).toHaveAccessibleDescription(new RegExp(plain(fr.errors[code]).slice(0, 12)))
      },
    )

    it('says in the box above the button what is about no field: a language, a refusal of the whole', async () => {
      const save = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.badTimeZone')
      })
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await touch(form)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['guestInvite.badTimeZone'],
      )
      expect(form.querySelector('[aria-invalid="true"]')).toBeNull()
    })

    it('clears the error as soon as the host types again', async () => {
      render(
        answering(aGuestInviteHost(), {
          saveGuestInvite: vi.fn(async () => {
            throw new ApiError(400, 'guestInvite.titleTooLong')
          }),
        }),
      )
      const form = await screen.findByRole('form', { name: text.formTitle })
      await touch(form)
      const title = within(form).getByLabelText(/^Titre/)
      await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'))

      await userEvent.type(title, 'x')

      expect(title).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('refuses a third line of address and a ninth of word without asking the server', async () => {
      const save = vi.fn()
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      fireEvent.change(within(form).getByLabelText(/^Adresse/), { target: { value: 'a\nb\nc' } })

      await touch(form)

      const address = within(form).getByLabelText(/^Adresse/)
      await waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      expect(address).toHaveAccessibleDescription(
        new RegExp(fr.errors['guestInvite.addressTooManyLines']),
      )
      expect(save).not.toHaveBeenCalled()
    })

    it('sends one request at a time: a change made while one is on its way goes after it', async () => {
      let finish: () => void = () => undefined
      const save = vi.fn(
        () =>
          new Promise<{ guestInvite: GuestInviteDto }>((resolve) => {
            finish = () => resolve({ guestInvite: aGuestInviteHost() })
          }),
      )
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await touch(form)
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))

      await touch(form)
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(save).toHaveBeenCalledTimes(1)
      finish()

      await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
      expect(save).toHaveBeenLastCalledWith(
        'camille-et-sacha',
        expect.objectContaining({ title: 'Léa fête ses 40 ans!!' }),
      )
    })

    it('has an address of two rows and a word of eight, and counts the lines', async () => {
      render(answering(aGuestInviteHost({ address: 'a\nb', message: 'x\ny\nz' })))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await openMore()

      expect(within(form).getByLabelText(/^Adresse/)).toHaveAttribute('rows', '2')
      expect(within(form).getByLabelText(/^Votre mot/)).toHaveAttribute('rows', '8')
      expect(within(form).getByText(new RegExp(plain(text.lineCount(3, 8))))).toBeVisible()
    })

    it('shows the zone as its name, and the hint says the typed times are kept', async () => {
      render(answering(BLANK))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await userEvent.click(within(form).getByRole('button', { name: text.zoneChange }))

      expect(within(form).queryByText(/ Paris/)).toBeNull()
      expect(within(form).getByText(plain(text.zoneHint))).toBeVisible()
    })

    it('shows a saved zone this browser does not know by its identifier, and reads the times in its own', async () => {
      browserIn('Europe/Paris')
      render(
        answering(
          aGuestInviteHost({
            timeZone: 'Mars/Olympus',
            startsAt: '2027-12-11T18:00:00.000Z',
            endsAt: null,
          }),
        ),
      )
      const form = await screen.findByRole('form', { name: text.formTitle })

      expect(within(form).getByLabelText(new RegExp(`^${text.startLabel}`))).toHaveValue(
        '2027-12-11T19:00',
      )
    })
  })

  describe('the link', () => {
    it('switches the invitation on, and shows the link and the formats', async () => {
      const enable = vi.fn(async () => ({ guestInvite: ON }))
      render(answering(aGuestInviteHost(), { enableGuestInvite: enable }))

      await userEvent.click(await activateButton())

      expect(enable).toHaveBeenCalledWith('camille-et-sacha')
      expect(await screen.findByLabelText(text.linkLabel)).toHaveValue(ON.url)
      expect(screen.getByText(text.statusOn)).toBeVisible()
      expect(screen.queryByText(text.locked)).toBeNull()
      expect(screen.getByRole('button', { name: new RegExp(text.sharePanelTitle) })).toBeVisible()
    })

    it('tells, on the guest page format, that opening the evening opens the way to the wall', async () => {
      render(answering(ON), 'fr', '?panel=partage')

      await userEvent.click(await screen.findByRole('tab', { name: text.tabGuest }))

      expect(screen.getByText(text.openNote)).toBeVisible()
    })

    it('says in words why a switch-on was refused', async () => {
      const enable = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.needsDate')
      })
      render(answering(aGuestInviteHost(), { enableGuestInvite: enable }))

      await userEvent.click(await activateButton())

      expect(await screen.findByText(fr.errors['guestInvite.needsDate'])).toBeVisible()
    })

    it('copies the link, and says so, or says the browser refused', async () => {
      render(answering(ON))
      const writeText = vi.fn(async () => undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      await userEvent.click(await screen.findByRole('button', { name: text.copy }))
      expect(writeText).toHaveBeenCalledWith(ON.url)
      expect(await screen.findByText(text.copied)).toBeVisible()

      writeText.mockRejectedValueOnce(new Error('denied'))
      await userEvent.click(screen.getByRole('button', { name: text.copy }))
      expect(await screen.findByText(text.copyFailed)).toBeVisible()
    })

    it('puts the focus on the link once it is switched on, and on the button once it is switched off', async () => {
      render(
        answering(aGuestInviteHost(), {
          enableGuestInvite: vi.fn(async () => ({ guestInvite: ON })),
          disableGuestInvite: vi.fn(async () => ({ guestInvite: aGuestInviteHost() })),
        }),
      )

      await userEvent.click(await activateButton())
      await waitFor(() => expect(screen.getByLabelText(text.linkLabel)).toHaveFocus())

      await userEvent.click(screen.getByRole('button', { name: text.disable }))
      await waitFor(() => expect(activateNow()).toHaveFocus())
    })

    it('opens the page as a guest sees it in a tab of its own, with no opener and no referrer', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(answering(ON), 'fr', '?panel=partage')

      await userEvent.click(await screen.findByRole('tab', { name: text.tabGuest }))
      await userEvent.click(screen.getByRole('button', { name: text.guestOpen }))

      expect(open).toHaveBeenCalledWith(ON.url, '_blank', 'noopener,noreferrer')
    })

    it('asks before changing the link, and says what it costs', async () => {
      const rotate = vi.fn(async () => ({
        guestInvite: aGuestInviteHost({
          enabled: true,
          url: 'https://photos.example.test/i/NEWNEWNEWNEWNEWN',
        }),
      }))
      render(answering(ON, { rotateGuestInviteToken: rotate }))

      await userEvent.click(await screen.findByRole('button', { name: text.rotate }))
      const dialog = await screen.findByRole('dialog', { name: text.rotateTitle })
      expect(within(dialog).getByText(text.rotateBody)).toBeVisible()
      expect(rotate).not.toHaveBeenCalled()

      await userEvent.click(within(dialog).getByRole('button', { name: text.rotateConfirm }))

      expect(rotate).toHaveBeenCalledWith('camille-et-sacha')
      expect(await screen.findByLabelText(text.linkLabel)).toHaveValue(
        'https://photos.example.test/i/NEWNEWNEWNEWNEWN',
      )
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('changes nothing when the host backs out of the dialog', async () => {
      const rotate = vi.fn()
      render(answering(ON, { rotateGuestInviteToken: rotate }))

      await userEvent.click(await screen.findByRole('button', { name: text.rotate }))
      const dialog = await screen.findByRole('dialog', { name: text.rotateTitle })
      await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

      expect(rotate).not.toHaveBeenCalled()
      expect(screen.getByLabelText(text.linkLabel)).toHaveValue(ON.url)
    })

    it('switches off with no question, keeps the text, and locks the formats again', async () => {
      const disable = vi.fn(async () => ({ guestInvite: aGuestInviteHost() }))
      render(answering(ON, { disableGuestInvite: disable }))

      await userEvent.click(await screen.findByRole('button', { name: text.disable }))

      expect(disable).toHaveBeenCalledWith('camille-et-sacha')
      expect(await screen.findByText(text.statusOff)).toBeVisible()
      expect(screen.getByText(text.locked)).toBeVisible()
      expect(screen.getByRole('textbox', { name: new RegExp(`^${text.titleLabel}`) })).toHaveValue(
        'Léa fête ses 40 ans',
      )
    })

    it('says in words why a change was refused, and leaves the link as it was', async () => {
      const rotate = vi.fn(async () => {
        throw new ApiError(409, 'guestInvite.eventArchived')
      })
      render(answering(ON, { rotateGuestInviteToken: rotate }))
      await userEvent.click(await screen.findByRole('button', { name: text.rotate }))
      const dialog = await screen.findByRole('dialog', { name: text.rotateTitle })

      await userEvent.click(within(dialog).getByRole('button', { name: text.rotateConfirm }))

      expect(await screen.findByText(plain(fr.errors['guestInvite.eventArchived']))).toBeVisible()
      expect(screen.getByLabelText(text.linkLabel)).toHaveValue(ON.url)
    })
  })

  describe('the card first: two doors, two panels', () => {
    const asked = fr.rsvp.host
    const door = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) })

    it('shows the card’s column with the text, the look and two doors that say what they hold', async () => {
      render(answering(ON, { rsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings() })) }))

      expect(await screen.findByRole('form', { name: text.formTitle })).toBeVisible()
      expect(screen.getByRole('heading', { level: 2, name: text.lookTitle })).toBeVisible()
      expect(await door(asked.title)).toHaveAccessibleDescription('')
      expect(screen.getByRole('button', { name: new RegExp(asked.title) })).toHaveTextContent(
        asked.stateOff,
      )
      expect(
        screen.getByRole('button', { name: new RegExp(text.sharePanelTitle) }),
      ).toHaveTextContent(text.entryShareSummary)
      // The card is on the preview, and no panel is in the page.
      expect(document.querySelector('[data-format]')).not.toBeNull()
      expect(screen.queryByRole('button', { name: fr.app.close })).toBeNull()
    })

    it('says in the replies’ door when they close and how many options are on', async () => {
      render(
        answering(ON, {
          rsvpForm: vi.fn(async () => ({
            rsvpForm: aRsvpSettings({ enabled: true, state: 'open', deadline: '2027-12-06' }),
          })),
        }),
      )

      const entry = await door(asked.title)
      await waitFor(() => expect(entry).toHaveTextContent('6'))
      expect(entry).toHaveTextContent(/options/)
    })

    it('opens a panel in place of the column, then Fermer brings the column back with the focus on its door', async () => {
      render(answering(ON))
      await userEvent.click(await door(fr.guestInvite.host.sharePanelTitle))

      expect(
        await screen.findByRole('heading', { level: 2, name: text.sharePanelTitle }),
      ).toBeVisible()
      expect(screen.queryByRole('form', { name: text.formTitle })).toBeNull()
      expect(screen.getByRole('tab', { name: text.tabPrint })).toHaveAttribute(
        'aria-selected',
        'true',
      )

      await userEvent.click(screen.getByRole('button', { name: fr.app.close }))

      expect(await screen.findByRole('form', { name: text.formTitle })).toBeVisible()
      expect(screen.getByRole('button', { name: new RegExp(text.sharePanelTitle) })).toHaveFocus()
    })

    it('closes the panel with Escape, and gives the focus back to its door', async () => {
      render(answering(ON), 'fr', '?panel=reponses')
      await screen.findByRole('heading', { level: 2, name: asked.title })

      await userEvent.keyboard('{Escape}')

      expect(await screen.findByRole('form', { name: text.formTitle })).toBeVisible()
      expect(screen.getByRole('button', { name: new RegExp(asked.title) })).toHaveFocus()
    })

    it('puts the focus on the panel’s title when the host opens it', async () => {
      render(answering(ON))
      await userEvent.click(await door(asked.title))

      expect(await screen.findByRole('heading', { level: 2, name: asked.title })).toHaveFocus()
    })

    it('makes the preview follow the panel: the card, the guest’s page for the replies, the chosen format for sharing', async () => {
      render(answering(ON))
      await screen.findByRole('form', { name: text.formTitle })
      expect(document.querySelector('[data-format]')).not.toBeNull()
      expect(screen.queryByRole('group', { name: text.guestPreviewLabel })).toBeNull()

      await userEvent.click(await door(asked.title))
      expect(await screen.findByRole('group', { name: text.guestPreviewLabel })).toBeVisible()
      expect(document.querySelector('[data-format]')).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: fr.app.close }))
      await userEvent.click(await door(text.sharePanelTitle))
      await userEvent.click(await screen.findByRole('tab', { name: text.tabGuest }))
      expect(await screen.findByRole('group', { name: text.guestPreviewLabel })).toBeVisible()
    })

    it('reads the panel and the format from the address, so a reload or Back returns to the same screen', async () => {
      render(answering(ON), 'fr', '?panel=partage&format=email')

      expect(await screen.findByRole('tab', { name: text.tabEmail })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.queryByRole('form', { name: text.formTitle })).toBeNull()
    })

    it('ignores a panel or a format the page does not know', async () => {
      render(answering(ON), 'fr', '?panel=autre&format=autre')

      expect(await screen.findByRole('form', { name: text.formTitle })).toBeVisible()
    })

    it('says what the folded group of the address, the word and the language holds', async () => {
      render(answering(aGuestInviteHost({ address: 'a\nb', message: 'Apéro' })))

      const summary = (await screen.findByText(text.moreTitle)).closest('summary') as HTMLElement
      expect(summary).toHaveTextContent(`${text.moreAddress}, ${text.moreMessage}, Français`)
    })

    it('opens the folded group of the text when the server refuses something inside it', async () => {
      const save = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.addressTooLong')
      })
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await touch(form)

      const details = (await screen.findByText(text.moreTitle)).closest('details') as HTMLElement
      await waitFor(() => expect(details).toHaveAttribute('open'))
    })

    it('keeps a folded group open when the host comes back from a panel', async () => {
      render(answering(ON))
      await userEvent.click(await screen.findByText(text.moreTitle))
      await userEvent.click(await door(asked.title))
      await userEvent.click(await screen.findByRole('button', { name: fr.app.close }))

      const details = (await screen.findByText(text.moreTitle)).closest('details') as HTMLElement
      expect(details).toHaveAttribute('open')
    })
  })

  describe('the card first: what the review asked for', () => {
    const asked = fr.rsvp.host
    const door = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) })
    const withReplies = (form = {}) =>
      answering(ON, {
        rsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings(form) })),
      })

    it('shows one large card on the card’s screen, and the sheet of four only while sharing', async () => {
      render(withReplies())

      await screen.findByRole('form', { name: text.formTitle })
      const card = document.querySelector('[data-format][data-single]')
      expect(card).not.toBeNull()
      expect(within(card as HTMLElement).getAllByRole('img', { name: /QR/ })).toHaveLength(1)

      await userEvent.click(await door(text.sharePanelTitle))
      await screen.findByRole('tab', { name: text.tabPrint })
      expect(document.querySelector('[data-format][data-single]')).toBeNull()
      expect(
        within(document.querySelector('[data-format]') as HTMLElement).getAllByRole('img', {
          name: /QR/,
        }),
      ).toHaveLength(4)
    })

    it('does not make the doors disclosures: they navigate', async () => {
      render(withReplies())

      const entry = await door(asked.title)

      expect(entry).not.toHaveAttribute('aria-expanded')
      expect(entry).not.toHaveAttribute('aria-controls')
    })

    it('puts no-break spaces around the dot of the replies’ door', async () => {
      render(withReplies({ enabled: true, state: 'open', deadline: '2027-12-06' }))

      const entry = await door(asked.title)

      await waitFor(() => expect(entry.textContent).toContain(`${NBSP}·${NBSP}`))
    })

    it('says in the replies’ door that the settings could not be read, not nothing', async () => {
      render(
        answering(ON, {
          rsvpForm: vi.fn(async () => {
            throw ApiError.network()
          }),
        }),
      )

      const entry = await door(asked.title)
      await waitFor(() => expect(entry).toHaveTextContent(text.repliesUnavailable))
    })

    it('shows the invitation’s save status, with the field named, in the replies’ panel and in the share panel', async () => {
      const save = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.addressTooLong')
      })
      render(
        answering(ON, {
          saveGuestInvite: save,
          rsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings() })),
        }),
      )
      const form = await screen.findByRole('form', { name: text.formTitle })
      await touch(form)
      await waitFor(() => expect(save).toHaveBeenCalled())

      await userEvent.click(await door(asked.title))
      const named = await screen.findByRole('alert')
      expect(named).toHaveTextContent(text.addressLabel)
      expect(named).toHaveTextContent(plain(fr.errors['guestInvite.addressTooLong']).slice(0, 12))
      expect(screen.getByRole('button', { name: text.saveRetry })).toBeVisible()

      await userEvent.click(screen.getByRole('button', { name: fr.app.close }))
      await userEvent.click(await door(text.sharePanelTitle))
      expect(await screen.findByRole('alert')).toHaveTextContent(text.addressLabel)
    })

    it('keeps a question being written when the panel is closed and opened again', async () => {
      render(withReplies())
      await userEvent.click(await door(asked.title))
      await userEvent.click(await screen.findByText(asked.questionsTitle))
      await userEvent.click(screen.getByRole('button', { name: asked.questionAdd }))
      await userEvent.type(screen.getByLabelText(asked.questionLabelLabel), 'Un chant ?')

      await userEvent.click(screen.getByRole('button', { name: fr.app.close }))
      await userEvent.click(await door(asked.title))

      expect(await screen.findByLabelText(asked.questionLabelLabel)).toHaveValue('Un chant ?')
    })

    it('gives the focus to the title once: a redraw of the panel does not take it again', async () => {
      render(withReplies())
      await userEvent.click(await door(text.sharePanelTitle))
      const title = await screen.findByRole('heading', { level: 2, name: text.sharePanelTitle })
      expect(title).toHaveFocus()

      await userEvent.click(screen.getByRole('tab', { name: text.tabImage }))

      expect(screen.getByRole('tab', { name: text.tabImage })).toHaveFocus()
      expect(
        screen.getByRole('heading', { level: 2, name: text.sharePanelTitle }),
      ).not.toHaveFocus()
    })

    it('gives the workspace the rest of the window from where its head ends', async () => {
      render(withReplies())

      const head = (await screen.findByRole('heading', { level: 1, name: text.title }))
        .parentElement as HTMLElement
      expect(head.parentElement?.style.getPropertyValue('--invite-top')).toBe('0px')
    })
  })

  describe('the formats', () => {
    it('moves between the four tabs with the arrow keys, and lands on the one it names', async () => {
      render(answering(ON), 'fr', '?panel=partage')
      const print = await screen.findByRole('tab', { name: text.tabPrint })
      expect(print).toHaveAttribute('aria-selected', 'true')

      print.focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(screen.getByRole('tab', { name: text.tabImage })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: text.tabImage })).toHaveFocus()

      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
      expect(screen.getByRole('tab', { name: text.tabPrint })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.getByRole('tab', { name: text.tabGuest })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('names its panel after the tab that is open', async () => {
      render(answering(ON), 'fr', '?panel=partage')

      await userEvent.click(await screen.findByRole('tab', { name: text.tabEmail }))

      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(text.tabEmail)
    })

    it('lets a host look at each tab while locked, and the panel says why it is empty on each', async () => {
      render(answering(aGuestInviteHost()), 'fr', '?panel=partage')
      await screen.findByRole('tab', { name: text.tabPrint })

      await userEvent.click(screen.getByRole('tab', { name: text.tabEmail }))

      expect(screen.getByRole('tab', { name: text.tabEmail })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tabpanel')).toHaveTextContent(text.shareLocked)
    })

    it('goes to the first and the last tab with Home and End', async () => {
      render(answering(ON), 'fr', '?panel=partage')
      const print = await screen.findByRole('tab', { name: text.tabPrint })
      print.focus()

      await userEvent.keyboard('{End}')
      expect(screen.getByRole('tab', { name: text.tabGuest })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: text.tabGuest })).toHaveFocus()
      await userEvent.keyboard('{Home}')
      expect(screen.getByRole('tab', { name: text.tabPrint })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('says a tab controls a panel only for the tab whose panel is in the page', async () => {
      render(answering(ON), 'fr', '?panel=partage')
      await screen.findByRole('tabpanel')

      const controlling = screen
        .getAllByRole('tab')
        .filter((tab) => tab.hasAttribute('aria-controls'))
      expect(controlling).toHaveLength(1)
      expect(controlling[0]).toHaveAttribute('aria-selected', 'true')
      expect(document.getElementById(controlling[0]?.getAttribute('aria-controls') ?? '#')).toBe(
        screen.getByRole('tabpanel'),
      )
    })

    it('keeps the formats locked for an invitation that is on but has lost its date', async () => {
      render(answering(aGuestInviteHost({ enabled: true, startsAt: null, endsAt: null })))

      expect(await screen.findByText(text.locked)).toBeVisible()
    })
  })

  describe('the guests’ replies (spec 30)', () => {
    const asked = fr.rsvp.host
    const guest = fr.rsvp.guest

    it('shows the panel under the look, and no answering block in the preview while replies are not asked', async () => {
      render(answering(ON), 'fr', '?panel=reponses')

      expect(await screen.findByRole('heading', { name: new RegExp(asked.title) })).toBeVisible()

      expect(screen.getByRole('group', { name: text.guestPreviewLabel })).not.toHaveTextContent(
        guest.title,
      )
    })

    it('puts the answering block in the preview, open on a "yes", as the host switches replies on and chooses what to ask', async () => {
      const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings({ enabled: true }) }))
      render(answering(ON, { saveRsvpForm }), 'fr', '?panel=reponses')
      const frame = await screen.findByRole('group', { name: text.guestPreviewLabel })

      await userEvent.click(await screen.findByRole('checkbox', { name: asked.askLabel }))

      expect(within(frame).getByRole('heading', { name: guest.title })).toBeVisible()
      expect(within(frame).getByLabelText(new RegExp(guest.nameLabel))).toHaveValue(
        asked.previewName,
      )
      expect(within(frame).getByRole('button', { name: guest.maybe })).toBeVisible()

      await userEvent.click(screen.getByRole('checkbox', { name: /Peut-être/ }))

      expect(within(frame).queryByRole('button', { name: guest.maybe })).not.toBeInTheDocument()
      expect(frame.querySelector('[inert]')).not.toBeNull()
    })

    it('says the invitation comes first while it has no date or no text of its own', async () => {
      render(
        answering(BLANK, {
          rsvpForm: vi.fn(async () => ({
            rsvpForm: aRsvpSettings({ invited: false, state: null, closesAt: null }),
          })),
        }),
        'fr',
        '?panel=reponses',
      )

      expect(
        await screen.findByText(asked.needsInvite.replaceAll(String.fromCharCode(160), ' ')),
      ).toBeVisible()
    })

    it('reads the settings again once the invitation is saved', async () => {
      const rsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
      const save = vi.fn(async () => ({ guestInvite: aGuestInviteHost() }))
      render(answering(BLANK, { rsvpForm, saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await touch(form)

      await waitFor(() => expect(rsvpForm.mock.calls.length).toBeGreaterThanOrEqual(2))
    })

    it('reads the settings again when the party moves, as the day they close on moves with it', async () => {
      const rsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
      const moved = aGuestInviteHost({ enabled: true, startsAt: '2027-08-01T18:00:00.000Z' })
      const guestInvite = vi
        .fn()
        .mockResolvedValueOnce({ guestInvite: ON })
        .mockResolvedValue({ guestInvite: moved })
      const save = vi.fn(async () => ({ guestInvite: moved }))
      render(fakeApi({ guestInvite, rsvpForm, saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await touch(form)

      await waitFor(() => expect(rsvpForm.mock.calls.length).toBeGreaterThanOrEqual(2))
    })
  })

  describe('an archived event', () => {
    it('is a record: the form and the buttons are read-only', async () => {
      render(
        answering(ON, {
          getEvent: vi.fn(async () => anEventDto({ status: 'archived' })),
        }),
      )

      const form = await screen.findByRole('form', { name: text.formTitle })
      expect(within(form).getByLabelText(new RegExp(`^${text.titleLabel}`))).toBeDisabled()
      expect(screen.getByRole('button', { name: text.rotate })).toBeDisabled()
      expect(screen.getByRole('button', { name: text.disable })).toBeDisabled()
    })
  })

  it('reads in the host’s own language', async () => {
    render(answering(BLANK), 'en')

    // The button comes with the invitation, a moment after the heading: wait for the later one.
    const bar = await screen.findByRole('region', { name: en.guestInvite.host.statusBarLabel })
    expect(
      await within(bar).findByRole('button', { name: en.guestInvite.host.activate }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: en.guestInvite.host.title })).toBeVisible()
  })

  it('offers a retry when the invitation itself could not be read', async () => {
    const read = vi
      .fn<Api['guestInvite']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue({ guestInvite: BLANK })
    render(fakeApi({ guestInvite: read }))

    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await activateButton()).toBeVisible()
  })
})
