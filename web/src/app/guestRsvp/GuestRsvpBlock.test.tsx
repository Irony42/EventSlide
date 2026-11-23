import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { forgetEditToken, readStoredEditToken, storeEditToken } from '../../lib/rsvp/rsvpDevice'
import type { Api } from '../../lib/api/client'
import {
  aGuestOwnRsvp,
  aGuestRsvpPage,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { GuestRsvpBlock } from './GuestRsvpBlock'

const TOKEN = '7QX0M4TZ2KD9WB3H'
const t = fr.rsvp.guest

/** The page's text reads a no-break space as a space: the table's own has one. */
const plain = (sentence: string): string => sentence.replaceAll(' ', ' ')

const render = (
  api: Partial<Api> = {},
  page = aGuestRsvpPage(),
  props: { interactive?: boolean } = {},
) =>
  renderWithProviders(<GuestRsvpBlock rsvp={page} token={TOKEN} locale="fr" {...props} />, {
    api: fakeApi(api),
  })

beforeEach(() => {
  window.localStorage.clear()
  forgetEditToken(TOKEN)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('asking: the window is open and this device holds no reply', () => {
  it('asks "Serez-vous là ?" with the deadline and the three answers, and no form yet', () => {
    render({}, aGuestRsvpPage({ deadline: '2026-12-01' }))

    expect(screen.getByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(screen.getByText(t.deadline('1 décembre'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.yes })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.maybe })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.no })).toBeInTheDocument()
    expect(screen.queryByLabelText(t.nameLabel)).not.toBeInTheDocument()
  })

  it('offers no "peut-être" when the host does not', () => {
    render({}, aGuestRsvpPage({ form: { ...aGuestRsvpPage().form, maybe: false } }))

    expect(screen.queryByRole('button', { name: t.maybe })).not.toBeInTheDocument()
  })

  it('shows the form under the buttons once an answer is chosen, with the notice under the send button', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.getByRole('button', { name: t.yes })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toBeInTheDocument()
    expect(screen.getByText(t.notice)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.send })).toBeInTheDocument()
  })

  it('asks for nobody and no diet when the answer is no, and for what the form says otherwise', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: t.yes }))
    expect(screen.getByLabelText(t.adults, { selector: 'output' })).toHaveTextContent('1')
    expect(screen.getByLabelText(t.kids, { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByLabelText(new RegExp(t.dietLabel))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t.no }))
    expect(screen.queryByLabelText(t.adults, { selector: 'output' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(new RegExp(t.dietLabel))).not.toBeInTheDocument()
    expect(screen.getByLabelText(new RegExp(t.messageLabel))).toBeInTheDocument()
  })

  it('does not ask how many, or about children or a diet, when the host did not', async () => {
    const user = userEvent.setup()
    render(
      {},
      aGuestRsvpPage({
        form: {
          maybe: true,
          partySize: { enabled: false, max: 4 },
          kidsSeparate: false,
          diet: false,
        },
      }),
    )

    await user.click(screen.getByRole('button', { name: t.yes }))

    expect(screen.queryByLabelText(t.adults, { selector: 'output' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(new RegExp(t.dietLabel))).not.toBeInTheDocument()
  })

  it('calls the children "Personnes" when they are not asked apart, and stops the steppers at the host’s maximum', async () => {
    const user = userEvent.setup()
    render(
      {},
      aGuestRsvpPage({
        form: {
          maybe: true,
          partySize: { enabled: true, max: 2 },
          kidsSeparate: false,
          diet: true,
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: t.yes }))

    const more = screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.people}`) })
    await user.click(more)
    await user.click(more)

    expect(screen.getByLabelText(t.people, { selector: 'output' })).toHaveTextContent('2')
  })

  it('sends the reply with the honeypot empty, keeps the token on the device and shows the confirmation', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async () => ({
      rsvp: aGuestOwnRsvp({ name: 'Léa Martin', answer: 'yes', adults: 2, kids: 0 }),
      editToken: 'token-from-the-box',
    }))
    render({ guestRsvpCreate })

    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa Martin')
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.adults}`) }))
    await user.click(screen.getByRole('button', { name: t.send }))

    await screen.findByRole('heading', { name: t.doneYes('Léa') })
    expect(guestRsvpCreate).toHaveBeenCalledWith(TOKEN, {
      name: 'Léa Martin',
      answer: 'yes',
      adults: 2,
      kids: 0,
      diet: null,
      message: null,
      website: '',
    })
    expect(readStoredEditToken(TOKEN)).toBe('token-from-the-box')
    expect(screen.getByRole('button', { name: t.edit })).toBeInTheDocument()
    expect(screen.getByText(t.linkTitle)).toBeInTheDocument()
  })

  it('sends the honeypot as it stands: a script that filled it is the server’s to catch', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async () => ({ rsvp: aGuestOwnRsvp(), editToken: 'x' }))
    render({ guestRsvpCreate })

    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Bot')
    await user.type(
      document.querySelector<HTMLInputElement>('input[name="website"]')!,
      'spam.example',
    )
    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() => expect(guestRsvpCreate).toHaveBeenCalled())
    expect(guestRsvpCreate).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ website: 'spam.example' }),
    )
  })

  it('hides the honeypot from people: not focusable, not announced', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: t.yes }))

    const trap = document.querySelector<HTMLInputElement>('input[name="website"]')

    expect(trap).toHaveAttribute('tabindex', '-1')
    expect(trap).toHaveAttribute('autocomplete', 'off')
    expect(trap?.closest('label')).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['a closed window', new ApiError(409, 'rsvp.closed'), fr.errors['rsvp.closed']],
    ['a refused field', new ApiError(400, 'rsvp.nameEmpty'), fr.errors['rsvp.nameEmpty']],
    ['a lost connection', ApiError.network(), t.failed],
    ['the box asking to slow down', new ApiError(429, 'rate.limited'), t.busy],
  ])('says %s in words, and keeps what was typed', async (_name, failure, sentence) => {
    const user = userEvent.setup()
    render({ guestRsvpCreate: vi.fn().mockRejectedValue(failure) })
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa')

    await user.click(screen.getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Léa')
  })

  it('shows who comes when the host chose to, as text', () => {
    render({}, aGuestRsvpPage({ proof: { count: 6, names: ['Léa', 'Hugo'] } }))

    expect(screen.getByText(t.proofNamesAndMany('Léa, Hugo', 4))).toBeInTheDocument()
  })

  it('shows only the number when the host chose to count', () => {
    render({}, aGuestRsvpPage({ proof: { count: 12, names: [] } }))

    expect(screen.getByText(t.proofCount(12))).toBeInTheDocument()
  })
})

