import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aWallItem,
  aWallResponse,
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { SAVE_DEBOUNCE_MS } from './panel/usePanelSettings'
import { PANEL_IDLE_MS } from './panel/WallSettingsPanel'
import { WallPage } from './WallPage'

/**
 * The owner's controls on the projected wall (spec 13).
 *
 * The rule under test is that the panel is a convenience for the person who holds the owner's
 * session and does not exist for anyone else: not hidden, absent. The server is the barrier
 * (`PATCH /settings` is owner-only and CSRF-protected, tested in the route tests).
 */

const ROUTE = '/e/camille-et-sacha/display'
const PATH = '/e/:slug/display'

const wall = () => aWallResponse({ items: [aWallItem()] })

const asOwner = () => anEventDto({ role: 'owner' })

const unauthenticated = () => {
  throw new ApiError(401, 'auth.required')
}

const renderWall = (overrides: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi({ wall: vi.fn(async () => wall()), ...overrides })
  renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
  return api
}

const barButton = (name: string) => screen.findByRole('button', { name })

const panelLabel = fr.wall.panel.panelLabel

afterEach(() => {
  vi.useRealTimers()
})

describe('the settings panel is absent without the owner session', () => {
  it('has no controls, no panel and an inert R key for an anonymous browser', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => unauthenticated()) })
    await screen.findByTestId('wall-slide')
    await waitFor(() => expect(api.getEvent).toHaveBeenCalled())

    await userEvent.keyboard('r')

    expect(screen.queryByRole('group', { name: fr.wall.panel.barLabel })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: fr.wall.panel.open })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: panelLabel })).not.toBeInTheDocument()
  })

  it('has none for a moderator, who cannot write the settings', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })
    await screen.findByTestId('wall-slide')
    await waitFor(() => expect(api.getEvent).toHaveBeenCalled())

    await userEvent.keyboard('r')

    expect(screen.queryByRole('button', { name: fr.wall.panel.open })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: panelLabel })).not.toBeInTheDocument()
  })

  it('offers the way to sign in in the help, and no button anywhere', async () => {
    renderWall({ getEvent: vi.fn(async () => unauthenticated()) })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('?')

    expect(await screen.findByRole('link', { name: fr.wall.panel.signInToSet })).toBeVisible()
    expect(screen.getByRole('dialog')).not.toHaveTextContent(fr.wall.panel.openHint)
  })

  it('asks who is there once, and only after the wall has something to show', async () => {
    const api = renderWall()
    await screen.findByTestId('wall-slide')

    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(1))
  })
})

describe('the owner bar and panel', () => {
  it('opens from the bar, in its own chunk, and says which group is which', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })

    await userEvent.click(await barButton(fr.wall.panel.open))

    expect(await screen.findByRole('dialog', { name: panelLabel })).toBeVisible()
    expect(screen.getByText(fr.wall.panel.forAll)).toBeVisible()
    expect(screen.getByText(fr.wall.panel.thisScreen)).toBeVisible()
  })

  it('opens with R', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await barButton(fr.wall.panel.open)

    await userEvent.keyboard('r')

    expect(await screen.findByRole('dialog', { name: panelLabel })).toBeVisible()
  })

  it('lists R in the shortcuts help for the owner', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await barButton(fr.wall.panel.open)

    await userEvent.keyboard('?')

    expect(await screen.findByRole('dialog', { name: fr.wall.shortcuts })).toHaveTextContent(
      fr.wall.panel.openHint,
    )
  })

  it('closes on Escape without hiding the QR card, and gives the focus back to the button', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    const opener = await barButton(fr.wall.panel.open)
    await userEvent.keyboard('r')
    await screen.findByRole('dialog', { name: panelLabel })

    await userEvent.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: panelLabel })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('H7K2QM')).toBeVisible()
    expect(opener).toHaveFocus()
  })

  it('closes on Escape from the wall too, when no control has focus, and still keeps the QR', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await barButton(fr.wall.panel.open)
    await userEvent.keyboard('r')
    await screen.findByRole('dialog', { name: panelLabel })
    act(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })

    await userEvent.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: panelLabel })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('H7K2QM')).toBeVisible()
  })

  it('closes by itself after a minute with nobody touching it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANEL_IDLE_MS - 1_000)
    })
    expect(screen.getByRole('dialog', { name: panelLabel })).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(screen.queryByRole('dialog', { name: panelLabel })).not.toBeInTheDocument()
  })

  it('pauses and resumes this screen from the bar', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })

    await userEvent.click(await barButton(fr.wall.panel.pause))
    expect(screen.getByText(fr.wall.paused)).toBeVisible()

    await userEvent.click(await barButton(fr.wall.panel.resume))
    expect(screen.queryByText(fr.wall.paused)).not.toBeInTheDocument()
  })
})

