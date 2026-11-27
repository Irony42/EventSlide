import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import type { HouseholdDto } from '../../../lib/api/dto'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import {
  aGuestInviteHost,
  aHousehold,
  anEventDto,
  aRsvpSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { HouseholdsPage } from './HouseholdsPage'

const text = fr.rsvp.households
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')
const INVITE = 'https://photos.example.test/i/7QX0M4TZ2KD9WB3H'

const martin = aHousehold({
  id: 'h-1',
  name: 'Famille Martin',
  places: 4,
  token: 'AAAAAAAAAAAAAAAA',
})
const elodie = aHousehold({
  id: 'h-2',
  name: 'Élodie Roux',
  places: 2,
  token: 'BBBBBBBBBBBBBBBB',
  reply: { id: 'r-2', answer: 'yes', people: 2 },
})
const durand = aHousehold({
  id: 'h-3',
  name: 'Les Durand',
  places: 3,
  token: 'CCCCCCCCCCCCCCCC',
  remindedAt: '2026-11-22T10:00:00.000Z',
})

const listing = (households: readonly HouseholdDto[], extra: Partial<Api> = {}): Api =>
  fakeApi({
    households: vi.fn(async () => ({ households })),
    guestInvite: vi.fn(async () => ({ guestInvite: aGuestInviteHost({ url: INVITE }) })),
    rsvpForm: vi.fn(async () => ({
      rsvpForm: aRsvpSettings({ enabled: true, state: 'open', deadline: '2026-12-01' }),
    })),
    ...extra,
  })

const render = (api: Api) =>
  renderWithProviders(<HouseholdsPage />, {
    api,
    route: '/admin/events/camille-et-sacha/rsvps/guests',
    path: '/admin/events/:slug/rsvps/guests',
  })

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the guest list: reading', () => {
  it('lists each household with its places and where its answer stands, and says how many there are', async () => {
    render(listing([martin, elodie, durand]))

    const table = await screen.findByRole('table')
    expect(
      within(within(table).getByRole('row', { name: /Famille Martin/ })).getByText(
        text.statusPending,
      ),
    ).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Élodie Roux/ })).toHaveTextContent(
      text.statusYes(2),
    )
    expect(within(table).getByRole('row', { name: /Les Durand/ })).toHaveTextContent(
      /Relancé le 22 novembre/,
    )
    expect(screen.getByText(text.summary(3, 9))).toBeInTheDocument()
    expect(plain(text.intro)).toContain('jamais d’adresse e-mail')
  })

  it('filters on who has not answered and searches a name without regard to accents', async () => {
    const user = userEvent.setup()
    render(listing([martin, elodie, durand]))
    const table = await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: new RegExp(text.filterPending) }))
    expect(within(table).queryByText('Élodie Roux')).not.toBeInTheDocument()
    expect(within(table).getByText('Famille Martin')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: new RegExp(text.filterAll) }))
    await user.type(screen.getByRole('searchbox', { name: text.searchLabel }), 'elodie')
    expect(within(table).getByText('Élodie Roux')).toBeInTheDocument()
    expect(within(table).queryByText('Famille Martin')).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: text.searchLabel }))
    await user.type(screen.getByRole('searchbox', { name: text.searchLabel }), 'zzz')
    expect(screen.getByText(text.noneHere)).toBeInTheDocument()
  })

  it('invites to start when the list is empty', async () => {
    render(listing([]))

    expect(await screen.findByText(text.emptyTitle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.add })).toBeEnabled()
  })

  it('says when the list could not be loaded, and tries again', async () => {
    const households = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue({ households: [martin] })
    const user = userEvent.setup()
    render(listing([], { households }))

    await user.click(await screen.findByRole('button', { name: /Réessayer/ }))

    expect(within(await screen.findByRole('table')).getByText('Famille Martin')).toBeInTheDocument()
  })

  it('is the owner’s: a moderator is told so and shown nothing', async () => {
    render(listing([martin], { getEvent: vi.fn(async () => anEventDto({ role: 'moderator' })) }))

    expect(await screen.findByText(fr.guestInvite.host.ownerOnly)).toBeInTheDocument()
    expect(screen.queryByText('Famille Martin')).not.toBeInTheDocument()
  })

  it('reads the list again when a reply lands', async () => {
    const households = vi.fn(async () => ({ households: [martin] }))
    render(listing([], { households }))
    await screen.findByRole('table')
    const reads = households.mock.calls.length

    act(() => FakeEventSource.latest('the page').emitSignal('rsvp.changed'))

    await waitFor(() => expect(households.mock.calls.length).toBeGreaterThan(reads))
  })
})

