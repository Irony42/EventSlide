import { KeyboardEvent, useState } from 'react'

interface IntervalInputOverlayProps {
  onSubmit: (value: number) => void
}

export default function IntervalInputOverlay({ onSubmit }: IntervalInputOverlayProps) {
  const [value, setValue] = useState('')

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const numericValue = Number(value)
      if (!Number.isNaN(numericValue) && numericValue > 0) {
        onSubmit(numericValue)
      }
    }
  }

  return (
    <input
      type="number"
      placeholder="Interval en ms"
      className="form-control position-fixed top-0 end-0 m-3"
      style={{ maxWidth: 220 }}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      autoFocus
    />
  )
}
