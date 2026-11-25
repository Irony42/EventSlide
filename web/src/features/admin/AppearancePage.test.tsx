import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppearancePage } from './AppearancePage'
import { DEFAULT_EVENT_THEME } from '../../design-system/eventTheme'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { EventDto, EventThemeDto } from '../../lib/api/dto'

/**
 * « Apparence » (spec of 25/11, mock-up B1): the look of an event in one page, with its preview.
 *
 * The properties under test are the ones the page promises. A choice is saved as the host makes it
 * and drawn in the preview at once; leaving « Sur mesure » drops its object; the first swatch
 * paints the accent of the ambiance the event wears; nothing the page draws re-themes the console
 * around it; and a moderator or an archived event reads the page without being able to change it.
 */

const LOGO = `/api/events/camille-et-sacha/logo/${'ab'.repeat(32)}`
const VENUE = `/api/events/camille-et-sacha/venue-photo/${'cd'.repeat(32)}`

const eventWith = (theme: Partial<EventThemeDto> = {}, overrides: Partial<EventDto> = {}) =>
  anEventDto({
    settings: eventSettings({ theme: { ...DEFAULT_EVENT_THEME, ...theme } }),
    ...overrides,
  })

const renderPage = (api: Api) =>
  renderWithProviders(<AppearancePage />, {
    api,
    route: '/admin/events/camille-et-sacha/appearance',
    path: '/admin/events/:slug/appearance',
  })

const apiFor = (event: EventDto, overrides: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({ getEvent: vi.fn(async () => event), ...overrides })

/** A save that never answers: what the host chose stays pending, which is what the page shows first. */
const neverAnswers = (event: EventDto) =>
  apiFor(event, { updateSettings: vi.fn(() => new Promise<EventDto>(() => {})) })

const firstSave = async (api: Api) => {
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalled())
  return vi.mocked(api.updateSettings).mock.calls[0]?.[1]
}

const wallFrame = () => document.querySelector<HTMLElement>('[data-template-preview="wall"]')
const phoneFrame = () => document.querySelector<HTMLElement>('[data-template-preview="guest"]')
const swatch = (name: string) =>
  document.querySelector<HTMLElement>(`[data-template-preview="accent"][data-swatch="${name}"]`)
const radio = (name: string) => screen.getByRole('radio', { name })
const page = () => screen.findByRole('heading', { level: 1, name: fr.admin.appearance.title })