describe('the guest list: adding and changing', () => {
  it('adds a household with its name and places', async () => {
    const addHousehold = vi.fn(async () => ({ household: martin }))
    const user = userEvent.setup()
    render(listing([], { addHousehold }))

    await user.click(await screen.findByRole('button', { name: text.add }))
    await user.type(screen.getByLabelText(text.formName), 'Famille Roux')
    await user.clear(screen.getByLabelText(new RegExp(text.formPlaces)))
    await user.type(screen.getByLabelText(new RegExp(text.formPlaces)), '3')
    await user.click(screen.getByRole('button', { name: text.formSave }))

    await waitFor(() =>
      expect(addHousehold).toHaveBeenCalledWith('camille-et-sacha', {
        name: 'Famille Roux',
        places: 3,
      }),
    )
    await waitFor(() => expect(screen.queryByLabelText(text.formName)).not.toBeInTheDocument())
  })

  it('shows the sentence of a refusal in the form and keeps what was typed', async () => {
    const addHousehold = vi.fn(async () => {
      throw new ApiError(409, 'household.tooMany')
    })
    const user = userEvent.setup()
    render(listing([], { addHousehold }))

    await user.click(await screen.findByRole('button', { name: text.add }))
    await user.type(screen.getByLabelText(text.formName), 'Famille Roux')
    await user.click(screen.getByRole('button', { name: text.formSave }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plain(fr.errors['household.tooMany']),
    )
    expect(screen.getByLabelText(text.formName)).toHaveValue('Famille Roux')
  })

  it('changes a household’s name and places', async () => {
    const updateHousehold = vi.fn(async () => ({ household: martin }))
    const user = userEvent.setup()
    render(listing([martin], { updateHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.edit} · Famille Martin` }))
    const name = screen.getByLabelText(text.formName)
    await user.clear(name)
    await user.type(name, 'Les Martin')
    await user.click(screen.getByRole('button', { name: text.formSave }))

    await waitFor(() =>
      expect(updateHousehold).toHaveBeenCalledWith('camille-et-sacha', 'h-1', {
        name: 'Les Martin',
        places: 4,
      }),
    )
  })

  it('has nothing to add to before the invitation is saved, and says where to go', async () => {
    render(
      listing([martin], {
        rsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings({ invited: false }) })),
      }),
    )

    expect(await screen.findByText(new RegExp(text.noInvite.slice(0, 20)))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: text.noInviteLink })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.add })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.importList })).toBeDisabled()
  })
})

describe('the guest list: pasting a list', () => {
  it('sends the text, then says how many were added and which lines were left out, and why', async () => {
    const importHouseholds = vi.fn(async () => ({
      households: [martin, elodie],
      skipped: [
        { line: 3, reason: 'duplicate' as const },
        { line: 4, reason: 'places' as const },
      ],
    }))
    const user = userEvent.setup()
    render(listing([], { importHouseholds }))

    await user.click(await screen.findByRole('button', { name: text.importList }))
    await user.type(screen.getByLabelText(text.importLabel), 'Martin ; 4{Enter}Roux ; 2')
    await user.click(screen.getByRole('button', { name: text.importSubmit }))

    await waitFor(() =>
      expect(importHouseholds).toHaveBeenCalledWith('camille-et-sacha', 'Martin ; 4\nRoux ; 2'),
    )
    expect(await screen.findByText(text.importDone(2))).toBeInTheDocument()
    expect(
      screen.getByText(plain(text.importSkippedLine(3, text.importReasons.duplicate))),
    ).toBeInTheDocument()
    expect(
      screen.getByText(plain(text.importSkippedLine(4, text.importReasons.places))),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.importClose }))
    expect(screen.queryByLabelText(text.importLabel)).not.toBeInTheDocument()
  })

  it('says so when nothing was added, and shows a refusal in the dialog', async () => {
    const importHouseholds = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'household.importTooLong'))
      .mockResolvedValueOnce({ households: [], skipped: [{ line: 1, reason: 'name' }] })
    const user = userEvent.setup()
    render(listing([], { importHouseholds }))

    await user.click(await screen.findByRole('button', { name: text.importList }))
    await user.type(screen.getByLabelText(text.importLabel), 'x')
    await user.click(screen.getByRole('button', { name: text.importSubmit }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      plain(fr.errors['household.importTooLong']),
    )

    await user.click(screen.getByRole('button', { name: text.importSubmit }))
    expect(await screen.findByText(text.importNothing)).toBeInTheDocument()
  })
})

describe('the guest list: links, deletion and a new link', () => {
  it('copies the household’s personal link, its secret in the fragment', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(listing([martin]))

    await user.click(
      await screen.findByRole('button', { name: `${text.copyLink} · Famille Martin` }),
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${INVITE}#f=AAAAAAAAAAAAAAAA`))
    expect(await screen.findByText(text.linkCopied)).toBeInTheDocument()
  })

  it('shows the link to copy by hand when the browser refuses the clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    const user = userEvent.setup()
    render(listing([martin]))

    await user.click(
      await screen.findByRole('button', { name: `${text.copyLink} · Famille Martin` }),
    )

    expect(await screen.findByText(new RegExp(`${INVITE}#f=AAAAAAAAAAAAAAAA`))).toBeInTheDocument()
  })

  it('cannot copy a link while the invitation has no address', async () => {
    render(
      listing([martin], {
        guestInvite: vi.fn(async () => ({ guestInvite: aGuestInviteHost({ url: null }) })),
      }),
    )

    expect(
      await screen.findByRole('button', { name: `${text.copyLink} · Famille Martin` }),
    ).toBeDisabled()
  })

  it('deletes a household after a confirmation that says its reply stays', async () => {
    const deleteHousehold = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(listing([martin], { deleteHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.remove} · Famille Martin` }))
    expect(screen.getByText(text.deleteBody)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.deleteYes }))

    await waitFor(() => expect(deleteHousehold).toHaveBeenCalledWith('camille-et-sacha', 'h-1'))
  })

  it('takes a household that is already gone for a deletion done', async () => {
    const deleteHousehold = vi.fn(async () => {
      throw new ApiError(404, 'household.notFound')
    })
    const user = userEvent.setup()
    render(listing([martin], { deleteHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.remove} · Famille Martin` }))
    await user.click(screen.getByRole('button', { name: text.deleteYes }))

    await waitFor(() => expect(screen.queryByText(text.deleteBody)).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the sentence of any other failure to delete', async () => {
    const deleteHousehold = vi.fn(async () => {
      throw new ApiError(403, 'client.suspended')
    })
    const user = userEvent.setup()
    render(listing([martin], { deleteHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.remove} · Famille Martin` }))
    await user.click(screen.getByRole('button', { name: text.deleteYes }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('changes a household’s link after a confirmation that says the old one stops', async () => {
    const rotateHousehold = vi.fn(async () => ({ household: martin }))
    const user = userEvent.setup()
    render(listing([martin], { rotateHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.rotate} · Famille Martin` }))
    expect(screen.getByText(text.rotateBody)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.rotateYes }))

    await waitFor(() => expect(rotateHousehold).toHaveBeenCalledWith('camille-et-sacha', 'h-1'))
  })

  it('is read-only on an archived event, except for erasing a household', async () => {
    render(listing([martin], { getEvent: vi.fn(async () => anEventDto({ status: 'archived' })) }))

    expect(await screen.findByRole('button', { name: text.add })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.importList })).toBeDisabled()
    expect(screen.getByRole('button', { name: `${text.edit} · Famille Martin` })).toBeDisabled()
    expect(screen.getByRole('button', { name: `${text.rotate} · Famille Martin` })).toBeDisabled()
    expect(screen.getByRole('button', { name: `${text.remove} · Famille Martin` })).toBeEnabled()
  })
})

