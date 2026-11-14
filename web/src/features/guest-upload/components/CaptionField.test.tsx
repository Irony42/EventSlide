import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { CaptionField } from './CaptionField'

const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]
  .map((code) => String.fromCodePoint(code))
  .join('')

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <CaptionField
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

describe('CaptionField', () => {
  it('has no HTML maxlength, which counts UTF-16 units and would cut an emoji the server accepts', () => {
    renderWithProviders(<Harness />)

    expect(screen.getByLabelText(new RegExp(fr.upload.captionLabel))).not.toHaveAttribute(
      'maxlength',
    )
  })

  it('counts a family emoji as the server does: five characters, not eight', () => {
    renderWithProviders(<Harness initial={FAMILY} />)

    expect(screen.getByText(fr.upload.captionRemaining(135))).toBeInTheDocument()
  })

  it('accepts a full 140 characters made of family emoji, then stops at 140', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    renderWithProviders(<Harness initial={FAMILY.repeat(27)} onChange={seen} />)
    const box = screen.getByLabelText(new RegExp(fr.upload.captionLabel))

    await user.type(box, 'abcdefgh')

    expect([...(box as HTMLTextAreaElement).value]).toHaveLength(140)
    expect((box as HTMLTextAreaElement).value.startsWith(FAMILY.repeat(27))).toBe(true)
  })
})
