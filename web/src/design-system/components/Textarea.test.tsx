import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from './Textarea'

const CAPTION = 'Motif'

describe('Textarea', () => {
  it('grows with its value instead of scrolling inside a fixed box', () => {
    render(<Textarea aria-label={CAPTION} />)

    const style = window.getComputedStyle(screen.getByLabelText(CAPTION))

    // A guest writing a caption on a phone cannot see a two-line box scroll, so the box
    // sizes itself to the text and the manual handle is taken away.
    expect(style.getPropertyValue('field-sizing')).toBe('content')
    expect(style.resize).toBe('none')
  })

  it('leaves the resize handle to the user when it is told not to grow', () => {
    render(<Textarea aria-label={CAPTION} grow={false} />)

    const style = window.getComputedStyle(screen.getByLabelText(CAPTION))

    expect(style.getPropertyValue('field-sizing')).not.toBe('content')
    expect(style.resize).toBe('vertical')
  })

  it('reports what the guest typed to the form around it', async () => {
    render(<Textarea aria-label={CAPTION} />)

    await userEvent.type(screen.getByLabelText(CAPTION), 'Les confettis')

    expect(screen.getByLabelText(CAPTION)).toHaveValue('Les confettis')
  })
})
