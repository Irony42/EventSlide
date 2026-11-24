import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { PushEnv } from '../../../lib/push/browserPush'
import { fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { BrowserNotifications } from './BrowserNotifications'

/**
 * The host's "Notification du navigateur" checkbox (spec 30, lot 4): absent while the box has no key,
 * the permission asked only on the click, a denial and an unsupported browser said, an iPhone sent to
 * the home screen, unticking tells the server.
 */

const t = fr.rsvp.push
/** The French has non-breaking spaces, which Testing Library's text matcher folds in the page and not in the expectation. */
const saying = (text: string) => (_content: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

const aSubscription = () => ({
  endpoint: ENDPOINT,
  toJSON: () => ({
    endpoint: ENDPOINT,
    keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) },
  }),
})

const anEnv = (overrides: Partial<PushEnv> = {}) => {
  let held: ReturnType<typeof aSubscription> | null = null
  const memory = new Set<string>()
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => held),
      subscribe: vi.fn(async () => (held = aSubscription())),
    },
  } as unknown as ServiceWorkerRegistration
  let permission: NotificationPermission = 'default'
  const env: PushEnv = {
    capable: true,
    apple: false,
    standalone: false,
    permission: () => permission,
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => (permission = 'granted')),
    worker: async () => registration,
    existingWorker: async () => registration,
    remembered: (slug) => memory.has(slug),
    remember: (slug, on) => void (on ? memory.add(slug) : memory.delete(slug)),
    ...overrides,
  }
  return env
}

const render = (env: PushEnv, withKey = true) => {
  const api = fakeApi({
    ...(withKey ? { pushKey: vi.fn(async () => ({ publicKey: 'BAAA' })) } : {}),
  })
  renderWithProviders(<BrowserNotifications slug="fete" env={env} />, { api })
  return api
}

describe('the notification checkbox', () => {
  it('is not offered while the box has no push key', async () => {
    const env = anEnv()
    const api = render(env, false)

    await waitFor(() => expect(api.pushKey).toHaveBeenCalled())

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(env.requestPermission).not.toHaveBeenCalled()
  })

  it('is offered off, and asks nothing before the click', async () => {
    const env = anEnv()
    render(env)

    const box = await screen.findByRole('checkbox', { name: t.label })

    expect(box).not.toBeChecked()
    expect(screen.getByText(saying(t.hint))).toBeInTheDocument()
    expect(env.requestPermission).not.toHaveBeenCalled()
  })

  it('asks the permission on the click, subscribes, and shows the box ticked', async () => {
    const user = userEvent.setup()
    const env = anEnv()
    const api = render(env)

    await user.click(await screen.findByRole('checkbox', { name: t.label }))

    await waitFor(() => expect(screen.getByRole('checkbox', { name: t.label })).toBeChecked())
    expect(env.requestPermission).toHaveBeenCalledTimes(1)
    expect(api.subscribePush).toHaveBeenCalledWith('fete', {
      endpoint: ENDPOINT,
      keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) },
    })
  })

  it('unsubscribes on untick', async () => {
    const user = userEvent.setup()
    const api = render(anEnv())
    await user.click(await screen.findByRole('checkbox', { name: t.label }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())

    await user.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
    expect(api.unsubscribePush).toHaveBeenCalledWith('fete', ENDPOINT)
  })

  it('says it when the host refuses, keeps the box off, and does not offer it again', async () => {
    const user = userEvent.setup()
    let permission: NotificationPermission = 'default'
    const env = anEnv({
      permission: () => permission,
      requestPermission: vi.fn(
        async (): Promise<NotificationPermission> => (permission = 'denied'),
      ),
    })
    const api = render(env)

    await user.click(await screen.findByRole('checkbox', { name: t.label }))

    await waitFor(() => expect(screen.getByText(saying(t.denied))).toBeInTheDocument())
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(api.subscribePush).not.toHaveBeenCalled()
  })

  it('shows a blocked site as blocked from the start', async () => {
    render(anEnv({ permission: () => 'denied' }))

    expect(await screen.findByText(saying(t.denied))).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it('says so on a browser that cannot show notifications', async () => {
    render(anEnv({ capable: false }))

    expect(await screen.findByText(saying(t.unsupported))).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it('sends an iPhone to the home screen first', async () => {
    render(anEnv({ apple: true, capable: false }))

    expect(await screen.findByText(saying(t.addToHomeScreen))).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it('says when it could not be turned on, and when it could not be turned off', async () => {
    const user = userEvent.setup()
    const env = anEnv({ worker: async () => null })
    render(env)

    await user.click(await screen.findByRole('checkbox', { name: t.label }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed)
  })

  it('stays ticked and says so when the server could not forget the browser', async () => {
    const user = userEvent.setup()
    const env = anEnv()
    const api = fakeApi({
      pushKey: vi.fn(async () => ({ publicKey: 'BAAA' })),
      unsubscribePush: vi.fn(async () => {
        throw new Error('network')
      }),
    })
    renderWithProviders(<BrowserNotifications slug="fete" env={env} />, { api })
    await user.click(await screen.findByRole('checkbox', { name: t.label }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())

    await user.click(screen.getByRole('checkbox'))

    expect(await screen.findByRole('alert')).toHaveTextContent(t.offFailed)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })
})