describe('the guest list: the guided reminder', () => {
  const link = `${INVITE}#f=AAAAAAAAAAAAAAAA`

  it('prepares the message of the first household without a reply, with its link', async () => {
    render(listing([elodie, martin, durand]))

    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    expect(within(panel).getByText(text.reminderProgress(1, 2))).toBeInTheDocument()
    expect(within(panel).getByText('Famille Martin')).toBeInTheDocument()
    const message = within(panel).getByRole('textbox') as HTMLTextAreaElement
    expect(message.value).toContain('Bonjour Famille Martin')
    expect(message.value).toContain('avant le 1 décembre')
    expect(message.value.endsWith(link)).toBe(true)
  })

  it('opens the host’s own applications with the message ready and no recipient, and notes the reminder', async () => {
    const remindHousehold = vi.fn(async () => ({ household: martin }))
    const user = userEvent.setup()
    render(listing([martin], { remindHousehold }))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    const message = (within(panel).getByRole('textbox') as HTMLTextAreaElement).value

    const whatsapp = within(panel).getByRole('link', { name: text.reminderWhatsapp })
    const sms = within(panel).getByRole('link', { name: text.reminderSms })
    const email = within(panel).getByRole('link', { name: text.reminderEmail })

    expect(whatsapp).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(message)}`)
    expect(whatsapp).toHaveAttribute('rel', 'noopener noreferrer')
    expect(sms).toHaveAttribute('href', `sms:?&body=${encodeURIComponent(message)}`)
    expect(email.getAttribute('href')).toMatch(/^mailto:\?subject=.+&body=/)
    // Not followed in the test: the click is what notes "relancé".
    sms.addEventListener('click', (event) => event.preventDefault())
    await user.click(sms)
    await waitFor(() => expect(remindHousehold).toHaveBeenCalledWith('camille-et-sacha', 'h-1'))
  })

  it('sends what the host edited, and keeps the edit when moving on and back', async () => {
    const user = userEvent.setup()
    render(listing([martin, durand]))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    const box = within(panel).getByRole('textbox')

    await user.clear(box)
    await user.type(box, 'Mon mot')
    expect(within(panel).getByRole('link', { name: text.reminderWhatsapp })).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent('Mon mot')}`,
    )
    await user.click(within(panel).getByRole('button', { name: text.reminderNext }))
    expect(within(panel).getByText('Les Durand')).toBeInTheDocument()
    expect(within(panel).getByText(text.reminderProgress(2, 2))).toBeInTheDocument()
    expect((within(panel).getByRole('textbox') as HTMLTextAreaElement).value).toContain(
      'Les Durand',
    )

    await user.click(within(panel).getByRole('button', { name: text.reminderPrevious }))
    expect(within(panel).getByRole('textbox')).toHaveValue('Mon mot')
    expect(within(panel).getByRole('button', { name: text.reminderPrevious })).toBeDisabled()
  })

  it('copies the message and notes the reminder', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const remindHousehold = vi.fn(async () => ({ household: martin }))
    render(listing([martin], { remindHousehold }))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })

    await user.click(within(panel).getByRole('button', { name: text.reminderCopy }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(text.reminderCopied)).toBeInTheDocument()
    expect(remindHousehold).toHaveBeenCalled()
  })

  it('says when the note "relancé" could not be saved, and the host still has the message', async () => {
    const remindHousehold = vi.fn(async () => {
      throw new ApiError(403, 'client.suspended')
    })
    const user = userEvent.setup()
    render(listing([martin], { remindHousehold }))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    const sms = within(panel).getByRole('link', { name: text.reminderSms })
    sms.addEventListener('click', (event) => event.preventDefault())

    await user.click(sms)

    expect(await screen.findByText(plain(text.reminderNoteFailed))).toBeInTheDocument()
  })

  it('starts from the first household when the host asks to remind them all', async () => {
    const user = userEvent.setup()
    render(listing([martin, durand]))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    await user.click(within(panel).getByRole('button', { name: text.reminderNext }))

    await user.click(screen.getByRole('button', { name: text.remindAll(2) }))

    expect(within(panel).getByText(text.reminderProgress(1, 2))).toBeInTheDocument()
  })

  it('says everybody answered, and offers no message, when nobody is left', async () => {
    render(listing([elodie]))

    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    expect(within(panel).getByText(text.reminderAllDone)).toBeInTheDocument()
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Relancer les/ })).not.toBeInTheDocument()
  })

  it('has nothing to send while the invitation has no address', async () => {
    render(
      listing([martin], {
        guestInvite: vi.fn(async () => ({ guestInvite: aGuestInviteHost({ url: null }) })),
      }),
    )

    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    expect(within(panel).getByText(plain(text.reminderNoLink))).toBeInTheDocument()
    expect(
      within(panel).queryByRole('link', { name: text.reminderWhatsapp }),
    ).not.toBeInTheDocument()
  })

  it('writes no recipient anywhere: EventSlide knows no number and no address', async () => {
    render(listing([martin]))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })

    expect(plain(text.reminderNote)).toContain('EventSlide ne connaît ni numéro ni adresse')
    for (const name of [text.reminderWhatsapp, text.reminderSms, text.reminderEmail]) {
      const href = within(panel).getByRole('link', { name }).getAttribute('href') ?? ''
      expect(href).not.toMatch(/wa\.me\/\d|sms:\+?\d|mailto:[^?]/)
    }
  })
})

