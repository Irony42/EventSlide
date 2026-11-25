import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { PartySizeField } from './PartySizeField'

const LABEL = 'Au plus par réponse'

function Harness({ onChange, start = 4 }: { onChange: (size: number) => void; start?: number }) {
  const [value, setValue] = useState(start)
  return (
    <PartySizeField
      label={LABEL}
      rangeHint="Entre 1 et 10"
      value={value}
      disabled={false}
      onChange={(size) => {
        setValue(size)
        onChange(size)
      }}
    />
  )
}

describe('PartySizeField', () => {
  it('hands a size on when the field is left, without waiting for the pause', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    const field = screen.getByLabelText(LABEL)

    await user.clear(field)
    await user.type(field, '7')
    expect(onChange).not.toHaveBeenCalled()
    await user.tab()

    expect(onChange).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('never hands on the "1" of an "11"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    const field = screen.getByLabelText(LABEL)

    await user.clear(field)
    await user.type(field, '11')
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveValue('4')
  })

  it('hands on a size waiting for the pause when the page is left', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { unmount } = renderWithProviders(<Harness onChange={onChange} />)
    const field = screen.getByLabelText(LABEL)

    await user.clear(field)
    await user.type(field, '9')
    unmount()

    expect(onChange).toHaveBeenCalledExactlyOnceWith(9)
  })

  it('does not hand on the size it already holds', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)
    const field = screen.getByLabelText(LABEL)

    await user.clear(field)
    await user.type(field, '4')
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
  })
  it('drops what was typed once the screen holds another size, and shows the size back when it returns', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const props = { label: LABEL, rangeHint: 'Entre 1 et 10', disabled: false, onChange }
    const { rerender } = renderWithProviders(<PartySizeField {...props} value={4} />)
    const field = screen.getByLabelText(LABEL)

    await user.clear(field)
    await user.type(field, '07')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(7))
    rerender(<PartySizeField {...props} value={7} />)
    expect(field).toHaveValue('07')
    rerender(<PartySizeField {...props} value={6} />)
    expect(field).toHaveValue('6')
    rerender(<PartySizeField {...props} value={7} />)

    expect(field).toHaveValue('7')
  })

  it('takes the error back when the screen holds another size', async () => {
    const user = userEvent.setup()
    const props = { label: LABEL, rangeHint: 'Entre 1 et 10', disabled: false, onChange: vi.fn() }
    const { rerender } = renderWithProviders(<PartySizeField {...props} value={4} />)
    const field = screen.getByLabelText(LABEL)
    await user.clear(field)
    await user.type(field, '99')
    await user.tab()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(<PartySizeField {...props} value={6} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(field).not.toHaveAttribute('aria-invalid')
  })
})
