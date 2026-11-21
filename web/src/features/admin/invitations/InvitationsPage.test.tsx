import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { en } from '../../../lib/i18n/en'
import { fr } from '../../../lib/i18n/fr'
import {
  aGuestInviteHost,
  anEventDto,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { InvitationsPage } from './InvitationsPage'

const text = fr.guestInvite.host

/** The table writes French with no-break spaces, which Testing Library has already folded in the DOM. */
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

const render = (api: Api, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(<InvitationsPage />, {
    api,
    route: '/admin/events/camille-et-sacha/invitations',
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
      expect(within(form).getByText(/Heure de Paris/)).toBeVisible()
      expect(within(form).getByText(text.addressWarning)).toBeVisible()
    })

    it('keeps the link panel to one button, which waits for a saved date', async () => {
      render(answering(BLANK))

      const activate = await screen.findByRole('button', { name: text.activate })
      expect(activate).toBeDisabled()
      expect(screen.getByText(text.activateNeedsDate)).toBeVisible()
      expect(screen.getByText(text.pillOff)).toBeVisible()
    })

    it('greys the three formats out with one sentence', async () => {
      render(answering(BLANK))

      expect(await screen.findByText(text.locked)).toBeVisible()
      for (const name of [text.tabPrint, text.tabImage, text.tabEmail]) {
        expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-disabled', 'true')
      }
      expect(screen.queryByRole('tabpanel')).toBeNull()
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
      await userEvent.click(within(form).getByRole('button', { name: text.save }))

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
      expect(await screen.findByText(text.saved)).toBeVisible()
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
      expect(within(form).getByText(/Heure de New York/)).toBeVisible()
      await userEvent.click(within(form).getByRole('button', { name: text.save }))

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

      await userEvent.click(within(form).getByRole('button', { name: text.save }))

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
      await userEvent.click(within(form).getByRole('button', { name: text.save }))

      expect(await within(form).findByRole('alert')).toHaveTextContent(text.nonexistentHour)
      expect(save).not.toHaveBeenCalled()
    })

    it('says in words what the server refused, by its code', async () => {
      const save = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.endBeforeStart')
      })
      render(answering(aGuestInviteHost(), { saveGuestInvite: save }))
      const form = await screen.findByRole('form', { name: text.formTitle })

      await userEvent.click(within(form).getByRole('button', { name: text.save }))

      expect(await within(form).findByRole('alert')).toHaveTextContent(
        fr.errors['guestInvite.endBeforeStart'],
      )
      expect(screen.queryByText(text.saved)).toBeNull()
    })

    it('forgets the "saved" sentence as soon as the host types again', async () => {
      render(answering(aGuestInviteHost()))
      const form = await screen.findByRole('form', { name: text.formTitle })
      await userEvent.click(within(form).getByRole('button', { name: text.save }))
      expect(await screen.findByText(text.saved)).toBeVisible()

      await userEvent.type(within(form).getByLabelText(new RegExp(`^${text.titleLabel}`)), '!')

      expect(screen.queryByText(text.saved)).toBeNull()
    })

    it('counts the host’s word against the 500', async () => {
      render(answering(aGuestInviteHost({ message: 'Apéro' })))

      expect(await screen.findByText(text.messageCount(5, 500))).toBeVisible()
    })

    it('unlocks the activation once the first save has given the invitation a date', async () => {
      browserIn('Europe/Paris')
      const saved = aGuestInviteHost({ url: 'https://photos.example.test/i/AAAAAAAAAAAAAAAA' })
      render(answering(BLANK, { saveGuestInvite: vi.fn(async () => ({ guestInvite: saved })) }))
      const form = await screen.findByRole('form', { name: text.formTitle })
      expect(screen.getByRole('button', { name: text.activate })).toBeDisabled()

      fireEvent.change(within(form).getByLabelText(new RegExp(`^${text.startLabel}`)), {
        target: { value: '2027-12-11T19:00' },
      })
      await userEvent.click(within(form).getByRole('button', { name: text.save }))

      await waitFor(() => expect(screen.getByRole('button', { name: text.activate })).toBeEnabled())
    })
  })

  describe('the link', () => {
    it('switches the invitation on, and shows the link and the three formats', async () => {
      const enable = vi.fn(async () => ({ guestInvite: ON }))
      render(answering(aGuestInviteHost(), { enableGuestInvite: enable }))

      await userEvent.click(await screen.findByRole('button', { name: text.activate }))

      expect(enable).toHaveBeenCalledWith('camille-et-sacha')
      expect(await screen.findByLabelText(text.linkLabel)).toHaveValue(ON.url)
      expect(screen.getByText(text.pillOn)).toBeVisible()
      expect(screen.getByText(text.openNote)).toBeVisible()
      expect(screen.queryByText(text.locked)).toBeNull()
      expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    })

    it('says in words why a switch-on was refused', async () => {
      const enable = vi.fn(async () => {
        throw new ApiError(400, 'guestInvite.needsDate')
      })
      render(answering(aGuestInviteHost(), { enableGuestInvite: enable }))

      await userEvent.click(await screen.findByRole('button', { name: text.activate }))

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

    it('opens the page as a guest sees it in a tab of its own, with no opener and no referrer', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(answering(ON))

      await userEvent.click(await screen.findByRole('button', { name: text.viewAsGuest }))

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
      expect(await screen.findByText(text.pillOff)).toBeVisible()
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

  describe('the formats', () => {
    it('moves between the three tabs with the arrow keys, and lands on the one it names', async () => {
      render(answering(ON))
      const print = await screen.findByRole('tab', { name: text.tabPrint })
      expect(print).toHaveAttribute('aria-selected', 'true')

      print.focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(screen.getByRole('tab', { name: text.tabImage })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: text.tabImage })).toHaveFocus()

      await userEvent.keyboard('{ArrowRight}{ArrowRight}')
      expect(screen.getByRole('tab', { name: text.tabPrint })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.getByRole('tab', { name: text.tabEmail })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('names its panel after the tab that is open', async () => {
      render(answering(ON))

      await userEvent.click(await screen.findByRole('tab', { name: text.tabEmail }))

      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(text.tabEmail)
    })

    it('does nothing for a click or an arrow while locked', async () => {
      render(answering(aGuestInviteHost()))
      const print = await screen.findByRole('tab', { name: text.tabPrint })

      await userEvent.click(screen.getByRole('tab', { name: text.tabEmail }))
      print.focus()
      await userEvent.keyboard('{ArrowRight}')

      expect(print).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: text.tabImage })).toHaveAttribute(
        'aria-selected',
        'false',
      )
    })

    it('keeps the formats locked for an invitation that is on but has lost its date', async () => {
      render(answering(aGuestInviteHost({ enabled: true, startsAt: null, endsAt: null })))

      expect(await screen.findByText(text.locked)).toBeVisible()
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
      expect(within(form).getByRole('button', { name: text.save })).toBeDisabled()
      expect(screen.getByRole('button', { name: text.rotate })).toBeDisabled()
      expect(screen.getByRole('button', { name: text.disable })).toBeDisabled()
    })
  })

  it('reads in the host’s own language', async () => {
    render(answering(BLANK), 'en')

    // The button comes with the invitation, a moment after the heading: wait for the later one.
    expect(await screen.findByRole('button', { name: en.guestInvite.host.activate })).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: en.guestInvite.host.title })).toBeVisible()
  })

  it('offers a retry when the invitation itself could not be read', async () => {
    const read = vi
      .fn<Api['guestInvite']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue({ guestInvite: BLANK })
    render(fakeApi({ guestInvite: read }))

    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('button', { name: text.activate })).toBeVisible()
  })
})