describe('the guest list: what review of #547 asked', () => {
  const sequence = (...answers: readonly (readonly HouseholdDto[])[]) => {
    let next = 0
    return vi.fn(async () => ({
      households: answers[Math.min(next++, answers.length - 1)] as readonly HouseholdDto[],
    }))
  }
  const refresh = async (households: ReturnType<typeof sequence>) => {
    const reads = households.mock.calls.length
    act(() => FakeEventSource.latest('the page').emitSignal('rsvp.changed'))
    await waitFor(() => expect(households.mock.calls.length).toBeGreaterThan(reads))
  }

  it('says the refusal of a deletion in front of the host, the confirmation shut', async () => {
    const deleteHousehold = vi.fn(async () => {
      throw new ApiError(403, 'client.suspended')
    })
    const user = userEvent.setup()
    render(listing([martin], { deleteHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.remove} · Famille Martin` }))
    await user.click(screen.getByRole('button', { name: text.deleteYes }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(text.deleteBody)).not.toBeInTheDocument()
  })

  it('says the refusal of a new link in front of the host too', async () => {
    const rotateHousehold = vi.fn(async () => {
      throw new ApiError(403, 'client.suspended')
    })
    const user = userEvent.setup()
    render(listing([martin], { rotateHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.rotate} · Famille Martin` }))
    await user.click(screen.getByRole('button', { name: text.rotateYes }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(text.rotateBody)).not.toBeInTheDocument()
  })

  it('takes a household that is gone for a link changed: the dialog closes and the list is read again', async () => {
    const rotateHousehold = vi.fn(async () => {
      throw new ApiError(404, 'household.notFound')
    })
    const households = sequence([martin], [])
    const user = userEvent.setup()
    render(listing([], { households, rotateHousehold }))

    await user.click(await screen.findByRole('button', { name: `${text.rotate} · Famille Martin` }))
    await user.click(screen.getByRole('button', { name: text.rotateYes }))

    await waitFor(() => expect(screen.queryByText(text.rotateBody)).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByText(text.emptyTitle)).toBeInTheDocument()
  })

  it('gives a household whose link was changed a fresh message, never the edit that holds the revoked link', async () => {
    const changed = { ...martin, token: 'ZZZZZZZZZZZZZZZZ' }
    const households = sequence([martin], [changed])
    const user = userEvent.setup()
    render(listing([], { households }))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    const box = within(panel).getByRole('textbox')
    await user.clear(box)
    await user.type(box, `Mon mot ${INVITE}#f=AAAAAAAAAAAAAAAA`)

    await refresh(households)

    await waitFor(() =>
      expect((within(panel).getByRole('textbox') as HTMLTextAreaElement).value).toContain(
        `${INVITE}#f=ZZZZZZZZZZZZZZZZ`,
      ),
    )
    expect((within(panel).getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('AAAA')
  })

  it('offers no reminder on an archived event and never notes one', async () => {
    const remindHousehold = vi.fn(async () => ({ household: martin }))
    render(
      listing([martin], {
        remindHousehold,
        getEvent: vi.fn(async () => anEventDto({ status: 'archived' })),
      }),
    )

    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    expect(within(panel).getByText(plain(text.reminderArchived))).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: text.reminderSms })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(remindHousehold).not.toHaveBeenCalled()
  })

  it('follows the household on screen when an earlier one answers, and the nearest one when it answers itself', async () => {
    const a = aHousehold({ id: 'h-a', name: 'Alpha', token: 'AAAAAAAAAAAAAAAA' })
    const b = aHousehold({ id: 'h-b', name: 'Bravo', token: 'BBBBBBBBBBBBBBBB' })
    const c = aHousehold({ id: 'h-c', name: 'Charlie', token: 'CCCCCCCCCCCCCCCC' })
    const answered = (household: HouseholdDto): HouseholdDto => ({
      ...household,
      reply: { id: `r-${household.id}`, answer: 'yes', people: 1 },
    })
    const households = sequence([a, b, c], [answered(a), b, c], [answered(a), answered(b), c])
    const user = userEvent.setup()
    render(listing([], { households }))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    await user.click(within(panel).getByRole('button', { name: text.reminderNext }))
    expect(within(panel).getByText('Bravo', { exact: true })).toBeInTheDocument()

    await refresh(households)
    // Alpha answered: Bravo is still the one on screen, now first of two.
    await waitFor(() =>
      expect(within(panel).getByText(text.reminderProgress(1, 2))).toBeInTheDocument(),
    )
    expect(within(panel).getByText('Bravo', { exact: true })).toBeInTheDocument()

    await refresh(households)
    // Bravo answered itself: the panel stays where it was and shows Charlie.
    await waitFor(() =>
      expect(within(panel).getByText('Charlie', { exact: true })).toBeInTheDocument(),
    )
    expect(within(panel).getByText(text.reminderProgress(1, 1))).toBeInTheDocument()
  })

  it('notes "relancé" for a copy that worked and for no other', async () => {
    const user = userEvent.setup()
    const remindHousehold = vi.fn(async () => ({ household: martin }))
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValue(undefined)
    render(listing([martin], { remindHousehold }))
    const panel = await screen.findByRole('region', { name: text.reminderTitle })

    await user.click(within(panel).getByRole('button', { name: text.reminderCopy }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    await screen.findByText(new RegExp(text.copyFailed('').slice(0, 20)))
    expect(remindHousehold).not.toHaveBeenCalled()

    await user.click(within(panel).getByRole('button', { name: text.reminderCopy }))
    await waitFor(() => expect(remindHousehold).toHaveBeenCalledTimes(1))
  })

  it('says that the note is made as soon as a channel is clicked', async () => {
    render(listing([martin]))

    const panel = await screen.findByRole('region', { name: text.reminderTitle })
    expect(within(panel).getByText(new RegExp(plain(text.reminderNoteMarked)))).toBeInTheDocument()
  })

  it('tells reading the invitation, failing to read it and having none apart', async () => {
    const never = vi.fn(() => new Promise<never>(() => undefined))
    const view = render(listing([martin], { guestInvite: never }))
    expect(
      await within(await screen.findByRole('region', { name: text.reminderTitle })).findByText(
        text.reminderLoading,
      ),
    ).toBeInTheDocument()
    view.unmount()

    const retry = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue({ guestInvite: aGuestInviteHost({ url: INVITE }) })
    const user = userEvent.setup()
    render(listing([martin], { guestInvite: retry }))
    const failed = await screen.findByRole('region', { name: text.reminderTitle })
    expect(await within(failed).findByText(text.reminderInviteFailed)).toBeInTheDocument()
    expect(within(failed).queryByText(plain(text.reminderNoLink))).not.toBeInTheDocument()
    await user.click(within(failed).getByRole('button', { name: text.retry }))
    expect(await within(failed).findByRole('link', { name: text.reminderSms })).toBeInTheDocument()
  })

  it('names each filter with its count, apart', async () => {
    render(listing([martin, elodie, durand]))

    expect(
      await screen.findByRole('button', { name: `${text.filterPending}, 2` }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${text.filterAll}, 3` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${text.filterAnswered}, 1` })).toBeInTheDocument()
  })

  it('leads from a household with a reply to that reply on the replies page', async () => {
    render(listing([elodie]))

    const row = within(await screen.findByRole('table')).getByRole('row', { name: /Élodie Roux/ })
    expect(within(row).getByRole('link', { name: text.viewReply })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha/rsvps?reply=r-2',
    )
  })
})

describe('the guest list, coming from the reminder e-mail (spec 32, R3)', () => {
  it('opens on the households with no reply when the link says filter=unanswered, and on all of them otherwise', async () => {
    const api = listing([martin, elodie, durand])
    renderWithProviders(<HouseholdsPage />, {
      api,
      route: '/admin/events/camille-et-sacha/rsvps/guests?filter=unanswered',
      path: '/admin/events/:slug/rsvps/guests',
    })

    const pending = await screen.findByRole('button', {
      name: new RegExp(`^${text.filterPending}`),
    })
    expect(pending).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores a filter it does not know', async () => {
    const api = listing([martin, elodie, durand])
    renderWithProviders(<HouseholdsPage />, {
      api,
      route: '/admin/events/camille-et-sacha/rsvps/guests?filter=whatever',
      path: '/admin/events/:slug/rsvps/guests',
    })

    const all = await screen.findByRole('button', { name: new RegExp(`^${text.filterAll}`) })
    expect(all).toHaveAttribute('aria-pressed', 'true')
  })
})
