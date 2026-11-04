import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('describes the control it wraps, without renaming it', () => {
    render(
      <Tooltip text="Réglages (R)">
        {(describedBy) => (
          <button type="button" aria-label="Réglages" aria-describedby={describedBy} />
        )}
      </Tooltip>,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAccessibleName('Réglages')
    expect(button).toHaveAccessibleDescription('Réglages (R)')
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Réglages (R)')
  })
})
