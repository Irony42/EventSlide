import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { fr } from '../lib/i18n/fr'
import { anAnnouncement, fakeApi, renderWithProviders } from '../testing/renderWithProviders'
import { AnnouncementControls } from './AnnouncementControls'
import type { Api } from '../lib/api/client'
import type { AnnouncementDto } from '../lib/api/dto'

const SLUG = 'camille-et-sacha'
const copy = fr.announcement

/** 21:00 on the 20th, in the browser's own zone: what the host's clock says. */
const NOW = new Date(2026, 5, 20, 21, 0, 0)
const local = (hours: number, minutes = 0): number =>
  new Date(2026, 5, 20, hours, minutes, 0).getTime()

/** An announcement `fromNowSeconds` away on the server's clock, which is this machine's here. */
const planned = (
  fromNowSeconds: number,
  overrides: Partial<AnnouncementDto> = {},
): AnnouncementDto =>
  anAnnouncement({
    at: new Date(NOW.getTime() + fromNowSeconds * 1000).toISOString(),
    ...overrides,
  })

const apiWith = (announcements: readonly AnnouncementDto[] = [], overrides: Partial<Api> = {}) =>
  fakeApi({
    listAnnouncements: vi.fn(async () => ({ announcements, serverNowMs: Date.now() })),
    ...overrides,
  })

const render = (api: Api, props: { live?: boolean; opensAt?: string | null } = {}) => {
  const onFailure = vi.fn()
  const view = renderWithProviders(
    <AnnouncementControls
      slug={SLUG}
      live={props.live ?? true}
      opensAt={props.opensAt ?? null}
      onFailure={onFailure}
    />,
    { api },
  )
  return { ...view, onFailure }
}

const textBox = () => screen.findByLabelText(copy.text)
const timeBox = () => screen.getByLabelText(new RegExp(`^${copy.time}`, 'u'))
const typeText = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const box = await textBox()
  await user.clear(box)
  await user.type(box, text)
}
const setTime = (value: string) => fireEvent.change(timeBox(), { target: { value } })
const radio = (name: string | RegExp) => screen.getByRole('radio', { name })
const button = (name: string) => screen.getByRole('button', { name })