describe('AppearancePage', () => {
  it('says it is working while the event loads', () => {
    renderPage(fakeApi({ getEvent: vi.fn(() => new Promise<EventDto>(() => {})) }))

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.eventLoading)
  })

  it('names the failure and offers a retry', async () => {
    const getEvent = vi.fn(async () => eventWith())
    getEvent.mockRejectedValueOnce(ApiError.network())
    renderPage(fakeApi({ getEvent }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await page()).toBeVisible()
  })

  it('shows its groups in the order the host decides in: images, ambiance, colour, message, preview', async () => {
    renderPage(apiFor(eventWith()))
    await page()

    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(titles).toEqual([
      fr.admin.appearance.imagesTitle,
      fr.admin.appearance.ambianceTitle,
      fr.admin.appearance.colourTitle,
      fr.admin.appearance.messageTitle,
      fr.admin.appearance.previewTitle,
    ])
    expect(screen.getByText(fr.admin.appearance.lead)).toBeVisible()
    // The details are a closed `<details>`, whose summary says what they are set to.
    const details = screen.getByText(fr.admin.appearance.detailsTitle).closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(
      within(details as HTMLElement).getByText(/Coins arrondis, police de l’ambiance/),
    ).toBeTruthy()
  })

  it('offers the logo and the photograph of the venue side by side, with the logo hint naming every place', async () => {
    renderPage(apiFor(eventWith()))
    await page()

    expect(screen.getByTestId('logo-input')).toBeEnabled()
    expect(screen.getByTestId('venue-photo-input')).toBeEnabled()
    expect(screen.getByText(fr.admin.logoHint)).toBeVisible()
    for (const place of ['invités', 'écran de la salle', 'invitation', 'QR code imprimé']) {
      expect(fr.admin.logoHint).toContain(place)
    }
  })

  describe('the ambiance cards', () => {
    it('draw every ambiance with its name, its sentence and who it is for, in one radio group', async () => {
      renderPage(apiFor(eventWith({ ambiance: 'champs' })))
      await page()

      const group = within(screen.getByRole('group', { name: fr.admin.appearance.ambianceTitle }))
      expect(group.getAllByRole('radio')).toHaveLength(7)
      expect(radio(fr.admin.themeAmbianceNames.champs)).toBeChecked()
      expect(radio(fr.admin.themeAmbianceNames.champs)).toHaveAccessibleDescription(
        `${fr.admin.appearance.sentences.champs} ${fr.admin.appearance.audience(fr.admin.appearance.audiences.champs)}`,
      )
      expect(radio(fr.admin.themeAmbianceNames.noces)).not.toBeChecked()
    })

    it('draw each card through its own ambiance, never the console’s', async () => {
      renderPage(apiFor(eventWith({ ambiance: 'riviera' })))
      await page()

      const pictures = [...document.querySelectorAll('[data-template-preview="ambiance-card"]')]
      expect(pictures.map((picture) => picture.getAttribute('data-event-ambiance'))).toEqual([
        'eventslide',
        'guinguette',
        'riviera',
        'champs',
        'bivouac',
        'cabaret',
        'noces',
      ])
    })

    it('saves the ambiance a card is chosen for, and draws it in the preview before the answer', async () => {
      const api = neverAnswers(eventWith())
      renderPage(api)
      await page()

      await userEvent.click(radio(fr.admin.themeAmbianceNames.riviera))

      expect(wallFrame()).toHaveAttribute('data-event-ambiance', 'riviera')
      expect(phoneFrame()).toHaveAttribute('data-event-ambiance', 'riviera')
      expect(await firstSave(api)).toMatchObject({
        theme: { accentHue: 305, fonts: 'sans', frame: 'soft', ambiance: 'riviera' },
      })
    })

    it('chooses with the arrow keys, which move through the group and save', async () => {
      const api = neverAnswers(eventWith())
      renderPage(api)
      await page()

      radio(fr.admin.themeAmbianceNames.eventslide).focus()
      await userEvent.keyboard('{ArrowRight}')

      expect(radio(fr.admin.themeAmbianceNames.guinguette)).toBeChecked()
      expect(await firstSave(api)).toMatchObject({ theme: { ambiance: 'guinguette' } })
    })

    it('drops the host’s own object when another ambiance is chosen, as the server refuses both', async () => {
      const custom = { ground: 'dark' as const, groundHue: 40, faces: 'noces' as const }
      const api = neverAnswers(eventWith({ ambiance: 'custom', custom }))
      renderPage(api)
      await page()

      await userEvent.click(radio(fr.admin.themeAmbianceNames.guinguette))

      const sent = await firstSave(api)
      expect(sent?.theme).toMatchObject({ ambiance: 'guinguette' })
      expect(sent?.theme).not.toHaveProperty('custom')
    })

    it('leads « Sur mesure » to its own page and shows it chosen while it is the event’s', async () => {
      renderPage(apiFor(eventWith({ ambiance: 'eventslide' })))
      await page()

      const create = screen.getByRole('link', {
        name: new RegExp(fr.admin.themeAmbianceNames.custom),
      })
      expect(create).toHaveAttribute('href', '/admin/events/camille-et-sacha/settings/ambiance')
      expect(create).not.toHaveAttribute('aria-current')
      // It is a link and not an option of the group: choosing it needs the object its page makes.
      expect(screen.queryByRole('radio', { name: fr.admin.themeAmbianceNames.custom })).toBeNull()
    })

    it('says « Sur mesure » is the current one, and offers to edit it', async () => {
      const custom = { ground: 'light' as const, groundHue: 40, faces: 'noces' as const }
      renderPage(apiFor(eventWith({ ambiance: 'custom', custom })))
      await page()

      const edit = screen.getByRole('link', {
        name: new RegExp(fr.admin.themeAmbianceNames.custom),
      })
      expect(edit).toHaveAttribute('aria-current', 'true')
      expect(edit).toHaveTextContent(fr.admin.customAmbianceEdit)
      const cards = within(screen.getByRole('group', { name: fr.admin.appearance.ambianceTitle }))
      for (const card of cards.getAllByRole('radio')) expect(card).not.toBeChecked()
    })
  })

  describe('the colour', () => {
    it('is a row of four named swatches, the first being the ambiance’s own', async () => {
      renderPage(apiFor(eventWith()))
      await page()

      const group = within(screen.getByRole('group', { name: fr.admin.appearance.colourTitle }))
      expect(
        group.getAllByRole('radio').map((input) => input.closest('label')?.textContent),
      ).toEqual([
        fr.admin.appearance.colourFromAmbiance,
        fr.admin.themeAccentNames.rose,
        fr.admin.themeAccentNames.azure,
        fr.admin.themeAccentNames.teal,
      ])
      expect(radio(fr.admin.appearance.colourFromAmbiance)).toBeChecked()
    })

    it('paints the first swatch with the accent of the ambiance the event wears, and follows a change of ambiance', async () => {
      renderPage(apiFor(eventWith({ ambiance: 'champs' })))
      await page()

      // The dot wears the ambiance and carries no hue: `tokens.css` then gives it that ambiance’s own accent.
      expect(swatch('violet')).toHaveAttribute('data-event-ambiance', 'champs')
      expect(swatch('violet')).not.toHaveAttribute('data-event-accent')
      expect(swatch('rose')).toHaveAttribute('data-event-ambiance', 'champs')
      expect(swatch('rose')).toHaveAttribute('data-event-accent', '345')

      await userEvent.click(radio(fr.admin.themeAmbianceNames.noces))

      expect(swatch('violet')).toHaveAttribute('data-event-ambiance', 'noces')
      expect(swatch('azure')).toHaveAttribute('data-event-ambiance', 'noces')
    })

    it('saves the hue of the swatch chosen, the theme whole, and shows it in the preview', async () => {
      const api = neverAnswers(eventWith({ ambiance: 'champs' }))
      renderPage(api)
      await page()

      await userEvent.click(radio(fr.admin.themeAccentNames.rose))

      expect(wallFrame()).toHaveAttribute('data-event-accent', '345')
      expect(await firstSave(api)).toMatchObject({
        theme: { accentHue: 345, fonts: 'sans', frame: 'soft', ambiance: 'champs' },
      })
    })

    it('shows none chosen for a hue set outside the console, rather than claiming the nearest', async () => {
      renderPage(apiFor(eventWith({ accentHue: 200 })))
      await page()

      for (const input of within(
        screen.getByRole('group', { name: fr.admin.appearance.colourTitle }),
      ).getAllByRole('radio'))
        expect(input).not.toBeChecked()
    })

    it('draws a chosen swatch with a check as well as a ring, so colour is never the only signal', async () => {
      renderPage(apiFor(eventWith({ accentHue: 250 })))
      await page()

      expect(radio(fr.admin.themeAccentNames.azure)).toBeChecked()
      expect(swatch('azure')?.querySelector('svg')).not.toBeNull()
    })
  })

  describe('the details of the room’s screen', () => {
    it('keeps the stored values: a corner and a face, saved with the theme whole', async () => {
      const api = neverAnswers(eventWith())
      renderPage(api)
      await page()

      await userEvent.click(screen.getByText(fr.admin.appearance.detailsTitle))
      await userEvent.click(radio(fr.admin.themeFrameNames.square))
      await userEvent.click(radio(fr.admin.appearance.fontsClassic))

      expect(await firstSave(api)).toMatchObject({
        theme: { accentHue: 305, fonts: 'serif', frame: 'square', ambiance: 'eventslide' },
      })
      expect(wallFrame()).toHaveAttribute('data-event-frame', 'square')
      expect(wallFrame()).toHaveAttribute('data-event-fonts', 'serif')
    })

    it('shows the current values on the folded summary and the chosen tiles inside', async () => {
      renderPage(apiFor(eventWith({ frame: 'round', fonts: 'serif' })))
      await page()

      const details = screen.getByText(fr.admin.appearance.detailsTitle).closest('details')
      expect(details).toHaveTextContent(
        `${fr.admin.themeFrameNames.round}, ${fr.admin.appearance.fontsClassicSummary}`,
      )
      expect(radio(fr.admin.themeFrameNames.round)).toBeChecked()
      expect(radio(fr.admin.appearance.fontsClassic)).toBeChecked()
    })

    it('draws « Aa » in the face of the ambiance and in the serif one, on elements of their own', async () => {
      renderPage(apiFor(eventWith({ ambiance: 'cabaret' })))
      await page()

      const faces = [...document.querySelectorAll('[data-template-preview="fonts"]')]
      expect(faces.map((face) => face.getAttribute('data-event-ambiance'))).toEqual([
        'cabaret',
        'cabaret',
      ])
      expect(faces.map((face) => face.getAttribute('data-event-fonts'))).toEqual([null, 'serif'])
    })
  })

  describe('the welcome message', () => {
    it('is saved when the host leaves the field, and sent whole with the logo that is stored', async () => {
      const event = anEventDto({
        settings: eventSettings({ brand: { welcomeMessage: null, logoUrl: LOGO } }),
      })
      const api = neverAnswers(event)
      renderPage(api)
      await page()

      await userEvent.type(
        screen.getByRole('textbox', { name: new RegExp(fr.admin.welcomeMessage) }),
        'Bienvenue chez nous',
      )
      await userEvent.tab()

      expect(await firstSave(api)).toMatchObject({
        brand: { welcomeMessage: 'Bienvenue chez nous', logoUrl: LOGO },
      })
    })

    it('keeps a refused message in the field, for the host to fix', async () => {
      const api = apiFor(eventWith(), {
        updateSettings: vi.fn(() => Promise.reject(new ApiError(400, 'validation.failed'))),
      })
      renderPage(api)
      await page()
      const field = screen.getByRole('textbox', { name: new RegExp(fr.admin.welcomeMessage) })

      await userEvent.type(field, 'Bienvenue à toutes et à tous')
      await userEvent.tab()

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.admin.settingsPage.saveFailed)
      expect(field).toHaveValue('Bienvenue à toutes et à tous')
    })
  })

  describe('the stored images and the settings saved around them', () => {
    it('never sends the photograph’s URL with the theme, which the server would refuse', async () => {
      const api = neverAnswers(eventWith({ groundUrl: VENUE }))
      renderPage(api)
      await page()

      await userEvent.click(radio(fr.admin.themeAccentNames.rose))

      const sent = await firstSave(api)
      expect(sent?.theme).toEqual({
        accentHue: 345,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'eventslide',
      })
    })

    it('shows the photograph that is stored, and the new one as soon as the upload is answered, with no second read', async () => {
      const uploaded = eventWith({ groundUrl: VENUE })
      const getEvent = vi.fn(async () => eventWith())
      renderPage(fakeApi({ getEvent, putVenuePhoto: vi.fn(async () => uploaded) }))
      await page()
      const reads = getEvent.mock.calls.length
      expect(screen.queryByRole('img', { name: fr.admin.venuePhotoPreviewAlt })).toBeNull()

      await userEvent.upload(
        screen.getByTestId('venue-photo-input'),
        new File(['x'], 'lieu.jpg', { type: 'image/jpeg' }),
      )

      expect(
        await screen.findByRole('img', { name: fr.admin.venuePhotoPreviewAlt }),
      ).toHaveAttribute('src', VENUE)
      expect(wallFrame()).toHaveAttribute('data-venue-ground')
      expect(getEvent.mock.calls.length).toBe(reads)
    })

    it('does not throw away a choice still on its way when a photograph arrives', async () => {
      const api = apiFor(eventWith(), {
        updateSettings: vi.fn(() => new Promise<EventDto>(() => {})),
        putVenuePhoto: vi.fn(async () => eventWith({ groundUrl: VENUE })),
      })
      renderPage(api)
      await page()
      await userEvent.click(radio(fr.admin.themeAmbianceNames.bivouac))

      await userEvent.upload(
        screen.getByTestId('venue-photo-input'),
        new File(['x'], 'lieu.jpg', { type: 'image/jpeg' }),
      )
      await screen.findByRole('img', { name: fr.admin.venuePhotoPreviewAlt })

      expect(radio(fr.admin.themeAmbianceNames.bivouac)).toBeChecked()
    })

    it('replaces the draft when only the welcome message moved on the server (WEB-HOST-07)', async () => {
      // Another tab changed the message while this one was hidden: when it comes back into view
      // the page reads the event again, and the field must show what the server now holds.
      const withMessage = (welcomeMessage: string | null) =>
        anEventDto({ settings: eventSettings({ brand: { welcomeMessage, logoUrl: null } }) })
      const getEvent = vi.fn(async () => withMessage(null))
      renderPage(fakeApi({ getEvent }))
      await page()
      const field = () => screen.getByRole('textbox', { name: new RegExp(fr.admin.welcomeMessage) })
      expect(field()).toHaveValue('')
      getEvent.mockResolvedValueOnce(withMessage('Bienvenue chez nous'))

      fireEvent(window, new Event('focus'))

      await waitFor(() => expect(field()).toHaveValue('Bienvenue chez nous'))
    })
  })

  describe('the autosave line', () => {
    it('says it is saving, then that it is saved, in a live region', async () => {
      const api = apiFor(eventWith())
      renderPage(api)
      await page()
      const status = screen.getByText(fr.admin.settingsPage.autosave)
      expect(status).toHaveAttribute('aria-live', 'polite')

      await userEvent.click(radio(fr.admin.themeAmbianceNames.bivouac))

      expect(await screen.findByText(fr.admin.settingsPage.saved)).toHaveAttribute(
        'aria-live',
        'polite',
      )
    })

    it('puts a refused choice back and says why', async () => {
      const api = apiFor(eventWith(), {
        updateSettings: vi.fn(() =>
          Promise.reject(new ApiError(422, 'eventTheme.accentUnreadable')),
        ),
      })
      renderPage(api)
      await page()

      await userEvent.click(radio(fr.admin.themeAmbianceNames.bivouac))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['eventTheme.accentUnreadable'],
      )
      await waitFor(() => expect(radio(fr.admin.themeAmbianceNames.eventslide)).toBeChecked())
    })
  })

  describe('the preview', () => {
    it('is fed the event’s own theme: both frames wear it, the wall with its frame and face too', async () => {
      renderPage(
        apiFor(eventWith({ ambiance: 'cabaret', accentHue: 195, frame: 'round', fonts: 'serif' })),
      )
      await page()

      expect(phoneFrame()).toHaveAttribute('data-event-ambiance', 'cabaret')
      expect(phoneFrame()).toHaveAttribute('data-event-accent', '195')
      expect(wallFrame()).toHaveAttribute('data-event-frame', 'round')
      expect(wallFrame()).toHaveAttribute('data-event-fonts', 'serif')
      expect(screen.getByText(fr.admin.appearance.previewNote)).toBeVisible()
    })

    it('shows the logo and the welcome message where the guest’s page puts them', async () => {
      const event = anEventDto({
        settings: eventSettings({
          brand: { welcomeMessage: 'Bienvenue chez nous', logoUrl: LOGO },
        }),
      })
      renderPage(apiFor(event))
      await page()

      const phone = phoneFrame() as HTMLElement
      expect(within(phone).getByTestId('host-logo').querySelector('img')).toHaveAttribute(
        'src',
        LOGO,
      )
      expect(within(phone).getByTestId('host-greeting')).toHaveTextContent('Bienvenue chez nous')
    })

    it('shows them on the wall as it waits for its first photographs, and not over the photographs', async () => {
      const event = anEventDto({
        settings: eventSettings({
          brand: { welcomeMessage: 'Bienvenue chez nous', logoUrl: LOGO },
        }),
      })
      renderPage(apiFor(event))
      await page()
      const wall = wallFrame() as HTMLElement
      expect(within(wall).queryByTestId('wall-empty')).toBeNull()
      expect(within(wall).queryByTestId('host-logo')).toBeNull()

      await userEvent.click(
        screen.getByRole('button', { name: fr.admin.appearance.previewWallWaiting }),
      )

      expect(within(wall).getByTestId('wall-empty')).toBeVisible()
      expect(within(wall).getByTestId('host-logo').querySelector('img')).toHaveAttribute(
        'src',
        LOGO,
      )
      expect(within(wall).getByTestId('wall-welcome')).toHaveTextContent('Bienvenue chez nous')
    })

    it('shows a message as soon as it is saved, and a logo as soon as it is uploaded', async () => {
      const uploaded = anEventDto({
        settings: eventSettings({ brand: { welcomeMessage: null, logoUrl: LOGO } }),
      })
      const api = neverAnswers(eventWith())
      vi.mocked(api.putEventLogo).mockResolvedValue(uploaded)
      renderPage(api)
      await page()
      expect(within(phoneFrame() as HTMLElement).queryByTestId('host-logo')).toBeNull()

      await userEvent.upload(
        screen.getByTestId('logo-input'),
        new File(['x'], 'logo.png', { type: 'image/png' }),
      )
      expect(await within(phoneFrame() as HTMLElement).findByTestId('host-logo')).toBeVisible()

      await userEvent.type(
        screen.getByRole('textbox', { name: new RegExp(fr.admin.welcomeMessage) }),
        'Coucou',
      )
      await userEvent.tab()
      expect(
        await within(phoneFrame() as HTMLElement).findByTestId('host-greeting'),
      ).toHaveTextContent('Coucou')
    })

    it('draws the venue photograph on both frames when there is one', async () => {
      renderPage(apiFor(eventWith({ groundUrl: VENUE })))
      await page()

      for (const frame of [wallFrame(), phoneFrame()]) {
        expect(frame).toHaveAttribute('data-venue-ground')
        expect(frame?.style.getPropertyValue('--ambiance-ground')).toContain(VENUE)
      }
    })

    it('never dresses the console: whatever carries a theme is a frame, a card or a swatch marked as a preview', async () => {
      renderPage(
        apiFor(
          eventWith({
            ambiance: 'riviera',
            accentHue: 345,
            frame: 'round',
            fonts: 'serif',
            groundUrl: VENUE,
          }),
        ),
      )
      await page()

      const dressing = [
        ...document.querySelectorAll(
          '[data-event-ambiance], [data-event-accent], [data-event-fonts], [data-event-frame], [data-venue-ground], [data-ambiance-faces]',
        ),
      ].filter(
        (element) =>
          element.closest('[data-template-preview]') === null &&
          // The one dressing the console is meant to wear, put there by the event's layout.
          !element.hasAttribute('data-ambiance-marker'),
      )
      expect(dressing).toEqual([])
    })
  })

  describe('for someone who may not change anything', () => {
    // The preview is `inert`: nothing in it can be reached, so nothing in it is a control of the page.
    const everyControl = () =>
      [...document.querySelectorAll('input, select, textarea, button:not([aria-pressed])')].filter(
        (control) => control.closest('[inert]') === null,
      )

    it('says only the owner changes it, and disables every control, for a moderator', async () => {
      renderPage(apiFor(eventWith({}, { role: 'moderator' })))
      await page()

      expect(screen.getByText(fr.admin.settingsOwnerOnly)).toBeVisible()
      expect(screen.queryByText(fr.admin.settingsReadOnly)).toBeNull()
      expect(everyControl().length).toBeGreaterThan(10)
      for (const control of everyControl()) expect(control).toBeDisabled()
      // « Sur mesure » leads to a page of changes: withheld, not offered and then refused.
      expect(
        screen.queryByRole('link', { name: new RegExp(fr.admin.themeAmbianceNames.custom) }),
      ).toBeNull()
      // And nobody is told a save is coming.
      expect(screen.queryByText(fr.admin.settingsPage.autosave)).toBeNull()
    })

    it('gives the archived reason, not the role one, for an archived event', async () => {
      renderPage(apiFor(eventWith({}, { status: 'archived' })))
      await page()

      expect(screen.getByText(fr.admin.settingsReadOnly)).toBeVisible()
      expect(screen.queryByText(fr.admin.settingsOwnerOnly)).toBeNull()
      for (const control of everyControl()) expect(control).toBeDisabled()
    })

    it('still shows the preview, which is a reading and not a change', async () => {
      renderPage(apiFor(eventWith({ ambiance: 'noces' }, { role: 'moderator' })))
      await page()

      expect(wallFrame()).toHaveAttribute('data-event-ambiance', 'noces')
      expect(radio(fr.admin.themeAmbianceNames.noces)).toBeChecked()
    })
  })

  describe('on a phone', () => {
    const originalMatchMedia = window.matchMedia
    afterEach(() => {
      window.matchMedia = originalMatchMedia
    })
    const onAPhone = () => {
      window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia
    }

    it('keeps the wall’s frame alone in a small strip, with a button to see the whole preview', async () => {
      onAPhone()
      renderPage(apiFor(eventWith()))
      await page()

      expect(wallFrame()).not.toBeNull()
      expect(phoneFrame()).toBeNull()
      expect(screen.queryByText(fr.admin.appearance.previewNote)).toBeNull()
      expect(screen.getByRole('button', { name: fr.admin.appearance.previewBig })).toBeVisible()
    })

    it('opens the whole preview in a dialog that closes again, with both frames and the note', async () => {
      onAPhone()
      renderPage(apiFor(eventWith({ ambiance: 'bivouac' })))
      await page()

      await userEvent.click(screen.getByRole('button', { name: fr.admin.appearance.previewBig }))

      const dialog = await screen.findByRole('dialog', { name: fr.admin.appearance.previewTitle })
      expect(within(dialog).getByText(fr.admin.appearance.previewNote)).toBeVisible()
      expect(dialog.querySelector('[data-template-preview="guest"]')).toHaveAttribute(
        'data-event-ambiance',
        'bivouac',
      )

      await userEvent.click(
        within(dialog).getByRole('button', { name: fr.admin.appearance.previewClose }),
      )

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })
  })
})
