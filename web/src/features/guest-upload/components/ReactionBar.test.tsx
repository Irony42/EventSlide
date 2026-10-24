import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { TRANSLATIONS } from '../../../lib/i18n/translations'
import { fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { ReactionBar } from './ReactionBar'
import type { Api } from '../../../lib/api/client'
import type { ReactionCounts, ReactionKind, ReactionsResponse } from '../../../lib/api/dto'

const SLUG = 'camille-et-sacha'
const PHOTO = 'photo-1'

const KINDS: readonly ReactionKind[] = ['love', 'laugh', 'wow', 'cheers', 'clap']

const countsOf = (overrides: Partial<ReactionCounts> = {}): ReactionCounts => ({
  love: 0,
  laugh: 0,
  wow: 0,
  cheers: 0,
  clap: 0,
  ...overrides,
})

const answer = (
  counts: Partial<ReactionCounts> = {},
  mine: readonly ReactionKind[] = [],
): ReactionsResponse => ({ counts: countsOf(counts), mine })

/** One promise a test settles by hand, so the moment *before* the server answers is observable. */
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {}
  let reject: (cause: unknown) => void = () => {}
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const renderBar = (overrides: Partial<Api> = {}, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, {
    api: fakeApi({ reactions: vi.fn(async () => answer()), ...overrides }),
    locale,
  })

/** The button for one kind, named the way a screen reader reads it: its word, then its count. */
const buttonFor = (kind: ReactionKind, count = 0): HTMLElement =>
  screen.getByRole('button', {
    name: fr.upload.reactionButton(fr.upload.reactionKinds[kind], count),
  })

const ready = async (): Promise<void> => {
  await waitFor(() => expect(buttonFor('love')).toBeEnabled())
}

describe('ReactionBar', () => {
  it('offers the five reactions of the closed set, each under its own word', async () => {
    renderBar()
    await ready()

    const group = screen.getByRole('group', { name: fr.upload.reactionsGroup(1) })
    const names = Array.from(group.querySelectorAll('button')).map((button) =>
      button.getAttribute('aria-label'),
    )
    expect(names).toEqual(
      KINDS.map((kind) => fr.upload.reactionButton(fr.upload.reactionKinds[kind], 0)),
    )
  })

  it('shows what the room already felt, and which of it this phone sent', async () => {
    renderBar({ reactions: vi.fn(async () => answer({ love: 3, cheers: 1 }, ['love'])) })

    await waitFor(() => expect(buttonFor('love', 3)).toHaveAttribute('aria-pressed', 'true'))
    expect(buttonFor('cheers', 1)).toHaveAttribute('aria-pressed', 'false')
    expect(buttonFor('laugh')).toHaveAttribute('aria-pressed', 'false')
  })

  it('cannot be pressed before the server has said what this phone already sent', async () => {
    // A tap on a reaction the guest had already given would be answered with a refusal
    // about something they were never shown.
    const pending = deferred<ReactionsResponse>()
    renderBar({ reactions: vi.fn(() => pending.promise) })

    expect(buttonFor('love')).toBeDisabled()

    pending.resolve(answer())
    await ready()
  })

  it('sends a reaction at once, before the server has answered', async () => {
    const sent = deferred<void>()
    const api = fakeApi({
      reactions: vi.fn(async () => answer()),
      react: vi.fn(() => sent.promise),
    })
    renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, { api })
    await ready()

    await userEvent.click(buttonFor('love'))

    expect(api.react).toHaveBeenCalledWith(SLUG, PHOTO, 'love')
    expect(buttonFor('love', 1)).toHaveAttribute('aria-pressed', 'true')

    sent.resolve()
    await waitFor(() => expect(buttonFor('love', 1)).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes a reaction back with a second tap', async () => {
    const api = fakeApi({ reactions: vi.fn(async () => answer({ love: 2 }, ['love'])) })
    renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, { api })
    await waitFor(() => expect(buttonFor('love', 2)).toBeEnabled())

    await userEvent.click(buttonFor('love', 2))

    expect(api.withdrawReaction).toHaveBeenCalledWith(SLUG, PHOTO, 'love')
    expect(api.react).not.toHaveBeenCalled()
    expect(buttonFor('love', 1)).toHaveAttribute('aria-pressed', 'false')
  })

  it('rolls a refused reaction back and says why in plain words', async () => {
    renderBar({
      react: vi.fn(async () => {
        throw new ApiError(403, 'event.reactionsDisabled')
      }),
    })
    await ready()

    await userEvent.click(buttonFor('love'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.reactionsDisabled'])
    expect(buttonFor('love', 0)).toHaveAttribute('aria-pressed', 'false')
  })

  it('tells a guest whose budget is spent to slow down, and keeps nothing of the tap', async () => {
    renderBar({
      react: vi.fn(async () => {
        throw new ApiError(429, 'reaction.rateLimited')
      }),
    })
    await ready()

    await userEvent.click(buttonFor('wow'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['reaction.rateLimited'])
    expect(buttonFor('wow', 0)).toHaveAttribute('aria-pressed', 'false')
  })

  it('says the connection dropped when it did, and keeps nothing of the tap', async () => {
    renderBar({
      react: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    await ready()

    await userEvent.click(buttonFor('clap'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(buttonFor('clap', 0)).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps a reaction pressed when taking it back is refused', async () => {
    renderBar({
      reactions: vi.fn(async () => answer({ laugh: 1 }, ['laugh'])),
      withdrawReaction: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    await waitFor(() => expect(buttonFor('laugh', 1)).toBeEnabled())

    await userEvent.click(buttonFor('laugh', 1))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(buttonFor('laugh', 1)).toHaveAttribute('aria-pressed', 'true')
  })

  it('rolls back only the reaction that was refused, not one sent beside it', async () => {
    const refused = deferred<void>()
    renderBar({
      react: vi.fn((_slug: string, _photo: string, kind: ReactionKind) =>
        kind === 'love' ? refused.promise : Promise.resolve(),
      ),
    })
    await ready()

    await userEvent.click(buttonFor('love'))
    await userEvent.click(buttonFor('laugh'))
    refused.reject(new ApiError(429, 'reaction.rateLimited'))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(buttonFor('love', 0)).toHaveAttribute('aria-pressed', 'false')
    expect(buttonFor('laugh', 1)).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends one request however many times a reaction is tapped while it is in flight', async () => {
    const sent = deferred<void>()
    const api = fakeApi({
      reactions: vi.fn(async () => answer()),
      react: vi.fn(() => sent.promise),
    })
    renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, { api })
    await ready()

    await userEvent.click(buttonFor('love'))
    await userEvent.click(buttonFor('love', 1))
    await userEvent.click(buttonFor('love', 1))

    expect(api.react).toHaveBeenCalledTimes(1)
    expect(api.withdrawReaction).not.toHaveBeenCalled()
    sent.resolve()
  })

  it('believes the server when it says the reaction already exists, and reads again', async () => {
    // A reply lost on venue Wi-Fi leaves the phone thinking it never sent a reaction the
    // server has. Rolling back and stopping there would leave the button lying.
    let reads = 0
    const api = fakeApi({
      reactions: vi.fn(async () => {
        reads += 1
        return reads === 1 ? answer() : answer({ love: 1 }, ['love'])
      }),
      react: vi.fn(async () => {
        throw new ApiError(409, 'reaction.alreadyExists')
      }),
    })
    renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, { api })
    await ready()

    await userEvent.click(buttonFor('love'))

    await waitFor(() => expect(buttonFor('love', 1)).toHaveAttribute('aria-pressed', 'true'))
    expect(api.reactions).toHaveBeenCalledTimes(2)
  })

  it('says the reactions could not be read, offers no button, and reads again on retry', async () => {
    let reads = 0
    renderBar({
      reactions: vi.fn(async () => {
        reads += 1
        if (reads === 1) throw ApiError.network()
        return answer({ clap: 4 })
      }),
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.upload.reactionsFailed)
    expect(screen.queryByRole('group')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    await waitFor(() => expect(buttonFor('clap', 4)).toBeEnabled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is operated from the keyboard, with Enter and with Space', async () => {
    const api = fakeApi({ reactions: vi.fn(async () => answer()) })
    renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, { api })
    await ready()

    buttonFor('love').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.react).toHaveBeenCalledWith(SLUG, PHOTO, 'love'))

    await userEvent.tab()
    expect(buttonFor('laugh')).toHaveFocus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(api.react).toHaveBeenCalledWith(SLUG, PHOTO, 'laugh'))
  })

  it('names the reactions in the language the guest reads', async () => {
    const en = TRANSLATIONS.en
    renderBar({}, 'en')

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: en.upload.reactionButton(en.upload.reactionKinds.love, 0),
        }),
      ).toBeEnabled(),
    )
    expect(screen.getByRole('group', { name: en.upload.reactionsGroup(1) })).toBeVisible()
  })
})