describe('what is typed and sent', () => {
  it('sends the diet, the word, the children and a lowered count of adults as typed', async () => {
    const user = userEvent.setup()
    const guestRsvpCreate = vi.fn(async () => ({ rsvp: aGuestOwnRsvp(), editToken: 'x' }))
    render({ guestRsvpCreate })
    await user.click(screen.getByRole('button', { name: t.maybe }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Inès')
    const adults = new RegExp(`${t.more}.*${t.adults}`)
    await user.click(screen.getByRole('button', { name: adults }))
    await user.click(screen.getByRole('button', { name: adults }))
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.less}.*${t.adults}`) }))
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.kids}`) }))
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.more}.*${t.kids}`) }))
    await user.click(screen.getByRole('button', { name: new RegExp(`${t.less}.*${t.kids}`) }))
    await user.type(screen.getByLabelText(new RegExp(t.dietLabel)), 'végétarien')
    await user.type(screen.getByLabelText(new RegExp(t.messageLabel)), 'À samedi')

    await user.click(screen.getByRole('button', { name: t.send }))

    await waitFor(() => expect(guestRsvpCreate).toHaveBeenCalled())
    expect(guestRsvpCreate).toHaveBeenCalledWith(TOKEN, {
      name: 'Inès',
      answer: 'maybe',
      adults: 2,
      kids: 1,
      diet: 'végétarien',
      message: 'À samedi',
      website: '',
    })
  })

  it('sends one reply when the form is submitted twice while the first is on its way', async () => {
    let release: (value: {
      rsvp: ReturnType<typeof aGuestOwnRsvp>
      editToken: string
    }) => void = () => undefined
    const guestRsvpCreate = vi.fn(
      () =>
        new Promise<{ rsvp: ReturnType<typeof aGuestOwnRsvp>; editToken: string }>((resolve) => {
          release = resolve
        }),
    )
    const user = userEvent.setup()
    render({ guestRsvpCreate })
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa')
    const form = document.querySelector('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)
    release({ rsvp: aGuestOwnRsvp(), editToken: 'x' })

    await screen.findByRole('heading', { name: t.doneYes('Léa') })
    expect(guestRsvpCreate).toHaveBeenCalledTimes(1)
  })

  it('says it could not be sent when what failed is not a refusal of the box at all', async () => {
    const user = userEvent.setup()
    render({ guestRsvpCreate: vi.fn().mockRejectedValue(new Error('boom')) })
    await user.click(screen.getByRole('button', { name: t.yes }))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa')

    await user.click(screen.getByRole('button', { name: t.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed)
  })

  it('shows nothing of a reply that was read after the page was left', async () => {
    storeEditToken(TOKEN, 'held-token')
    let release: (value: { rsvp: ReturnType<typeof aGuestOwnRsvp> }) => void = () => undefined
    const guestRsvp = vi.fn(
      () =>
        new Promise<{ rsvp: ReturnType<typeof aGuestOwnRsvp> }>((resolve) => {
          release = resolve
        }),
    )
    const { unmount } = render({ guestRsvp })
    unmount()

    release({ rsvp: aGuestOwnRsvp() })
    await Promise.resolve()

    expect(guestRsvp).toHaveBeenCalledTimes(1)
  })

  it('stops reading when the page is left while the box was still answering with a refusal', async () => {
    storeEditToken(TOKEN, 'held-token')
    let refuse: (cause: unknown) => void = () => undefined
    const guestRsvp = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          refuse = reject
        }),
    )
    const { unmount } = render({ guestRsvp })
    unmount()

    refuse(new ApiError(404, 'rsvp.notFound'))
    await Promise.resolve()

    expect(readStoredEditToken(TOKEN)).toBe('held-token')
  })
})

describe('the device holds a reply', () => {
  const held = () => storeEditToken(TOKEN, 'held-token')

  it('reads it with the token it holds and shows the confirmation, with the way to change it', async () => {
    held()
    const guestRsvp = vi.fn(async () => ({
      rsvp: aGuestOwnRsvp({ name: 'Léa Martin', diet: 'noix', message: 'Hâte' }),
    }))
    render({ guestRsvp })

    await screen.findByRole('heading', { name: t.doneYes('Léa') })

    expect(guestRsvp).toHaveBeenCalledWith(TOKEN, 'held-token', expect.anything())
    expect(screen.getByText('Vous venez · 3 personnes dont 1 enfant')).toBeInTheDocument()
    expect(screen.getByText(plain(t.recapDiet('noix')))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.edit })).toBeInTheDocument()
  })

  it('answers a maybe and a no in their own words', async () => {
    held()
    const { unmount } = render({
      guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ answer: 'maybe' }) })),
    })
    expect(await screen.findByRole('heading', { name: t.doneMaybe })).toBeInTheDocument()
    expect(screen.getByText(t.maybeSub)).toBeInTheDocument()
    unmount()

    render({
      guestRsvp: vi.fn(async () => ({ rsvp: aGuestOwnRsvp({ answer: 'no', adults: 0, kids: 0 }) })),
    })
    expect(await screen.findByRole('heading', { name: t.doneNo('Léa') })).toBeInTheDocument()
    expect(screen.getByText(t.noSub)).toBeInTheDocument()
  })

  it('waits while it reads, then asks again if the box no longer knows the token, and forgets it', async () => {
    held()
    render({ guestRsvp: vi.fn().mockRejectedValue(new ApiError(404, 'rsvp.notFound')) })

    expect(await screen.findByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(screen.getByText(plain(t.forgotten))).toBeInTheDocument()
    expect(readStoredEditToken(TOKEN)).toBeNull()
  })

  it('keeps the token when the read only failed for the network, and asks as if nothing were known', async () => {
    held()
    render({ guestRsvp: vi.fn().mockRejectedValue(ApiError.network()) })

    expect(await screen.findByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(readStoredEditToken(TOKEN)).toBe('held-token')
    expect(screen.queryByText(plain(t.forgotten))).not.toBeInTheDocument()
  })

  it('takes the token of a link’s fragment, keeps it, and takes the fragment out of the address bar', async () => {
    window.history.replaceState(null, '', `/i/${TOKEN}#r=fragment-token-1234`)
    const guestRsvp = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))
    render({ guestRsvp })

    await screen.findByRole('heading', { name: t.doneYes('Léa') })

    expect(guestRsvp).toHaveBeenCalledWith(TOKEN, 'fragment-token-1234', expect.anything())
    expect(readStoredEditToken(TOKEN)).toBe('fragment-token-1234')
    expect(window.location.hash).toBe('')
  })

  it('works with no storage at all, asking as if nothing were known', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render()

    expect(screen.getByRole('heading', { name: t.title })).toBeInTheDocument()
  })

  it('changes the reply: the form is filled back, saved, and the confirmation says what changed', async () => {
    held()
    const user = userEvent.setup()
    const guestRsvpUpdate = vi.fn(async () => ({
      rsvp: aGuestOwnRsvp({ name: 'Léa M.', answer: 'no', adults: 0, kids: 0 }),
    }))
    render({ guestRsvpUpdate })
    await user.click(await screen.findByRole('button', { name: t.edit }))

    expect(screen.getByLabelText(new RegExp(t.nameLabel))).toHaveValue('Léa Martin')
    await user.click(screen.getByRole('button', { name: t.no }))
    await user.clear(screen.getByLabelText(new RegExp(t.nameLabel)))
    await user.type(screen.getByLabelText(new RegExp(t.nameLabel)), 'Léa M.')
    await user.click(screen.getByRole('button', { name: t.save }))

    await screen.findByRole('heading', { name: t.doneNo('Léa') })
    expect(guestRsvpUpdate).toHaveBeenCalledWith(TOKEN, 'held-token', {
      name: 'Léa M.',
      answer: 'no',
      message: null,
    })
  })

  it('goes back to the confirmation when the guest changes their mind about changing', async () => {
    held()
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: t.edit }))

    await user.click(screen.getByRole('button', { name: t.cancel }))

    expect(screen.getByRole('heading', { name: t.doneYes('Léa') })).toBeInTheDocument()
  })

  it('deletes the reply after a question, forgets the token and asks again', async () => {
    held()
    const user = userEvent.setup()
    const guestRsvpDelete = vi.fn(async () => undefined)
    render({ guestRsvpDelete })

    await user.click(await screen.findByRole('button', { name: t.delete }))
    const ask = screen.getByRole('alertdialog', { name: t.deleteAsk })
    expect(within(ask).getByText(t.deleteSub)).toBeInTheDocument()
    await user.click(within(ask).getByRole('button', { name: t.deleteYes }))

    await screen.findByText(t.deleted)
    expect(guestRsvpDelete).toHaveBeenCalledWith(TOKEN, 'held-token')
    expect(readStoredEditToken(TOKEN)).toBeNull()
    expect(screen.getByRole('heading', { name: t.title })).toBeInTheDocument()
  })

  it('treats a reply already gone as deleted: the box answers 204, the guest sees it deleted', async () => {
    held()
    const user = userEvent.setup()
    render({ guestRsvpDelete: vi.fn(async () => undefined) })
    await user.click(await screen.findByRole('button', { name: t.delete }))

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: t.deleteYes }),
    )

    expect(await screen.findByText(t.deleted)).toBeInTheDocument()
    expect(screen.queryByText(plain(t.forgotten))).not.toBeInTheDocument()
  })

  it('does not lose the token of the fragment when the hook is initialised twice and the storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    window.history.replaceState(null, '', `/i/${TOKEN}#r=fragment-token-1234`)
    const guestRsvp = vi.fn(async () => ({ rsvp: aGuestOwnRsvp() }))

    renderWithProviders(
      <StrictMode>
        <GuestRsvpBlock rsvp={aGuestRsvpPage()} token={TOKEN} locale="fr" />
      </StrictMode>,
      { api: fakeApi({ guestRsvp }) },
    )

    await screen.findByRole('heading', { name: t.doneYes('Léa') })
    expect(guestRsvp).toHaveBeenCalledWith(TOKEN, 'fragment-token-1234', expect.anything())
  })

  it('lets the guest back out of a deletion without sending anything', async () => {
    held()
    const user = userEvent.setup()
    const guestRsvpDelete = vi.fn(async () => undefined)
    render({ guestRsvpDelete })
    await user.click(await screen.findByRole('button', { name: t.delete }))

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: t.cancel }),
    )

    expect(guestRsvpDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: t.delete })).toBeInTheDocument()
  })

  it('says why a deletion failed and keeps the reply', async () => {
    held()
    const user = userEvent.setup()
    render({ guestRsvpDelete: vi.fn().mockRejectedValue(ApiError.network()) })
    await user.click(await screen.findByRole('button', { name: t.delete }))

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: t.deleteYes }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed)
    expect(readStoredEditToken(TOKEN)).toBe('held-token')
  })

  it('copies the private link, with the token in the fragment', async () => {
    held()
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
    render()
    await screen.findByRole('heading', { name: t.doneYes('Léa') })

    await user.click(screen.getByRole('button', { name: t.copy }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/i/${TOKEN}#r=held-token`)
    expect(await screen.findByRole('button', { name: t.copied })).toBeInTheDocument()
  })

  it('forgets a reply that vanished while the guest was changing it, and asks again', async () => {
    held()
    const user = userEvent.setup()
    render({ guestRsvpUpdate: vi.fn().mockRejectedValue(new ApiError(404, 'rsvp.notFound')) })
    await user.click(await screen.findByRole('button', { name: t.edit }))

    await user.click(screen.getByRole('button', { name: t.save }))

    expect(await screen.findByText(plain(t.forgotten))).toBeInTheDocument()
    expect(readStoredEditToken(TOKEN)).toBeNull()
  })
})

