import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StorageMeter } from './StorageMeter'
import { formatBytes } from '../../../lib/format'
import { de } from '../../../lib/i18n/de'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'

/** Testing Library folds every kind of space in rendered text down to a plain one. */
const spaced = (value: string) => value.replace(/\s/g, ' ')

describe('StorageMeter', () => {
  it('states the figure alone when the answer carried no quota', () => {
    // `GET /api/events` returns summaries without one, and a bar against an invented
    // ceiling is a number a host would make decisions on.
    render(<StorageMeter usedBytes={2_400_000} quotaBytes={null} />)

    expect(screen.getByText(spaced(fr.admin.storage(formatBytes(2_400_000, 'fr'))))).toBeVisible()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('draws the bar against a real quota, and says both figures in words', () => {
    render(<StorageMeter usedBytes={2_400_000} quotaBytes={5_000_000_000} />)

    const bar = screen.getByRole('progressbar', { name: fr.admin.storageLabel })
    expect(bar).toHaveAttribute('aria-valuenow', '2400000')
    expect(bar).toHaveAttribute('aria-valuemax', '5000000000')
    // Colour is never the only signal: the sentence carries the same fact.
    expect(
      screen.getByText(
        spaced(
          fr.admin.storageUsed(formatBytes(2_400_000, 'fr'), formatBytes(5_000_000_000, 'fr')),
        ),
      ),
    ).toBeVisible()
  })

  it('says the figure in the units the reader’s language uses', () => {
    // `Mo` and `Go` are the French abbreviations for octets. The sentence around them is
    // translated, so a console read in German said "2,4 Mo von 5 Go verwendet" until the
    // locale became a parameter of `formatBytes` — a figure in one language inside a
    // sentence in another, which reads as a rendering fault rather than as a unit.
    renderWithProviders(<StorageMeter usedBytes={2_400_000} quotaBytes={5_000_000_000} />, {
      locale: 'de',
    })

    expect(
      screen.getByText(
        spaced(
          de.admin.storageUsed(formatBytes(2_400_000, 'de'), formatBytes(5_000_000_000, 'de')),
        ),
      ),
    ).toBeVisible()
    expect(screen.getByText(/MB/)).toBeVisible()
    // The French abbreviation for an octet, which is what the pinned module used to print.
    expect(screen.queryByText(/Mo$/u)).toBeNull()
  })

  it('warns before the guests find out, at nine tenths of the quota', () => {
    render(<StorageMeter usedBytes={4_600_000_000} quotaBytes={5_000_000_000} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', fr.ui.percent(92))
  })

  it('reads as full rather than as over, once the quota is reached', () => {
    // The server has already stopped accepting uploads at this point; the bar must not
    // claim 110%.
    render(<StorageMeter usedBytes={6_000_000_000} quotaBytes={5_000_000_000} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', fr.ui.percent(100))
  })

  it('survives a quota of zero, which is a real answer for an unlimited event', () => {
    render(<StorageMeter usedBytes={0} quotaBytes={0} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
})
