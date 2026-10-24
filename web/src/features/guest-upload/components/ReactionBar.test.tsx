import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { TRANSLATIONS } from '../../../lib/i18n/translations'
import { fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { ReactionBar } from './ReactionBar'
import type { Api } from '../../../lib/api/client'
import type { ReactionKind, ReactionsResponse } from '../../../lib/api/dto'

const SLUG = 'camille-et-sacha'
const PHOTO = 'photo-1'

const KINDS: readonly ReactionKind[] = ['love', 'laugh', 'wow', 'cheers', 'clap']

/**
 * What the server says this phone holds on the photo. The counts are the server's own and
 * the screen shows none of them, so they are zero here: what is asserted is the buttons.
 */
const holding = (...mine: readonly ReactionKind[]): ReactionsResponse => ({
  counts: { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 },
  mine,
})

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

const bar = (overrides: Partial<Api> = {}): Api =>
  fakeApi({ reactions: vi.fn(async () => holding()), ...overrides })

const renderBar = (api: Api, locale: 'fr' | 'en' = 'fr') =>
  renderWithProviders(<ReactionBar slug={SLUG} photoId={PHOTO} position={1} />, { api, locale })

/** The button for one kind, found by the word a screen reader says for it. */
const buttonFor = (kind: ReactionKind): HTMLElement =>
  screen.getByRole('button', { name: fr.upload.reactionKinds[kind] })

const ready = async (): Promise<void> => {
  await waitFor(() => expect(buttonFor('love')).toBeEnabled())
}

const pressed = (kind: ReactionKind): void => {
  expect(buttonFor(kind)).toHaveAttribute('aria-pressed', 'true')
}

const notPressed = (kind: ReactionKind): void => {
  expect(buttonFor(kind)).toHaveAttribute('aria-pressed', 'false')
}

describe('ReactionBar', () => {
  it('offers the five reactions of the closed set, each under its own word', async () => {
    renderBar(bar())
    await ready()

    const group = screen.getByRole('group', { name: fr.upload.reactionsGroup(1) })
    const names = Array.from(group.querySelectorAll('button')).map((button) =>
      button.getAttribute('aria-label'),
    )
    expect(names).toEqual(KINDS.map((kind) => fr.upload.reactionKinds[kind]))
  })

  it('shows which reactions this phone already sent', async () => {
    renderBar(bar({ reactions: vi.fn(async () => holding('love', 'cheers')) }))

    await waitFor(() => pressed('love'))
    pressed('cheers')
    notPressed('laugh')
  })

  it('cannot be pressed before the server has said what this phone already sent', async () => {
    // A tap on a reaction the guest had already given would be answered with a refusal
    // about something they were never shown.
    const pending = deferred<ReactionsResponse>()
    renderBar(bar({ reactions: vi.fn(() => pending.promise) }))

    expect(buttonFor('love')).toBeDisabled()
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true')

    pending.resolve(holding())
    await ready()
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-busy')
  })

  it('stops reading when the photo leaves the screen', async () => {
    // The read is the one request this bar makes on its own, and a list of twenty rows that
    // is closed mid-load must not leave twenty of them running.
    let signal: AbortSignal | undefined
    const api = bar({
      reactions: vi.fn((_slug: string, _photo: string, given?: AbortSignal) => {
        signal = given
        return new Promise<ReactionsResponse>(() => {})
      }),
    })
    const { unmount } = renderBar(api)
    expect(signal?.aborted).toBe(false)

    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('sends a reaction at once, before the server has answered', async () => {
    const sent = deferred<void>()
    const api = bar({ react: vi.fn(() => sent.promise) })
    renderBar(api)
    await ready()

    await userEvent.click(buttonFor('love'))

    expect(api.react).toHaveBeenCalledWith(SLUG, PHOTO, 'love')
    pressed('love')

    sent.resolve()
    await waitFor(() => pressed('love'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes a reaction back with a second tap', async () => {
    const api = bar({ reactions: vi.fn(async () => holding('love')) })
    renderBar(api)
    await waitFor(() => pressed('love'))
    await ready()

    await userEvent.click(buttonFor('love'))

    expect(api.withdrawReaction).toHaveBeenCalledWith(SLUG, PHOTO, 'love')
    expect(api.react).not.toHaveBeenCalled()
    notPressed('love')
  })

  it('rolls a refused reaction back and says why in plain words', async () => {
    renderBar(
      bar({
        react: vi.fn(async () => {
          throw new ApiError(403, 'event.reactionsDisabled')
        }),
      }),
    )
    await ready()

    await userEvent.click(buttonFor('love'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.reactionsDisabled'])
    notPressed('love')
  })

  it('tells a guest whose budget is spent to slow down, and keeps nothing of the tap', async () => {
    renderBar(
      bar({
        react: vi.fn(async () => {
          throw new ApiError(429, 'reaction.rateLimited')
        }),
      }),
    )
    await ready()

    await userEvent.click(buttonFor('wow'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['reaction.rateLimited'])
    notPressed('wow')
  })

  it('says the connection dropped when it did, and shows what the server holds', async () => {
    renderBar(
      bar({
        react: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )
    await ready()

    await userEvent.click(buttonFor('clap'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    await ready()
    notPressed('clap')
  })

  it('believes the server over its own screen after a lost reply, and still says so', async () => {
    // The request arrived and only its reply was lost: the wall has already shown the heart.
    // "Not sent" would be the phone lying about a reaction the room saw.
    let reads = 0
    renderBar(
      bar({
        reactions: vi.fn(async () => {
          reads += 1
          return reads === 1 ? holding() : holding('love')
        }),
        react: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )
    await ready()

    await userEvent.click(buttonFor('love'))

    await waitFor(() => pressed('love'))
    expect(screen.getByRole('alert')).toHaveTextContent(fr.errors.network)
  })

  it('keeps a reaction pressed when taking it back is refused', async () => {
    renderBar(
      bar({
        reactions: vi.fn(async () => holding('laugh')),
        withdrawReaction: vi.fn(async () => {
          throw new ApiError(429, 'reaction.rateLimited')
        }),
      }),
    )
    await waitFor(() => pressed('laugh'))
    await ready()

    await userEvent.click(buttonFor('laugh'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['reaction.rateLimited'])
    pressed('laugh')
  })

  it('rolls back only the reaction that was refused, not one sent beside it', async () => {
    const refused = deferred<void>()
    renderBar(
      bar({
        react: vi.fn((_slug: string, _photo: string, kind: ReactionKind) =>
          kind === 'love' ? refused.promise : Promise.resolve(),
        ),
      }),
    )
    await ready()

    await userEvent.click(buttonFor('love'))
    await userEvent.click(buttonFor('laugh'))
    refused.reject(new ApiError(429, 'reaction.rateLimited'))

    expect(await screen.findByRole('alert')).toBeVisible()
    notPressed('love')
    pressed('laugh')
  })

  it('clears the sentence when the next tap is made', async () => {
    let refuse = true
    renderBar(
      bar({
        react: vi.fn(async () => {
          if (refuse) throw new ApiError(429, 'reaction.rateLimited')
        }),
      }),
    )
    await ready()
    await userEvent.click(buttonFor('love'))
    expect(await screen.findByRole('alert')).toBeVisible()

    refuse = false
    await userEvent.click(buttonFor('laugh'))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends one request however many times a reaction is tapped while it is in flight', async () => {
    const sent = deferred<void>()
    const api = bar({ react: vi.fn(() => sent.promise) })
    renderBar(api)
    await ready()

    await userEvent.click(buttonFor('love'))
    await userEvent.click(buttonFor('love'))
    await userEvent.click(buttonFor('love'))

    expect(api.react).toHaveBeenCalledTimes(1)
    expect(api.withdrawReaction).not.toHaveBeenCalled()
    sent.resolve()
  })

  it('believes the server when it says the reaction already exists, and reads again', async () => {
    // A reply lost on venue Wi-Fi leaves the phone thinking it never sent a reaction the
    // server has. Taking the tap back and stopping there would leave the button lying.
    let reads = 0
    const api = bar({
      reactions: vi.fn(async () => {
        reads += 1
        return reads === 1 ? holding() : holding('love')
      }),
      react: vi.fn(async () => {
        throw new ApiError(409, 'reaction.alreadyExists')
      }),
    })
    renderBar(api)
    await ready()

    await userEvent.click(buttonFor('love'))

    await waitFor(() => pressed('love'))
    expect(api.reactions).toHaveBeenCalledTimes(2)
  })

  it('believes the server when it says the reaction is already gone, and reads again', async () => {
    let reads = 0
    const api = bar({
      reactions: vi.fn(async () => {
        reads += 1
        return reads === 1 ? holding('love') : holding()
      }),
      withdrawReaction: vi.fn(async () => {
        throw new ApiError(404, 'reaction.notFound')
      }),
    })
    renderBar(api)
    await waitFor(() => pressed('love'))
    await ready()

    await userEvent.click(buttonFor('love'))

    await waitFor(() => notPressed('love'))
    expect(api.reactions).toHaveBeenCalledTimes(2)
  })

  it('reads the row again only once the taps still in the air have landed', async () => {
    // A snapshot taken while a request is on its way can be answered without it, and would
    // take that tap off the screen while the server holds it. So the buttons rest, and the
    // read waits for the laugh to land.
    const laugh = deferred<void>()
    let reads = 0
    const api = bar({
      reactions: vi.fn(async () => {
        reads += 1
        return reads === 1 ? holding() : holding('love', 'laugh')
      }),
      react: vi.fn((_slug: string, _photo: string, kind: ReactionKind) =>
        kind === 'laugh'
          ? laugh.promise
          : Promise.reject(new ApiError(409, 'reaction.alreadyExists')),
      ),
    })
    renderBar(api)
    await ready()

    await userEvent.click(buttonFor('laugh'))
    await userEvent.click(buttonFor('love'))
    await waitFor(() => expect(buttonFor('wow')).toBeDisabled())

    expect(api.reactions).toHaveBeenCalledTimes(1)

    laugh.resolve()
    await waitFor(() => expect(api.reactions).toHaveBeenCalledTimes(2))
    await waitFor(() => pressed('love'))
    pressed('laugh')
  })

  it('keeps the buttons it has when reading the row again fails', async () => {
    // The refusal already told the guest what happened; a second failure on top of it must
    // not take the row away from under their thumb.
    let reads = 0
    renderBar(
      bar({
        reactions: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw ApiError.network()
          return holding()
        }),
        react: vi.fn(async () => {
          throw new ApiError(409, 'reaction.alreadyExists')
        }),
      }),
    )
    await ready()

    await userEvent.click(buttonFor('love'))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['reaction.alreadyExists'])
    await waitFor(() => expect(buttonFor('love')).toBeEnabled())
    expect(screen.getByRole('group', { name: fr.upload.reactionsGroup(1) })).toBeVisible()
  })

  it('says quietly that the reactions could not be read, and reads again on retry', async () => {
    // Not an alert: a guest did not ask for it, and on twenty photographs over a bad
    // connection it would be twenty of them.
    let reads = 0
    renderBar(
      bar({
        reactions: vi.fn(async () => {
          reads += 1
          if (reads === 1) throw ApiError.network()
          return holding('clap')
        }),
      }),
    )

    expect(await screen.findByText(fr.upload.reactionsFailed)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    await waitFor(() => pressed('clap'))
    expect(screen.queryByText(fr.upload.reactionsFailed)).toBeNull()
    // The button that was pressed is gone; focus did not fall to the top of the page.
    expect(screen.getByRole('group').parentElement).toHaveFocus()
  })

  it('is operated from the keyboard, with Enter and with Space', async () => {
    const api = bar()
    renderBar(api)
    await ready()

    buttonFor('love').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.react).toHaveBeenCalledWith(SLUG, PHOTO, 'love'))

    await userEvent.tab()
    expect(buttonFor('laugh')).toHaveFocus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(api.react).toHaveBeenCalledWith(SLUG, PHOTO, 'laugh'))
  })

  it('keeps every button at the touch minimum, and fills the one that is pressed', async () => {
    // jsdom resolves the cascade but not `var()`, so what is read is the declaration: the
    // 44 px floor of the guest surface, and a fill where the resting button has none — the
    // difference in lightness that carries the state for a guest who cannot tell hues apart.
    renderBar(bar({ reactions: vi.fn(async () => holding('love')) }))
    await waitFor(() => pressed('love'))
    await ready()

    const resting = window.getComputedStyle(buttonFor('laugh'))
    const given = window.getComputedStyle(buttonFor('love'))

    expect(resting.minWidth).toBe('var(--touch-min)')
    expect(resting.minHeight).toBe('var(--touch-min)')
    expect(given.backgroundColor).toBe('var(--accent)')
    expect(resting.backgroundColor).not.toBe(given.backgroundColor)
  })

  it('names the reactions in the language the guest reads', async () => {
    const en = TRANSLATIONS.en
    renderBar(bar(), 'en')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: en.upload.reactionKinds.love })).toBeEnabled(),
    )
    expect(screen.getByRole('group', { name: en.upload.reactionsGroup(1) })).toBeVisible()
  })
})
