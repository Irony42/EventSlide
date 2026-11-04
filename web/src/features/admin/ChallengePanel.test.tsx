import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aMission, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { ChallengePanel } from './ChallengePanel'
import type { Api } from '../../lib/api/client'
import type { HostChallengeResponse } from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

const SELFIE = aMission({ id: 'm1', prompt: 'un selfie avec votre voisin' })
const DANCE = aMission({ id: 'm2', prompt: 'la première danse' })

const apiWith = (overrides: Partial<Api> = {}): Api =>
  fakeApi({
    listMissions: vi.fn(async () => ({ items: [SELFIE, DANCE] })),
    ...overrides,
  })

const render = (api: Api, live = true) =>
  renderWithProviders(<ChallengePanel slug={SLUG} live={live} />, { api })

/** A challenge that runs `leftMs` more on the server's clock, read from a server `offsetMs` behind. */
const running = (leftMs: number, offsetMs = 0): HostChallengeResponse => {
  const serverNowMs = Date.now() + offsetMs
  return {
    serverNowMs,
    recent: [],
    challenge: {
      id: 'c1',
      missionId: 'm1',
      prompt: 'un selfie avec votre voisin',
      startedAt: new Date(serverNowMs - 10_000).toISOString(),
      endsAt: new Date(serverNowMs + leftMs).toISOString(),
      state: 'running',
      answers: null,
    },
  }
}

