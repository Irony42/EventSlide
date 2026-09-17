import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Progress } from './Progress'
import { fr } from '../../lib/i18n/fr'

/**
 * The percentage is asserted through the table, never as the literal "42 %".
 *
 * The space in front of the sign is French, and since roadmap 1.5 it comes from
 * `Intl.NumberFormat` — which emits a narrow no-break one, where English writes "42%"
 * with no space at all. A literal here would pin one language's typography into a
 * design-system test.
 */

const fillOf = (bar: HTMLElement) => bar.querySelector<HTMLElement>('div')

/**
 * Testing Library collapses whitespace in the DOM before matching, and the no-break
 * space `Intl` puts in front of the percent sign is whitespace. An attribute is read
 * raw and so is compared raw; rendered text goes through this.
 */
const spaced = (value: string) => value.replace(/\s/g, ' ')

describe('Progress', () => {
  it('reports its position to assistive technology', () => {
    render(<Progress value={42} label="Envoi de la photo" />)

    const bar = screen.getByRole('progressbar', { name: 'Envoi de la photo' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuetext', fr.ui.percent(42))
  })

  it('sets the width through a custom property rather than an inline width', () => {
    render(<Progress value={42} label="Envoi de la photo" />)

    const fill = fillOf(screen.getByRole('progressbar'))
    expect(fill?.style.getPropertyValue('--progress-value')).toBe('42%')
    expect(fill?.style.width).toBe('')
  })

  it('keeps a value outside the range inside the bar', () => {
    render(<Progress value={150} label="Envoi de la photo" />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(fillOf(bar)?.style.getPropertyValue('--progress-value')).toBe('100%')
  })

  it('treats a negative value as no progress', () => {
    render(<Progress value={-5} label="Envoi de la photo" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('works on a byte scale, not only on a percentage', () => {
    render(<Progress value={1_000_000} max={2_000_000} label="Espace photos utilisé" />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '1000000')
    expect(bar).toHaveAttribute('aria-valuemax', '2000000')
    expect(bar).toHaveAttribute('aria-valuetext', fr.ui.percent(50))
  })

  it('survives an event whose quota was never set', () => {
    // A zero max is a real server answer, and dividing by it would render NaN%.
    render(<Progress value={0} max={0} label="Espace photos utilisé" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', fr.ui.percent(0))
  })

  it('shows the percentage as text when asked', () => {
    render(<Progress value={42} label="Envoi de la photo" showValue />)

    expect(screen.getByText(spaced(fr.ui.percent(42)))).toBeInTheDocument()
  })

  it('announces the percentage politely when asked, and stays quiet otherwise', () => {
    const { unmount } = render(<Progress value={42} label="Envoi de la photo" announce />)

    expect(screen.getByText(spaced(fr.ui.percent(42)))).toHaveAttribute('aria-live', 'polite')
    unmount()

    // A queue owns one live region for every photo; a bar per row would talk over
    // itself, so the default is silent.
    render(<Progress value={42} label="Envoi de la photo" />)
    expect(screen.queryByText(spaced(fr.ui.percent(42)))).toBeNull()
  })
})
