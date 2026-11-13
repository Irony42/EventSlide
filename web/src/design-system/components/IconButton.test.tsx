import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconButton } from './IconButton'
import { CloseIcon } from './CloseIcon'
// The token file, so the value behind `--touch-min` is readable rather than assumed.
import '../tokens.css'

describe('IconButton', () => {
  it('carries the label as its accessible name', () => {
    render(<IconButton aria-label="Retirer cette photo" icon={<CloseIcon />} />)

    expect(screen.getByRole('button')).toHaveAccessibleName('Retirer cette photo')
  })

  it('hides the glyph from assistive technology', () => {
    render(<IconButton aria-label="Retirer cette photo" icon={<span>glyphe</span>} />)

    expect(screen.getByText('glyphe').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it('is activated by Enter and by Space, not only by a pointer', async () => {
    const onClick = vi.fn()
    render(<IconButton aria-label="Retirer cette photo" icon={<CloseIcon />} onClick={onClick} />)

    const button = screen.getByRole('button')
    button.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')

    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('does not submit the form it sits in', () => {
    render(
      <form>
        <IconButton aria-label="Retirer cette photo" icon={<CloseIcon />} />
      </form>,
    )

    // 1.0's "remove this photo" control was a bare <button> inside the upload form, so
    // pressing it sent the whole queue.
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('stays at the touch minimum even though its glyph is tiny', () => {
    render(<IconButton aria-label="Retirer cette photo" icon={<CloseIcon />} />)

    const style = window.getComputedStyle(screen.getByRole('button'))
    const touchMin = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--touch-min')

    // jsdom 31 substitutes `var()` while it resolves the cascade, so the control's computed
    // floor is read directly: the token is 2.75rem, which is 44px at the default 16px root.
    // A 16px close cross is what made 1.0's "remove this photo" unusable one-handed in a
    // dark venue.
    expect(style.minWidth).toBe('44px')
    expect(style.minHeight).toBe('44px')
    expect(touchMin.trim()).toBe('2.75rem')
  })

  it('refuses to be reached by Tab while disabled', async () => {
    render(<IconButton aria-label="Retirer cette photo" icon={<CloseIcon />} disabled />)

    await userEvent.tab()

    expect(screen.getByRole('button')).not.toHaveFocus()
  })
})