describe('ChallengePanel', () => {
  beforeEach(() => {
    // Only the clock and the interval: promises and `waitFor` keep running on real timers.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-06-20T21:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const typeInto = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const box = await screen.findByLabelText(fr.challenge.prompt)
    await user.clear(box)
    await user.type(box, text)
  }

  it('launches the text the host typed, for two minutes by default, with no mission', async () => {
    const startChallenge = vi.fn(apiWith().startChallenge)
    render(apiWith({ startChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await typeInto(user, '  Un toast ')
    await user.click(screen.getByRole('button', { name: fr.challenge.launch }))

    expect(startChallenge).toHaveBeenCalledWith(SLUG, { prompt: 'Un toast', durationSeconds: 120 })
  })

  it('cannot launch with an empty text', async () => {
    render(apiWith())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    expect(await screen.findByRole('button', { name: fr.challenge.launch })).toBeDisabled()
    await typeInto(user, '   ')
    expect(screen.getByRole('button', { name: fr.challenge.launch })).toBeDisabled()
  })

  it('fills the box from a ready-made idea, which the host may correct', async () => {
    const startChallenge = vi.fn(apiWith().startChallenge)
    render(apiWith({ startChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: fr.challenge.ideas[0] }))
    expect(screen.getByLabelText(fr.challenge.prompt)).toHaveValue(fr.challenge.ideas[0])
    await user.click(screen.getByRole('button', { name: fr.challenge.launch }))

    expect(startChallenge).toHaveBeenCalledWith(SLUG, {
      prompt: fr.challenge.ideas[0],
      durationSeconds: 120,
    })
  })

  it('offers the last texts of the event and fills the box from one', async () => {
    const getChallenge = vi.fn(async () => ({
      serverNowMs: Date.now(),
      challenge: null,
      recent: ['Le plus beau selfie'],
    }))
    render(apiWith({ getChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'Le plus beau selfie' }))

    expect(screen.getByLabelText(fr.challenge.prompt)).toHaveValue('Le plus beau selfie')
  })

  it('sends the mission as a link when its text is taken as it is', async () => {
    const startChallenge = vi.fn(apiWith().startChallenge)
    render(apiWith({ startChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'la première danse' }))
    await user.click(screen.getByRole('button', { name: fr.challenge.launch }))

    expect(startChallenge).toHaveBeenCalledWith(SLUG, {
      prompt: 'la première danse',
      missionId: 'm2',
      durationSeconds: 120,
    })
  })

  it('cuts the link to the mission once its text is corrected', async () => {
    const startChallenge = vi.fn(apiWith().startChallenge)
    render(apiWith({ startChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'la première danse' }))
    await user.type(screen.getByLabelText(fr.challenge.prompt), '!')
    await user.click(screen.getByRole('button', { name: fr.challenge.launch }))

    expect(startChallenge).toHaveBeenCalledWith(SLUG, {
      prompt: 'la première danse!',
      durationSeconds: 120,
    })
  })

  it('launches with the duration the host chose', async () => {
    const startChallenge = vi.fn(apiWith().startChallenge)
    render(apiWith({ startChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await typeInto(user, 'Un toast')
    await user.selectOptions(screen.getByLabelText(fr.challenge.duration), '300')
    await user.click(screen.getByRole('button', { name: fr.challenge.launch }))

    expect(startChallenge).toHaveBeenCalledWith(SLUG, { prompt: 'Un toast', durationSeconds: 300 })
  })

  it('needs no mission at all, and offers no mission list without one', async () => {
    render(apiWith({ listMissions: vi.fn(async () => ({ items: [] })) }))

    await screen.findByLabelText(fr.challenge.prompt)

    expect(screen.queryByRole('group', { name: fr.challenge.fromMission })).toBeNull()
  })

  it('stops at sixty characters, the length of a mission text', async () => {
    render(apiWith())

    expect(await screen.findByLabelText(fr.challenge.prompt)).toHaveAttribute('maxlength', '60')
  })

  it('offers the four durations the interface promises', async () => {
    render(apiWith())

    const select = await screen.findByLabelText(fr.challenge.duration)

    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual([
      '60',
      '120',
      '300',
      '600',
    ])
  })

  it('refuses to launch on an event that is not live, and says so', async () => {
    render(apiWith(), false)

    expect(await screen.findByText(fr.challenge.notOpen)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.challenge.launch })).toBeDisabled()
  })

  it('shows the server’s refusal, and does not pretend it started', async () => {
    const startChallenge = vi.fn(async () => {
      throw new ApiError(409, 'challenge.alreadyRunning')
    })
    render(apiWith({ startChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await typeInto(user, 'Un toast')
    await user.click(screen.getByRole('button', { name: fr.challenge.launch }))

    expect(await screen.findByText(fr.errors['challenge.alreadyRunning'])).toBeVisible()
  })

  it('counts down against the server clock, whatever this machine’s clock says', async () => {
    // This machine runs three minutes ahead of the server: a naive `endsAt - Date.now()` would
    // read "0:00". The server's clock said 102 s were left.
    render(apiWith({ getChallenge: vi.fn(async () => running(102_000, -180_000)) }))

    expect(await screen.findByText(fr.challenge.remaining('1:42'))).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText(fr.challenge.remaining('1:41'))).toBeVisible()
  })

  it('stops the challenge and reads the state again', async () => {
    const getChallenge = vi.fn(async () => running(60_000))
    const stopChallenge = vi.fn(async () => undefined)
    render(apiWith({ getChallenge, stopChallenge }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: fr.challenge.stop }))

    expect(stopChallenge).toHaveBeenCalledWith(SLUG)
    await waitFor(() => expect(getChallenge).toHaveBeenCalledTimes(2))
  })

  it('reads the state again once when the countdown reaches zero', async () => {
    const getChallenge = vi.fn(async () => running(2_000))
    render(apiWith({ getChallenge }))
    await screen.findByText(fr.challenge.remaining('0:02'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    await waitFor(() => expect(getChallenge).toHaveBeenCalledTimes(2))
  })

  it('stops ticking when it is unmounted', async () => {
    const view = render(apiWith({ getChallenge: vi.fn(async () => running(60_000)) }))
    await screen.findByText(fr.challenge.remaining('1:00'))
    expect(vi.getTimerCount()).toBe(1)

    view.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