describe('AnnouncementControls', () => {
  beforeEach(() => {
    // Only the clock: promises and `waitFor` keep running on real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the form', () => {
    it('cannot schedule without a text, even with a time', async () => {
      render(apiWith())
      await textBox()

      setTime('22:00')

      expect(button(copy.schedule)).toBeDisabled()
    })

    it('cannot schedule without a time, and cannot launch without a text', async () => {
      render(apiWith())
      const user = userEvent.setup()
      await typeText(user, 'Le gâteau arrive')

      expect(button(copy.schedule)).toBeDisabled()
      expect(button(copy.launchNow)).toBeEnabled()

      await user.clear(await textBox())
      expect(button(copy.launchNow)).toBeDisabled()
      await typeText(user, '   ')
      expect(button(copy.launchNow)).toBeDisabled()
    })

    it('schedules a full-screen card at the instant the typed time means', async () => {
      const createAnnouncement = vi.fn(apiWith().createAnnouncement)
      render(apiWith([], { createAnnouncement }))
      const user = userEvent.setup()

      await typeText(user, '  Le gâteau arrive ')
      setTime('22:00')
      await user.click(button(copy.schedule))

      expect(createAnnouncement).toHaveBeenCalledWith(SLUG, {
        text: 'Le gâteau arrive',
        kind: 'fullscreen',
        at: new Date(local(22)).toISOString(),
        durationSeconds: 30,
        countdownSeconds: 300,
      })
    })

    it('launches now with no moment and no countdown, whatever time is typed', async () => {
      const createAnnouncement = vi.fn(apiWith().createAnnouncement)
      render(apiWith([], { createAnnouncement }))
      const user = userEvent.setup()

      await typeText(user, 'Navettes à minuit')
      await user.click(button(copy.launchNow))

      expect(createAnnouncement).toHaveBeenCalledWith(SLUG, {
        text: 'Navettes à minuit',
        kind: 'fullscreen',
        durationSeconds: 30,
      })
    })

    it('clears the text and the time once it is written, and says nothing', async () => {
      const { onFailure } = render(apiWith())
      const user = userEvent.setup()

      await typeText(user, 'Le gâteau arrive')
      setTime('22:00')
      await user.click(button(copy.schedule))

      await waitFor(() => expect(screen.getByLabelText(copy.text)).toHaveValue(''))
      expect(timeBox()).toHaveValue('')
      expect(onFailure).toHaveBeenLastCalledWith(null)
    })

    it('counts the characters against the eighty the line may carry, and stops there', async () => {
      render(apiWith())
      const user = userEvent.setup()

      await typeText(user, 'a'.repeat(95))

      expect(await textBox()).toHaveValue('a'.repeat(80))
      expect(screen.getByText(copy.textCount(80, 80))).toBeInTheDocument()
    })

    it('says the refusal in the server’s own words, and keeps what was typed', async () => {
      const createAnnouncement = vi.fn(async () => {
        throw new ApiError(409, 'announcement.overlap')
      })
      const { onFailure } = render(apiWith([], { createAnnouncement }))
      const user = userEvent.setup()

      await typeText(user, 'Le gâteau arrive')
      setTime('22:00')
      await user.click(button(copy.schedule))

      await waitFor(() =>
        expect(onFailure).toHaveBeenLastCalledWith(fr.errors['announcement.overlap']),
      )
      expect(await textBox()).toHaveValue('Le gâteau arrive')
    })

    it('says an event that is not open yet, without stopping a draft from being prepared', async () => {
      render(apiWith(), { live: false })
      const user = userEvent.setup()

      expect(await screen.findByText(copy.notLive)).toBeInTheDocument()
      await typeText(user, 'Le gâteau arrive')
      expect(button(copy.launchNow)).toBeEnabled()
    })
  })

  describe('the moment the time means', () => {
    it('says today, with how far away it is, politely', async () => {
      render(apiWith())
      await textBox()

      setTime('22:12')

      const line = screen.getByText(copy.resolvedToday('22:12', copy.lead(72)))
      expect(line.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
      expect(copy.lead(72)).toBe('1 h 12')
    })

    it('says tomorrow past midnight', async () => {
      render(apiWith())
      await textBox()

      setTime('00:30')

      expect(screen.getByText(copy.resolvedTomorrow('00:30', copy.lead(210)))).toBeInTheDocument()
    })

    it('reads the night after a scheduled opening, not the morning before it', async () => {
      const opensAt = new Date(2026, 5, 25, 18, 0).toISOString()
      render(apiWith(), { opensAt })
      await textBox()

      setTime('00:30')

      const lead = copy.lead(
        Math.round((new Date(2026, 5, 26, 0, 30).getTime() - NOW.getTime()) / 60_000),
      )
      const day = new Date(2026, 5, 26).toLocaleDateString('fr', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
      expect(screen.getByText(copy.resolvedOn(day, '00:30', lead))).toBeInTheDocument()
    })

    it('warns in words beyond twelve hours, and says nothing of it before', async () => {
      render(apiWith())
      await textBox()

      setTime('09:00')
      expect(screen.queryByText(copy.far)).not.toBeInTheDocument()

      setTime('09:30')
      expect(screen.getByText(copy.far)).toBeInTheDocument()
    })

    it('says nothing when the time is cleared', async () => {
      render(apiWith())
      await textBox()
      setTime('22:00')

      setTime('')

      expect(screen.queryByText(/, dans /u)).not.toBeInTheDocument()
    })
  })

  describe('the two kinds', () => {
    it('is a labelled pair of radios, a full-screen card first', async () => {
      render(apiWith())
      await textBox()

      const group = screen.getByRole('group', { name: copy.kind })
      expect(group.tagName).toBe('FIELDSET')
      expect(within(group).getAllByRole('radio')).toHaveLength(2)
      expect(radio(new RegExp(copy.kindFullscreen, 'u'))).toBeChecked()
      expect(radio(new RegExp(copy.kindDiscreet, 'u'))).not.toBeChecked()
      expect(screen.getByText(copy.kindFullscreenHelp)).toBeInTheDocument()
      expect(screen.getByText(copy.kindDiscreetHelp)).toBeInTheDocument()
    })

    it('offers a card a countdown and 15, 30 or 60 seconds', async () => {
      render(apiWith())
      await textBox()

      const countdown = screen.getByRole('group', { name: copy.countdown })
      expect(
        within(countdown)
          .getAllByRole('radio')
          .map((chip) => chip.closest('label')?.textContent),
      ).toEqual([copy.countdownNone, '1 min', '5 min', '10 min', '15 min'])
      expect(within(countdown).getByRole('radio', { name: '5 min' })).toBeChecked()
      const duration = screen.getByRole('group', { name: copy.duration })
      expect(
        within(duration)
          .getAllByRole('radio')
          .map((chip) => chip.closest('label')?.textContent),
      ).toEqual(['15 s', '30 s', '1 min'])
      expect(within(duration).getByRole('radio', { name: '30 s' })).toBeChecked()
    })

    it('offers a discreet text 5, 10, 15 or 30 minutes and no countdown field at all', async () => {
      render(apiWith())
      const user = userEvent.setup()
      await textBox()

      await user.click(radio(new RegExp(copy.kindDiscreet, 'u')))

      expect(screen.queryByRole('group', { name: copy.countdown })).not.toBeInTheDocument()
      const duration = screen.getByRole('group', { name: copy.duration })
      expect(
        within(duration)
          .getAllByRole('radio')
          .map((chip) => chip.closest('label')?.textContent),
      ).toEqual(['5 min', '10 min', '15 min', '30 min'])
      expect(within(duration).getByRole('radio', { name: '15 min' })).toBeChecked()
    })

    it('puts the new kind’s default duration back when the kind changes', async () => {
      render(apiWith())
      const user = userEvent.setup()
      await textBox()
      // The duration group's "1 min", not the countdown's.
      const duration = screen.getByRole('group', { name: copy.duration })
      await user.click(within(duration).getByRole('radio', { name: '1 min' }))
      expect(within(duration).getByRole('radio', { name: '1 min' })).toBeChecked()

      await user.click(radio(new RegExp(copy.kindDiscreet, 'u')))
      const discreetDuration = screen.getByRole('group', { name: copy.duration })
      expect(within(discreetDuration).getByRole('radio', { name: '15 min' })).toBeChecked()

      await user.click(within(discreetDuration).getByRole('radio', { name: '30 min' }))
      await user.click(radio(new RegExp(copy.kindFullscreen, 'u')))
      expect(
        within(screen.getByRole('group', { name: copy.duration })).getByRole('radio', {
          name: '30 s',
        }),
      ).toBeChecked()
    })

    it('schedules a discreet text for fifteen minutes with no countdown in the request', async () => {
      const createAnnouncement = vi.fn(apiWith().createAnnouncement)
      render(apiWith([], { createAnnouncement }))
      const user = userEvent.setup()

      await user.click(radio(new RegExp(copy.kindDiscreet, 'u')))
      await typeText(user, 'Le buffet est ouvert')
      setTime('21:30')
      await user.click(button(copy.schedule))

      expect(createAnnouncement).toHaveBeenCalledTimes(1)
      const [, sent] = createAnnouncement.mock.calls[0] ?? []
      expect(sent).toEqual({
        text: 'Le buffet est ouvert',
        kind: 'discreet',
        at: new Date(local(21, 30)).toISOString(),
        durationSeconds: 900,
      })
    })

    it('takes an idea of the kind in view into the box, one chip each, to be corrected', async () => {
      render(apiWith())
      const user = userEvent.setup()
      await textBox()

      const cards = within(screen.getByRole('group', { name: copy.ideasTitle }))
      expect(cards.getAllByRole('button').map((chip) => chip.textContent)).toEqual(copy.ideas)
      await user.click(cards.getByRole('button', { name: copy.ideas[0] ?? '' }))
      expect(await textBox()).toHaveValue(copy.ideas[0])

      await user.click(radio(new RegExp(copy.kindDiscreet, 'u')))
      const quiet = within(screen.getByRole('group', { name: copy.ideasTitle }))
      expect(quiet.getAllByRole('button').map((chip) => chip.textContent)).toEqual(
        copy.ideasDiscreet,
      )
    })
  })

  describe('the list', () => {
    it('shows each state in words and offers what that state allows', async () => {
      render(
        apiWith([
          planned(7200, { id: 'a', text: 'Discours', state: 'upcoming' }),
          planned(120, { id: 'b', text: 'Gâteau', state: 'upcoming', countdownSeconds: 300 }),
          planned(-10, { id: 'c', text: 'Toast', state: 'upcoming' }),
          planned(-3600, { id: 'd', text: 'Photo de groupe', state: 'upcoming' }),
          planned(-10, {
            id: 'e',
            text: 'Buffet',
            kind: 'discreet',
            durationSeconds: 900,
            countdownSeconds: 0,
          }),
        ]),
      )

      const row = async (text: string) => within(await screen.findByRole('group', { name: text }))
      const names = (rows: { getAllByRole: (role: 'button') => HTMLElement[] }) =>
        rows.getAllByRole('button').map((control) => control.textContent)

      // The state is derived from the clock, never read from a stale word: all five arrive as "upcoming".
      const later = await row('Discours')
      expect(later.getByText(copy.states.upcoming)).toBeInTheDocument()
      expect(names(later)).toEqual([copy.edit, copy.launchNow, copy.remove])

      const counting = await row('Gâteau')
      expect(counting.getByText(copy.states.counting)).toBeInTheDocument()
      expect(names(counting)).toEqual([copy.edit, copy.launchNow, copy.remove])

      const card = await row('Toast')
      expect(card.getByText(copy.states.showing)).toBeInTheDocument()
      expect(names(card)).toEqual([copy.withdraw])

      const over = await row('Photo de groupe')
      expect(over.getByText(copy.states.over)).toBeInTheDocument()
      expect(names(over)).toEqual([copy.relaunch, copy.remove])

      const quiet = await row('Buffet')
      expect(quiet.getByText(copy.states.showing)).toBeInTheDocument()
      expect(names(quiet)).toEqual([copy.edit, copy.withdraw])
    })

    it('lists them by time, and says the kind in words', async () => {
      render(
        apiWith([
          planned(7200, { id: 'a', text: 'Plus tard' }),
          planned(600, {
            id: 'b',
            text: 'Bientôt',
            kind: 'discreet',
            durationSeconds: 900,
            countdownSeconds: 0,
          }),
        ]),
      )

      const list = await screen.findByRole('list', { name: copy.listLabel })
      const rows = within(list).getAllByRole('listitem')

      expect(rows[0]).toHaveTextContent('Bientôt')
      expect(rows[0]).toHaveTextContent(copy.kindDiscreet)
      expect(rows[1]).toHaveTextContent('Plus tard')
      expect(rows[1]).toHaveTextContent(copy.kindFullscreen)
    })

    it('moves a row on when its moment comes, with nothing to click', async () => {
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
      render(apiWith([planned(10, { id: 'a', text: 'Gâteau', countdownSeconds: 0 })]))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(
        within(screen.getByRole('group', { name: 'Gâteau' })).getByText(copy.states.upcoming),
      ).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000)
      })

      expect(
        within(screen.getByRole('group', { name: 'Gâteau' })).getByText(copy.states.showing),
      ).toBeInTheDocument()
    })

    it('reads a row launched since the last tick as on screen, not as still to come', async () => {
      // The clock ticks every fifteen seconds at most: a list that arrives ten seconds after the
      // last reading holds a row whose moment is *now*, and must be derived from now.
      const later = planned(7200, { id: 'a', text: 'Discours' })
      const launched = planned(10, {
        id: 'b',
        text: 'Buffet',
        kind: 'discreet',
        durationSeconds: 900,
        countdownSeconds: 0,
      })
      let reads = 0
      const listAnnouncements = vi.fn(async () => {
        reads += 1
        return { announcements: reads === 1 ? [later] : [later, launched], serverNowMs: Date.now() }
      })
      render(apiWith([], { listAnnouncements }))
      const user = userEvent.setup()
      const speech = within(await screen.findByRole('group', { name: 'Discours' }))

      vi.setSystemTime(new Date(NOW.getTime() + 10_000))
      await user.click(speech.getByRole('button', { name: copy.launchNow }))

      const buffet = within(await screen.findByRole('group', { name: 'Buffet' }))
      await waitFor(() => expect(buffet.getByText(copy.states.showing)).toBeInTheDocument())
    })

    it('launches a row again, and deletes one, by its own id', async () => {
      const launchAnnouncement = vi.fn(apiWith().launchAnnouncement)
      const deleteAnnouncement = vi.fn(apiWith().deleteAnnouncement)
      render(
        apiWith(
          [
            planned(7200, { id: 'a', text: 'Discours' }),
            planned(-3600, { id: 'b', text: 'Toast' }),
          ],
          {
            launchAnnouncement,
            deleteAnnouncement,
          },
        ),
      )
      const user = userEvent.setup()

      const speech = within(await screen.findByRole('group', { name: 'Discours' }))
      await user.click(speech.getByRole('button', { name: copy.launchNow }))
      expect(launchAnnouncement).toHaveBeenCalledWith(SLUG, 'a')

      const toast = within(screen.getByRole('group', { name: 'Toast' }))
      await user.click(toast.getByRole('button', { name: copy.relaunch }))
      expect(launchAnnouncement).toHaveBeenCalledWith(SLUG, 'b')

      await user.click(toast.getByRole('button', { name: copy.remove }))
      expect(deleteAnnouncement).toHaveBeenCalledWith(SLUG, 'b')
    })

    it('reads the list again after a write', async () => {
      const listAnnouncements = vi.fn(async () => ({
        announcements: [planned(7200, { id: 'a', text: 'Discours' })],
        serverNowMs: Date.now(),
      }))
      render(apiWith([], { listAnnouncements }))
      const user = userEvent.setup()
      const speech = within(await screen.findByRole('group', { name: 'Discours' }))
      const before = listAnnouncements.mock.calls.length

      await user.click(speech.getByRole('button', { name: copy.remove }))

      await waitFor(() => expect(listAnnouncements.mock.calls.length).toBeGreaterThan(before))
    })

    it('says when there is nothing planned, and when the list could not be read', async () => {
      const failing = vi.fn(async () => {
        throw new ApiError(500, 'server.error')
      })
      const { unmount } = render(apiWith())
      expect(await screen.findByText(copy.empty)).toBeInTheDocument()
      unmount()

      render(apiWith([], { listAnnouncements: failing }))
      expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument()
    })
  })

  describe('correcting one', () => {
    it('takes the row into the form and saves every field, keeping the instant when the time is not touched', async () => {
      const updateAnnouncement = vi.fn(apiWith().updateAnnouncement)
      render(apiWith([planned(7200, { id: 'a', text: 'Discours' })], { updateAnnouncement }))
      const user = userEvent.setup()

      await user.click(
        within(await screen.findByRole('group', { name: 'Discours' })).getByRole('button', {
          name: copy.edit,
        }),
      )
      expect(await textBox()).toHaveValue('Discours')
      expect(timeBox()).toHaveValue('23:00')
      await user.clear(await textBox())
      await user.type(await textBox(), 'Le grand discours')
      await user.click(button(copy.save))

      expect(updateAnnouncement).toHaveBeenCalledWith(SLUG, 'a', {
        text: 'Le grand discours',
        kind: 'fullscreen',
        durationSeconds: 30,
        countdownSeconds: 300,
      })
    })

    it('sends the new moment when the time was changed', async () => {
      const updateAnnouncement = vi.fn(apiWith().updateAnnouncement)
      render(apiWith([planned(7200, { id: 'a', text: 'Discours' })], { updateAnnouncement }))
      const user = userEvent.setup()
      await user.click(
        within(await screen.findByRole('group', { name: 'Discours' })).getByRole('button', {
          name: copy.edit,
        }),
      )

      setTime('23:30')
      await user.click(button(copy.save))

      expect(updateAnnouncement).toHaveBeenCalledWith(
        SLUG,
        'a',
        expect.objectContaining({ at: new Date(local(23, 30)).toISOString() }),
      )
    })

    it('leaves a discreet text on screen only its words to change, and sends only those', async () => {
      const updateAnnouncement = vi.fn(apiWith().updateAnnouncement)
      render(
        apiWith(
          [
            planned(-60, {
              id: 'q',
              text: 'Le buffet est ouver',
              kind: 'discreet',
              durationSeconds: 900,
              countdownSeconds: 0,
            }),
          ],
          { updateAnnouncement },
        ),
      )
      const user = userEvent.setup()

      await user.click(
        within(await screen.findByRole('group', { name: 'Le buffet est ouver' })).getByRole(
          'button',
          {
            name: copy.edit,
          },
        ),
      )

      expect(screen.getByText(copy.textOnly)).toBeInTheDocument()
      expect(await textBox()).toBeEnabled()
      expect(timeBox()).toBeDisabled()
      expect(screen.getByRole('group', { name: copy.kind })).toBeDisabled()
      expect(screen.getByRole('group', { name: copy.duration })).toBeDisabled()

      await user.clear(await textBox())
      await user.type(await textBox(), 'Le buffet est ouvert')
      await user.click(button(copy.save))

      expect(updateAnnouncement).toHaveBeenCalledWith(SLUG, 'q', { text: 'Le buffet est ouvert' })
    })

    it('puts the form back to blank when the correction is cancelled', async () => {
      render(apiWith([planned(7200, { id: 'a', text: 'Discours' })]))
      const user = userEvent.setup()
      await user.click(
        within(await screen.findByRole('group', { name: 'Discours' })).getByRole('button', {
          name: copy.edit,
        }),
      )

      await user.click(button(copy.cancel))

      expect(await textBox()).toHaveValue('')
      expect(button(copy.schedule)).toBeDisabled()
    })

    it('sends nothing when the grace minute ran out since the line was drawn, and redraws the line', async () => {
      // 22:00 typed at 22:00:50 reads "today" (inside the 60 s grace); pressed at 22:01:10 it
      // would be 70 s late: the server would refuse, so the host is shown "tomorrow" instead.
      vi.setSystemTime(new Date(2026, 5, 20, 22, 0, 50))
      const createAnnouncement = vi.fn(apiWith().createAnnouncement)
      render(apiWith([], { createAnnouncement }))
      const user = userEvent.setup()
      await typeText(user, 'Le gâteau')
      setTime('22:00')
      expect(screen.getByText(copy.resolvedToday('22:00', copy.lead(0)))).toBeInTheDocument()

      vi.setSystemTime(new Date(2026, 5, 20, 22, 1, 10))
      await user.click(button(copy.schedule))

      expect(createAnnouncement).not.toHaveBeenCalled()
      expect(screen.getByText(/^Demain/u)).toBeInTheDocument()

      await user.click(button(copy.schedule))
      const [, sent] = createAnnouncement.mock.calls[0] ?? []
      expect(sent).toEqual(
        expect.objectContaining({ at: new Date(2026, 5, 21, 22, 0, 0).toISOString() }),
      )
    })

    it('cannot save a correction whose time was emptied', async () => {
      const updateAnnouncement = vi.fn(apiWith().updateAnnouncement)
      render(apiWith([planned(7200, { id: 'a', text: 'Discours' })], { updateAnnouncement }))
      const user = userEvent.setup()
      await user.click(
        within(await screen.findByRole('group', { name: 'Discours' })).getByRole('button', {
          name: copy.edit,
        }),
      )

      setTime('')

      expect(button(copy.save)).toBeDisabled()
      await user.click(button(copy.save))
      expect(updateAnnouncement).not.toHaveBeenCalled()
    })

    it('closes the correction of a card that went up while the form was open', async () => {
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
      render(apiWith([planned(30, { id: 'a', text: 'Gâteau', countdownSeconds: 10 })]))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Gâteau' })).getByRole('button', {
          name: copy.edit,
        }),
      )
      expect(screen.getByText(copy.editing)).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })

      expect(screen.queryByText(copy.editing)).not.toBeInTheDocument()
      expect(screen.getByLabelText(copy.text)).toHaveValue('')
    })

    it('narrows the correction of a discreet text to its words when it goes up meanwhile', async () => {
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
      const updateAnnouncement = vi.fn(apiWith().updateAnnouncement)
      render(
        apiWith(
          [
            planned(30, {
              id: 'q',
              text: 'Buffet',
              kind: 'discreet',
              durationSeconds: 900,
              countdownSeconds: 0,
            }),
          ],
          { updateAnnouncement },
        ),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Buffet' })).getByRole('button', {
          name: copy.edit,
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })
      expect(screen.getByText(copy.textOnly)).toBeInTheDocument()

      fireEvent.click(button(copy.save))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(updateAnnouncement).toHaveBeenCalledWith(SLUG, 'q', { text: 'Buffet' })
    })
  })
})
