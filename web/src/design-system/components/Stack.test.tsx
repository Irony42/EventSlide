import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stack } from './Stack'

/**
 * The layout primitive, asserted through the styles the browser resolves rather than
 * through class names: a class name is an implementation detail, `flex-wrap` is the
 * behaviour a caller is buying.
 */
describe('Stack', () => {
  it('keeps a row on one line unless it is asked to wrap', () => {
    render(
      <Stack direction="row" data-testid="actions">
        <span>Publier</span>
      </Stack>,
    )

    expect(window.getComputedStyle(screen.getByTestId('actions')).flexWrap).not.toBe('wrap')
  })

  it('lets a row wrap when the controls no longer fit', () => {
    render(
      <Stack direction="row" wrap data-testid="actions">
        <span>Publier</span>
      </Stack>,
    )

    // A moderation toolbar on a phone has more buttons than a line: wrapping is what
    // keeps the last one reachable instead of pushed off the side.
    expect(window.getComputedStyle(screen.getByTestId('actions')).flexWrap).toBe('wrap')
  })

  it('renders the element the caller asked for, so a list stays a list', () => {
    render(
      <Stack as="ul">
        <li>Camille</li>
      </Stack>,
    )

    // A <div> full of <li> loses the list semantics a screen reader announces.
    expect(screen.getByRole('list')).toBeVisible()
  })
})
