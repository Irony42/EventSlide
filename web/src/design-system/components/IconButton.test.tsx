import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconButton } from './IconButton'
import { CloseIcon } from './CloseIcon'

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

  it('refuses to be reached by Tab while disabled', async () => {
    render(<IconButton aria-label="Retirer cette photo" icon={<CloseIcon />} disabled />)

    await userEvent.tab()

    expect(screen.getByRole('button')).not.toHaveFocus()
  })
})
