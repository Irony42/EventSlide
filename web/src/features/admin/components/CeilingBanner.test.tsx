import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { CeilingBanner } from './CeilingBanner'
import styles from './CeilingBanner.module.css'
import { classesOf, cls } from '../../../testing/classesOf'
import { fr } from '../../../lib/i18n/fr'
import { aClientLimits, renderWithProviders } from '../../../testing/renderWithProviders'
import type { CeilingMeterDto, ClientLimitsDto } from '../../../lib/api/dto'

/**
 * The banner over a client's ceilings (G2-16 / P3-17): nothing under the line, the meter alone
 * at the warning line, and louder at the ceiling. The line itself (89, 90 and 100 per cent) is
 * the server's and is held at ring 1 (`ceilingUsage.test.ts`); what is held here is that the
 * banner shows exactly what the level it was told says, and nothing it was not.
 */

const meters = (...list: readonly CeilingMeterDto[]): Pick<ClientLimitsDto, 'meters'> => ({
  meters: list,
})
const events = (used: number, level: CeilingMeterDto['level']): CeilingMeterDto => ({
  kind: 'events',
  used,
  max: 10,
  level,
})
const storage = (level: CeilingMeterDto['level']): CeilingMeterDto => ({
  kind: 'storage',
  used: 4_500_000_000,
  max: 5_000_000_000,
  level,
})

const show = (limits: ClientLimitsDto, contact: { href: string } | null = null) =>
  renderWithProviders(<CeilingBanner limits={limits} contact={contact} />)

describe('CeilingBanner', () => {
  it('shows nothing for a client below every line, at 89 per cent included', () => {
    show(aClientLimits(meters(events(8, 'ok'), storage('ok'))))

    expect(screen.queryByRole('region', { name: fr.clientSpace.bannerLabel })).toBeNull()
  })

  it('shows nothing for a client with no ceiling at all', () => {
    show(aClientLimits(meters()))

    expect(screen.queryByRole('region', { name: fr.clientSpace.bannerLabel })).toBeNull()
  })

  it('warns, with the meter that is close and no other, from the warning line', () => {
    show(aClientLimits(meters(events(9, 'warning'), storage('ok'))))

    const banner = screen.getByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(banner).toHaveAttribute('data-level', 'warning')
    expect(banner).toHaveTextContent(fr.clientSpace.warningTitle)
    expect(banner).toHaveTextContent(fr.clientSpace.eventsMeter(9, 10))
    expect(banner).not.toHaveTextContent('Stockage')
  })

  it('says a limit is reached, louder than a warning, when any meter is', () => {
    show(aClientLimits(meters(events(10, 'reached'), storage('warning'))))

    const banner = screen.getByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(banner).toHaveAttribute('data-level', 'reached')
    expect(banner).toHaveTextContent(fr.clientSpace.reachedTitle)
    expect(banner).toHaveTextContent(fr.clientSpace.eventsMeter(10, 10))
    // The other meter is close too, and is told as well.
    expect(banner).toHaveTextContent('Stockage')
  })

  it.each(['warning', 'reached'] as const)(
    'wears the class of its %s level after its own',
    (level) => {
      show(aClientLimits(meters(events(level === 'reached' ? 10 : 9, level))))

      const banner = screen.getByRole('region', { name: fr.clientSpace.bannerLabel })
      expect(classesOf(banner)).toEqual([cls(styles, 'banner'), cls(styles, level)])
    },
  )

  it('says opening events is paused when the operator has switched it off, with no meter at all', () => {
    const base = aClientLimits()
    show({ ...base, ...meters(), ceilings: { ...base.ceilings, liveAllowed: false } })

    const banner = screen.getByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(banner).toHaveAttribute('data-level', 'reached')
    expect(banner).toHaveTextContent(fr.clientSpace.liveNotAllowed)
  })

  it('leads to the operator’s own address when the box published one', () => {
    show(aClientLimits(meters(events(9, 'warning'))), { href: 'mailto:ops@example.org' })

    expect(screen.getByRole('link', { name: fr.clientSpace.contactAction })).toHaveAttribute(
      'href',
      'mailto:ops@example.org',
    )
  })

  it('says "contact your operator" in words, and links nowhere, when it published none', () => {
    show(aClientLimits(meters(events(9, 'warning'))), null)

    expect(screen.getByText(fr.clientSpace.contactHint)).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
