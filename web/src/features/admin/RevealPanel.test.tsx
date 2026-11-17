import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { formatTime } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import { anEventDto, fakeApi } from '../../testing/renderWithProviders'
import { HOUR, MINUTE, NOW, SLUG, held, renderReveal } from './testing/revealHarness'

const renderPanel = renderReveal

describe('RevealPanel (spec 23)', () => {
  beforeEach(() => {
    // The clock and the interval only: promises and `waitFor` keep running on real timers.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('which evenings have a band', () => {
    it('draws nothing while the mode is off', () => {
      renderPanel(anEventDto())

      expect(screen.queryByRole('heading', { name: fr.reveal.title })).toBeNull()
    })

    it('draws nothing for a server that predates the mode', () => {
      const { reveal: _reveal, ...older } = held()

      renderPanel(older)

      expect(screen.queryByRole('heading', { name: fr.reveal.title })).toBeNull()
    })
  })

  describe('before the reveal', () => {
    it('counts down to the hour in hours and minutes', () => {
      renderPanel(held({ inMs: 2 * HOUR + 10 * MINUTE }))

      expect(screen.getByText(fr.reveal.countdown(2, 10))).toBeVisible()
      expect(screen.getByText(fr.reveal.countdown(2, 10))).toHaveTextContent(
        'Révélation dans 2 h 10',
      )
    })

    it('rounds a started minute up, so it never says zero with time left', () => {
      renderPanel(held({ inMs: 59 * MINUTE + 1_000 }))

      expect(screen.getByText(fr.reveal.countdown(1, 0))).toBeVisible()
    })

    it('says "less than a minute" for the last minute', () => {
      renderPanel(held({ inMs: 40_000 }))

      expect(screen.getByText(fr.reveal.soon)).toBeVisible()
    })

    it('counts against the server’s clock, not the laptop’s', () => {
      // The laptop is five minutes ahead: by its own clock the hour is two hours away, by the
      // server's it is two hours ten minutes away, and the server's is the one on screen.
      vi.setSystemTime(NOW + 5 * MINUTE)

      renderPanel(held({ inMs: 2 * HOUR + 10 * MINUTE }))

      expect(screen.getByText(fr.reveal.countdown(2, 10))).toBeVisible()
    })

    it('says the reveal is at the button when there is no hour', () => {
      renderPanel(held({ inMs: null }))

      expect(screen.getByText(fr.reveal.manual)).toBeVisible()
      expect(screen.queryByText(/Révélation prévue/)).toBeNull()
    })

    it('says when it is planned, in the host’s own date format', () => {
      renderPanel(held({ inMs: 2 * HOUR }))

      expect(screen.getByText(/Révélation prévue le /)).toBeVisible()
    })

    it('says how many published photographs wait for it', () => {
      renderPanel(held({ readyCount: 128 }))

      expect(screen.getByText(fr.reveal.waiting(128))).toBeVisible()
    })

    it('words one waiting photograph in the singular', () => {
      renderPanel(held({ readyCount: 1 }))

      expect(screen.getByText(fr.reveal.waiting(1))).toHaveTextContent('1 photo publiée attend')
    })

    it('is a plain region with no live announcement: a countdown that spoke would be noise', () => {
      renderPanel(held())

      const panel = screen.getByRole('heading', { name: fr.reveal.title }).closest('section')
      expect(panel).not.toBeNull()
      expect(panel?.querySelector('[aria-live]')).toBeNull()
      expect(panel?.querySelector('[role="status"]')).toBeNull()
      expect(panel?.querySelector('[role="timer"]')).toBeNull()
    })
  })

  describe('"Révéler maintenant"', () => {
    it('asks first, with what appears, what stays hidden and that it is final', async () => {
      vi.useRealTimers()
      renderPanel(held({ readyCount: 128, pendingCount: 14 }))

      await userEvent.click(screen.getByRole('button', { name: fr.reveal.revealNow }))

      const dialog = await screen.findByRole('dialog', { name: fr.reveal.confirmTitle })
      expect(dialog).toHaveTextContent(fr.reveal.confirmPublished(128))
      expect(dialog).toHaveTextContent(fr.reveal.confirmPending(14))
      expect(dialog).toHaveTextContent(fr.reveal.definitive)
    })

    it('says nothing about photographs awaiting a decision when there are none', async () => {
      vi.useRealTimers()
      renderPanel(held({ readyCount: 5, pendingCount: 0 }))

      await userEvent.click(screen.getByRole('button', { name: fr.reveal.revealNow }))

      const dialog = await screen.findByRole('dialog', { name: fr.reveal.confirmTitle })
      expect(dialog).not.toHaveTextContent('attend encore')
      expect(dialog).not.toHaveTextContent('attendent encore')
    })

    it('does not reveal until the host confirms', async () => {
      vi.useRealTimers()
      const { api } = renderPanel(held())

      await userEvent.click(screen.getByRole('button', { name: fr.reveal.revealNow }))
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: fr.app.cancel }),
      )

      expect(api.revealEvent).not.toHaveBeenCalled()
    })

    it('reveals the event once confirmed, and hands the page the answer', async () => {
      vi.useRealTimers()
      const answer = anEventDto({ pendingCount: 14 })
      const { api, onChanged } = renderPanel(held(), {
        api: fakeApi({ revealEvent: vi.fn(async () => answer) }),
      })

      await userEvent.click(screen.getByRole('button', { name: fr.reveal.revealNow }))
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: fr.reveal.revealNow,
        }),
      )

      await waitFor(() => expect(onChanged).toHaveBeenCalledWith(answer))
      expect(api.revealEvent).toHaveBeenCalledTimes(1)
      expect(api.revealEvent).toHaveBeenCalledWith(SLUG)
    })

    it('says the server’s refusal and changes nothing when it fails', async () => {
      vi.useRealTimers()
      const { onChanged } = renderPanel(held(), {
        api: fakeApi({
          revealEvent: vi.fn(() => Promise.reject(new ApiError(403, 'auth.forbidden'))),
        }),
      })

      await userEvent.click(screen.getByRole('button', { name: fr.reveal.revealNow }))
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: fr.reveal.revealNow,
        }),
      )

      expect(await screen.findByText(fr.errors['auth.forbidden'])).toBeVisible()
      expect(onChanged).not.toHaveBeenCalled()
    })
  })

  describe('the hour', () => {
    it('leads an owner to the settings page to move it', () => {
      renderPanel(held(), { settingsPath: '/admin/events/camille-et-sacha/settings' })

      expect(screen.getByRole('link', { name: fr.reveal.editTime })).toHaveAttribute(
        'href',
        '/admin/events/camille-et-sacha/settings',
      )
    })

    it('offers a moderator no link to a page that is not theirs', () => {
      renderPanel(held(), { settingsPath: null })

      expect(screen.queryByRole('link', { name: fr.reveal.editTime })).toBeNull()
      expect(screen.getByRole('button', { name: fr.reveal.revealNow })).toBeVisible()
    })

    it('flips to revealed at the hour, by the server’s clock, and reads the event again once', () => {
      const { onReload } = renderPanel(held({ inMs: 2 * MINUTE }))
      expect(screen.getByText(fr.reveal.countdown(0, 2))).toBeVisible()

      act(() => {
        vi.advanceTimersByTime(3 * MINUTE)
      })

      expect(screen.queryByRole('button', { name: fr.reveal.revealNow })).toBeNull()
      expect(onReload).toHaveBeenCalledTimes(1)
    })

    it('does not tick for an evening revealed with the button', () => {
      renderPanel(held({ inMs: null }))

      expect(vi.getTimerCount()).toBe(0)
    })

    it('clears its timer when the page goes away', () => {
      const { unmount } = renderPanel(held())
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      unmount()

      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('after the reveal', () => {
    it('says when it happened and offers no second reveal', () => {
      renderPanel(held({ inMs: -2 * MINUTE, revealed: true }))

      expect(
        screen.getByText(fr.reveal.revealedAt(formatTime(NOW - 2 * MINUTE, 'fr') ?? '')),
      ).toBeVisible()
      expect(screen.queryByRole('button', { name: fr.reveal.revealNow })).toBeNull()
      expect(screen.queryByRole('link', { name: fr.reveal.editTime })).toBeNull()
    })

    it('adds the day when it was not today', () => {
      renderPanel(held({ inMs: -2 * 24 * HOUR, revealed: true }))

      expect(screen.getByText(/^Révélé le /)).toBeVisible()
    })

    it('keeps no countdown and no waiting count', () => {
      renderPanel(held({ inMs: -MINUTE, revealed: true }))

      expect(screen.queryByText(/Révélation dans/)).toBeNull()
      expect(screen.queryByText(/attend/)).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('an evening that ends without its reveal (Pierre, 16/11)', () => {
    it('says so once it has ended: the photographs were not revealed and stay hidden', () => {
      renderPanel(held({ status: 'closed', inMs: null }))

      expect(screen.getByText(fr.reveal.closedNotRevealed)).toBeVisible()
    })

    it('says so for an archived evening too', () => {
      renderPanel(held({ status: 'archived', inMs: null }))

      expect(screen.getByText(fr.reveal.closedNotRevealed)).toBeVisible()
    })

    it('still offers the reveal on an ended evening: it is the host’s decision, not ours', () => {
      renderPanel(held({ status: 'closed', inMs: null }))

      expect(screen.getByRole('button', { name: fr.reveal.revealNow })).toBeVisible()
    })

    it('warns before the end when the scheduled end comes before the hour', () => {
      renderPanel(held({ inMs: 3 * HOUR, scheduledCloseAt: new Date(NOW + HOUR).toISOString() }))

      expect(screen.getByText(fr.reveal.closesBefore)).toBeVisible()
      expect(screen.queryByText(fr.reveal.closedNotRevealed)).toBeNull()
    })

    it('warns before the end when a scheduled end exists and there is no hour at all', () => {
      renderPanel(held({ inMs: null, scheduledCloseAt: new Date(NOW + HOUR).toISOString() }))

      expect(screen.getByText(fr.reveal.closesBefore)).toBeVisible()
    })

    it('does not warn when the reveal comes first', () => {
      renderPanel(held({ inMs: HOUR, scheduledCloseAt: new Date(NOW + 3 * HOUR).toISOString() }))

      expect(screen.queryByText(fr.reveal.closesBefore)).toBeNull()
    })

    it('does not warn when no end is scheduled', () => {
      renderPanel(held({ inMs: null, scheduledCloseAt: null }))

      expect(screen.queryByText(fr.reveal.closesBefore)).toBeNull()
      expect(screen.queryByText(fr.reveal.closedNotRevealed)).toBeNull()
    })
  })
})
