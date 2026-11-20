import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelsPanel } from './ChannelsPanel'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { ChannelsResponse } from '../../lib/api/dto'

const GROUP = {
  id: 'binding-1',
  channel: 'telegram',
  title: 'Mariage Léa & Tom',
  boundAt: '2026-06-20T18:00:00.000Z',
  photoCount: 12,
}

const view = (overrides: Partial<ChannelsResponse> = {}): ChannelsResponse => ({
  available: true,
  botUsername: 'EventSlideBot',
  allowed: true,
  bindings: [GROUP],
  ...overrides,
})

const renderPanel = (api: Api, canUnlink = true, canBind = true) =>
  renderWithProviders(
    <ChannelsPanel
      slug="camille-et-sacha"
      joinCode="H7K2QM"
      canUnlink={canUnlink}
      canBind={canBind}
    />,
    {
      api,
      route: '/admin/events/camille-et-sacha',
    },
  )

describe('ChannelsPanel', () => {
  it('tells the host to add the bot, and which command to send with the current join code', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }))

    expect(await screen.findByText(fr.channels.step1('EventSlideBot'))).toBeInTheDocument()
    expect(screen.getByText('/soiree H7K2QM')).toBeInTheDocument()
    expect(screen.getByText(fr.channels.visibility)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: fr.channels.copyCommand })).toBeInTheDocument()
  })

  it('lists the linked groups with their date and the photos received', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }))

    expect(await screen.findByText('Mariage Léa & Tom')).toBeInTheDocument()
    expect(screen.getByText(/12 photos reçues/u)).toBeInTheDocument()
  })

  it('says no group is linked yet', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view({ bindings: [] })) }))

    expect(await screen.findByText(fr.channels.none)).toBeInTheDocument()
  })

  it('says the box has no bot instead of instructions that cannot work', async () => {
    renderPanel(
      fakeApi({
        channels: vi.fn(async () => view({ available: false, botUsername: null, bindings: [] })),
      }),
    )

    expect(await screen.findByText(fr.channels.noBot)).toBeInTheDocument()
    expect(screen.queryByText(fr.channels.step1('EventSlideBot'))).toBeNull()
  })

  it('unlinks a group once the owner confirms, and reads the list again', async () => {
    const channels = vi
      .fn<Api['channels']>()
      .mockResolvedValueOnce(view())
      .mockResolvedValue(view({ bindings: [] }))
    const unlinkChannel = vi.fn(async () => undefined)
    renderPanel(fakeApi({ channels, unlinkChannel }))

    await userEvent.click(await screen.findByRole('button', { name: fr.channels.unlink }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(fr.channels.unlinkConfirmTitle)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.channels.unlink }))

    expect(unlinkChannel).toHaveBeenCalledWith('camille-et-sacha', 'binding-1')
    expect(await screen.findByText(fr.channels.none)).toBeInTheDocument()
  })

  it('does nothing when the owner cancels the confirmation', async () => {
    const unlinkChannel = vi.fn(async () => undefined)
    renderPanel(fakeApi({ channels: vi.fn(async () => view()), unlinkChannel }))

    await userEvent.click(await screen.findByRole('button', { name: fr.channels.unlink }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /annuler/iu }))

    expect(unlinkChannel).not.toHaveBeenCalled()
  })

  it('offers no unlink to a moderator, whose request would be refused', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }), false)

    expect(await screen.findByText('Mariage Léa & Tom')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: fr.channels.unlink })).toBeNull()
  })

  it('numbers the steps as an ordered list, so a screen reader hears them as one', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }))

    const first = await screen.findByText(fr.channels.step1('EventSlideBot'))

    expect(first.closest('ol')).not.toBeNull()
    expect(fr.channels.step1('EventSlideBot')).not.toMatch(/^d/u)
  })

  it('says the plan no longer includes it, hides the steps and keeps the list to dissociate from', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view({ allowed: false })) }))

    expect(await screen.findByText(fr.channels.notAllowed)).toBeInTheDocument()
    expect(screen.queryByText(fr.channels.step1('EventSlideBot'))).toBeNull()
    expect(screen.getByText('Mariage Léa & Tom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: fr.channels.unlink })).toBeInTheDocument()
  })

  it('hides the steps while the event is not live, saying why, and keeps the list', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }), true, false)

    expect(await screen.findByText(fr.channels.notLive)).toBeInTheDocument()
    expect(screen.queryByText(fr.channels.step1('EventSlideBot'))).toBeNull()
    expect(screen.getByText('Mariage Léa & Tom')).toBeInTheDocument()
  })

  it('tells a moderator that only the owner can dissociate a group', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }), false)

    expect(await screen.findByText(fr.channels.ownerOnlyUnlink)).toBeInTheDocument()
  })

  it('says when the command could not be copied', async () => {
    renderPanel(fakeApi({ channels: vi.fn(async () => view()) }))

    await userEvent.click(await screen.findByRole('button', { name: fr.channels.copyCommand }))

    expect(await screen.findByText(fr.channels.copyFailed)).toBeInTheDocument()
  })
})