describe('what the panel writes', () => {
  const open = async () => {
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })
  }

  it('sends only the field that changed, once, after the debounce, and says it is saved', async () => {
    const updated = anEventDto({ settings: eventSettings({ wallLanguage: 'de' }) })
    const api = renderWall({
      getEvent: vi.fn(async () => asOwner()),
      updateSettings: vi.fn(async () => updated),
    })
    await open()

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallLanguage), 'en')
    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallLanguage), 'de')

    expect(screen.getByLabelText(fr.admin.wallLanguage)).toHaveValue('de')
    expect(api.updateSettings).not.toHaveBeenCalled()
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1), {
      timeout: SAVE_DEBOUNCE_MS * 4,
    })
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', { wallLanguage: 'de' })
    expect(await screen.findByText(fr.wall.panel.saved)).toBeVisible()
  })

  it('goes back to the saved value and says why when the server refuses', async () => {
    const api = renderWall({
      getEvent: vi.fn(async () => asOwner()),
      updateSettings: vi.fn(async () => {
        throw new ApiError(500, 'unknown')
      }),
    })
    await open()

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallLanguage), 'it')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.wall.panel.saveFailed)
    expect(api.updateSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(fr.admin.wallLanguage)).toHaveValue('fr')
  })

  it('tells an expired session apart, with the way back in', async () => {
    renderWall({
      getEvent: vi.fn(async () => asOwner()),
      updateSettings: vi.fn(async () => unauthenticated()),
    })
    await open()

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallLanguage), 'it')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.wall.panel.sessionExpired)
    expect(screen.getByRole('link', { name: fr.wall.panel.signIn })).toBeVisible()
  })

  it('writes the guestbook switch alone', async () => {
    const api = renderWall({
      getEvent: vi.fn(async () =>
        anEventDto({ settings: eventSettings({ allowGuestbook: true }) }),
      ),
    })
    await open()

    await userEvent.click(screen.getByLabelText(fr.admin.guestbookOnWall))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', { guestbookOnWall: false })
  })

  it('writes the ambiance with the other theme choices, and links to the custom one', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.themeAmbiance), 'guinguette')

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(api.updateSettings).mock.calls[0]?.[1]
    expect(sent?.theme?.ambiance).toBe('guinguette')
    expect(sent).not.toHaveProperty('wallLanguage')
    expect(screen.getByRole('link', { name: fr.admin.customAmbianceCreate })).toBeVisible()
  })

  it('never offers moderation, retention or guest rights', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    for (const label of [
      fr.admin.moderationMode,
      fr.admin.retention,
      fr.admin.allowCaptions,
      fr.admin.allowReactions,
      fr.admin.allowClips,
      fr.admin.maxPhotosPerGuest,
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
  })
})

describe('layout and rhythm (spec 13, PR 3)', () => {
  const open = async () => {
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })
  }
  const layoutOf = () =>
    document.querySelector('[data-wall-layout]')?.getAttribute('data-wall-layout')

  it('shows the layout the host chose for the event, and lets this screen own key beat it', async () => {
    renderWall({
      wall: vi.fn(async () =>
        aWallResponse({ items: [aWallItem()], layout: 'polaroid', layoutChosen: true }),
      ),
      getEvent: vi.fn(async () => asOwner()),
    })
    await barButton(fr.wall.panel.open)
    expect(layoutOf()).toBe('polaroid')

    await userEvent.keyboard('l')
    expect(layoutOf()).toBe('filmstrip')
    await open()
    expect(screen.getByRole('status')).toHaveTextContent('Pellicule')

    await userEvent.click(screen.getByRole('button', { name: fr.wall.panel.backToEvent }))
    expect(layoutOf()).toBe('polaroid')
    expect(
      screen.queryByRole('button', { name: fr.wall.panel.backToEvent }),
    ).not.toBeInTheDocument()
  })

  it('sends one request holding both keys the host changed, and nothing else of the wall group', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallDisplay.layout), 'mosaic')
    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallDisplay.interval), '12000')

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      wall: { layout: 'mosaic', slideIntervalMs: 12_000 },
    })
  })

  it('sends only the rhythm when only the rhythm changed', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.wallDisplay.interval), '4000')

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      wall: { slideIntervalMs: 4_000 },
    })
  })
})

describe('fresh photos first and tilt (spec 13, PR 4)', () => {
  it('writes each switch alone, from the panel', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })

    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.tilt))
    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.freshLane))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      wall: { tilt: false, freshLane: false },
    })
  })

  it('lays the prints flat on the wall when the event turned the tilt off', async () => {
    renderWall({
      wall: vi.fn(async () =>
        aWallResponse({
          items: [aWallItem(), aWallItem({ id: 'photo-2' })],
          layout: 'polaroid',
          layoutChosen: true,
          tilt: false,
        }),
      ),
    })

    const prints = await screen.findAllByTestId('wall-slide')
    for (const print of prints) {
      expect(print.style.getPropertyValue('--wall-tilt')).toBe('0deg')
    }
  })
})

