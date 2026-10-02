import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportCard } from './SupportCard'
import { fr } from '../../../lib/i18n/fr'
import { SUPPORTED_LOCALES } from '../../../lib/i18n/locale'
import { TRANSLATIONS } from '../../../lib/i18n/translations'
import { renderWithProviders } from '../../../testing/renderWithProviders'

/**
 * Ring 5. The card a host meets once, on the page of an event that has just closed (roadmap
 * G4-02). What these cases defend is the **absence of pressure**: it can be closed, it stays
 * closed for that event, it never blocks the page, and a browser that cannot keep a
 * preference does not break it.
 */

const DONATE_URL = 'https://opencollective.com/eventslide'
const BUDGET_URL = 'https://opencollective.com/eventslide/budget'

const closeButton = () => screen.getByRole('button', { name: fr.about.supportDismiss })

describe('SupportCard', () => {
  it('asks for support for the project, and says that a donation unlocks nothing', () => {
    renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

    expect(screen.getByText(fr.about.supportTitle)).toBeVisible()
    expect(screen.getByText(fr.about.supportIntro)).toBeVisible()
    // The promise, in the product itself: no tier, no badge, the same service for everyone.
    expect(screen.getByText(fr.about.supportNoCounterpart)).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(fr.about.supportLink) })).toHaveAttribute(
      'href',
      DONATE_URL,
    )
  })

  it('opens the donation page in a tab of its own, with rel="noopener noreferrer"', () => {
    renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

    const link = screen.getByRole('link', { name: new RegExp(fr.about.supportLink) })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it('offers the public budget only when there is one', () => {
    const { rerender } = renderWithProviders(
      <SupportCard eventId="event-1" donateUrl={DONATE_URL} />,
    )
    expect(screen.queryByRole('link', { name: new RegExp(fr.about.budgetLink) })).toBeNull()

    rerender(<SupportCard eventId="event-1" donateUrl={DONATE_URL} budgetUrl={BUDGET_URL} />)

    expect(screen.getByRole('link', { name: new RegExp(fr.about.budgetLink) })).toHaveAttribute(
      'href',
      BUDGET_URL,
    )
  })

  it('is not a dialog and moves no focus: it is a card in the page, not an interruption', () => {
    renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.querySelector('[aria-modal]')).toBeNull()
    expect(document.body).toHaveFocus()
  })

  it('carries no countdown, no amount to pick and nothing pre-ticked', () => {
    renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  describe('closing it', () => {
    it('removes it at once', async () => {
      renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

      await userEvent.click(closeButton())

      expect(screen.queryByText(fr.about.supportTitle)).toBeNull()
      expect(screen.queryByRole('link', { name: new RegExp(fr.about.supportLink) })).toBeNull()
    })

    it('is remembered for that event, so a later visit does not show it again', async () => {
      const first = renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)
      await userEvent.click(closeButton())
      first.unmount()

      renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

      expect(screen.queryByText(fr.about.supportTitle)).toBeNull()
    })

    it('is remembered for that event only: another event still gets its one mention', async () => {
      const first = renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)
      await userEvent.click(closeButton())
      first.unmount()

      renderWithProviders(<SupportCard eventId="event-2" donateUrl={DONATE_URL} />)

      expect(screen.getByText(fr.about.supportTitle)).toBeVisible()
    })

    it('stays closed when the same event is shown again after the card was closed on another screen', () => {
      localStorage.setItem('eventslide.support.dismissed.event-1', '1')

      renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

      expect(screen.queryByText(fr.about.supportTitle)).toBeNull()
    })

    it('does not treat any other stored value as having been closed', () => {
      // Only what this build writes counts: a hand-edited or older entry is "not closed",
      // which errs on the side of showing the card once rather than hiding it on a guess.
      localStorage.setItem('eventslide.support.dismissed.event-1', 'yes')

      renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

      expect(screen.getByText(fr.about.supportTitle)).toBeVisible()
    })
  })

  describe('in a browser whose storage throws', () => {
    // Safari in private browsing throws on write; a browser with site data blocked throws
    // on read. Neither may take the host's event page down with a donation card.
    const storageThrows = (method: 'getItem' | 'setItem') =>
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })

    it('still renders when reading the memory of it throws', () => {
      storageThrows('getItem')

      renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

      expect(screen.getByText(fr.about.supportTitle)).toBeVisible()
    })

    it('can still be closed for the rest of the page load when writing the memory of it throws', async () => {
      storageThrows('setItem')
      renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />)

      await userEvent.click(closeButton())

      expect(screen.queryByText(fr.about.supportTitle)).toBeNull()
    })
  })

  it.each(SUPPORTED_LOCALES)('is worded in %s, the reader’s own language', (locale) => {
    renderWithProviders(<SupportCard eventId="event-1" donateUrl={DONATE_URL} />, { locale })

    const text = TRANSLATIONS[locale].about

    expect(screen.getByText(text.supportTitle)).toBeVisible()
    expect(screen.getByText(text.supportNoCounterpart)).toBeVisible()
    expect(screen.getByRole('button', { name: text.supportDismiss })).toBeVisible()
  })
})