describe('the window is closed, or replies are not asked', () => {
  it('says the replies are closed, with the reply this device holds and no way to change it, but a way to erase it', async () => {
    storeEditToken(TOKEN, 'held-token')
    render({}, aGuestRsvpPage({ state: 'closed' }))

    expect(await screen.findByRole('heading', { name: t.closedTitle })).toBeInTheDocument()
    expect(screen.getByText(plain(t.closedSub))).toBeInTheDocument()
    expect(screen.getByText('Vous venez · 3 personnes dont 1 enfant')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.edit })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.delete })).toBeInTheDocument()
  })

  it('says the replies are closed when this device holds none, and asks nothing', () => {
    render({}, aGuestRsvpPage({ state: 'closed' }))

    expect(screen.getByRole('heading', { name: t.closedTitle })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
  })

  it('shows nothing at all when nobody is asked and this device holds nothing', () => {
    const { container } = render({}, aGuestRsvpPage({ state: 'off' }))

    expect(container.querySelector('section')).toBeNull()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows "Vous aviez répondu" when nobody is asked any more and the device holds a reply, which can still be erased', async () => {
    storeEditToken(TOKEN, 'held-token')
    render({}, aGuestRsvpPage({ state: 'off' }))

    expect(
      await screen.findByText(plain(t.earlier('Vous venez · 3 personnes dont 1 enfant'))),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.edit })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.delete })).toBeInTheDocument()
  })

  it('says it is deleted, with no form, after the guest erased their reply when replies are closed', async () => {
    storeEditToken(TOKEN, 'held-token')
    const user = userEvent.setup()
    render({}, aGuestRsvpPage({ state: 'off' }))
    await user.click(await screen.findByRole('button', { name: t.delete }))

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: t.deleteYes }),
    )

    expect(await screen.findByText(t.deleted)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.yes })).not.toBeInTheDocument()
  })
})

describe('in the host’s preview', () => {
  it('draws the block and reads and sends nothing', () => {
    storeEditToken(TOKEN, 'held-token')
    const guestRsvp = vi.fn()
    render({ guestRsvp }, aGuestRsvpPage(), { interactive: false })

    expect(screen.getByRole('heading', { name: t.title })).toBeInTheDocument()
    expect(guestRsvp).not.toHaveBeenCalled()
  })

  it('does not leave the fragment in the address bar either, and does not use it', () => {
    window.history.replaceState(null, '', `/i/${TOKEN}#r=fragment-token-1234`)
    render({}, aGuestRsvpPage(), { interactive: false })

    expect(window.location.hash).toBe('')
    expect(readStoredEditToken(TOKEN)).toBeNull()
  })
})