describe('the send time under a photo (spec 13, PR 5)', () => {
  it('prints it in the caption only when the event turned it on', async () => {
    const photo = aWallItem({ caption: 'Les mariés', createdAt: new Date().toISOString() })
    const { unmount } = renderWithProviders(<WallPage />, {
      api: fakeApi({
        wall: vi.fn(async () => aWallResponse({ items: [photo], showTime: true })),
      }),
      route: ROUTE,
      path: PATH,
    })

    expect(await screen.findByText(/^\d{2}:\d{2}$/)).toBeVisible()
    unmount()

    renderWithProviders(<WallPage />, {
      api: fakeApi({
        wall: vi.fn(async () => aWallResponse({ items: [photo], showTime: false })),
      }),
      route: ROUTE,
      path: PATH,
    })
    await screen.findByText('Les mariés')
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).not.toBeInTheDocument()
  })

  it('writes the switch alone from the panel', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })

    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.showTime))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      wall: { showTime: true },
    })
  })
})

describe('the « À l’écran » section (spec 11)', () => {
  it('writes the counter and the new-photo switches, each off until the owner turns it on', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })

    expect(screen.getByLabelText(fr.admin.wallDisplay.souvenirCounter)).not.toBeChecked()
    expect(screen.getByLabelText(fr.admin.wallDisplay.newPhotoSignal)).not.toBeChecked()
    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.souvenirCounter))
    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.newPhotoSignal))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      wall: { souvenirCounter: true, newPhotoSignal: true },
    })
  })
})

describe('the QR code section (spec 14)', () => {
  const open = async () => {
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })
  }

  it('is the third section, named QR code', async () => {
    renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    const titles = Array.from(document.querySelectorAll('details > summary')).map(
      (summary) => summary.textContent,
    )
    expect(titles.indexOf(fr.wall.panel.sectionQr)).toBe(2)
  })

  it('writes the size from the slider and from a mark, each alone', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    fireEvent.change(screen.getByLabelText(new RegExp(fr.admin.wallDisplay.qrSize)), {
      target: { value: '1.25' },
    })
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenLastCalledWith('camille-et-sacha', {
      wall: { qrScale: 1.25 },
    })

    await userEvent.click(screen.getByRole('button', { name: fr.admin.wallDisplay.qrSizeLarge }))
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2))
    expect(api.updateSettings).toHaveBeenLastCalledWith('camille-et-sacha', {
      wall: { qrScale: 1.3 },
    })
  })

  it('writes the corner and the switch', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => asOwner()) })
    await open()

    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.qrCorners['top-start']))
    await userEvent.click(screen.getByLabelText(fr.admin.wallDisplay.qrVisible))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1))
    expect(api.updateSettings).toHaveBeenCalledWith('camille-et-sacha', {
      wall: { qrPlacement: 'top-start', qrVisible: false },
    })
  })
})

describe('the photo challenge, from the panel (spec 10, PR 5)', () => {
  const missions = [
    {
      id: 'm1',
      prompt: 'un selfie avec votre voisin',
      scope: 'guest' as const,
      achieved: false,
      publishedPhotos: 0,
      completedByGuests: 0,
    },
  ]

  const openPanel = async (overrides: Parameters<typeof fakeApi>[0] = {}) => {
    const api = renderWall({
      getEvent: vi.fn(async () => asOwner()),
      listMissions: vi.fn(async () => ({ items: missions })),
      ...overrides,
    })
    await userEvent.click(await barButton(fr.wall.panel.open))
    await screen.findByRole('dialog', { name: panelLabel })
    return api
  }

  it('has a section "Défi photo" that launches the chosen mission for two minutes', async () => {
    const startChallenge = vi.fn(async () => ({
      id: 'c1',
      missionId: 'm1',
      prompt: 'un selfie avec votre voisin',
      startedAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      state: 'running' as const,
    }))
    await openPanel({ startChallenge })

    expect(screen.getByText(fr.challenge.title, { selector: 'summary' })).toBeVisible()
    const launch = await screen.findByRole('button', { name: fr.challenge.launch })
    await waitFor(() => expect(launch).toBeEnabled())
    await userEvent.click(launch)

    expect(startChallenge).toHaveBeenCalledWith('camille-et-sacha', {
      missionId: 'm1',
      durationSeconds: 120,
    })
  })

  it('says the server refusal in the panel, which has no toaster', async () => {
    const startChallenge = vi.fn(async () => {
      throw new ApiError(409, 'challenge.alreadyRunning')
    })
    await openPanel({ startChallenge })

    await userEvent.click(await screen.findByRole('button', { name: fr.challenge.launch }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.errors['challenge.alreadyRunning'],
    )
  })

  it('does not exist for a moderator, who launches from the console', async () => {
    const api = renderWall({ getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) })
    await screen.findByTestId('wall-slide')
    await waitFor(() => expect(api.getEvent).toHaveBeenCalled())

    await userEvent.keyboard('r')

    expect(screen.queryByText(fr.challenge.launch)).not.toBeInTheDocument()
  })
})
