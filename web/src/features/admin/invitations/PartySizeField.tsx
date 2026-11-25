import { useEffect, useRef, useState } from 'react'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import { usablePartySize } from '../../../lib/rsvp/partySize'

/** The stillness after which a typed size is a choice: "1" on the way to "10" is not one. */
const PARTY_SIZE_SETTLE_MS = 300

export interface PartySizeFieldProps {
  readonly label: string
  /** The range, in a short sentence ("Entre 1 et 10"): the hint, and the error once what was typed is not a size. */
  readonly rangeHint: string
  /** The size the screen holds: the server's word with the host's unanswered choices over it. */
  readonly value: number
  readonly disabled: boolean
  /** `now`: the field is going away, so the size must be sent at once and not after the pause. */
  readonly onChange: (size: number, now?: boolean) => void
}

/**
 * "Au plus par réponse", typed. **Only a whole number within the bounds is a choice**: it is handed
 * on once the host pauses (or leaves the field), and the panel's autosave debounces it again.
 * "", "0", "11", "abc", "1.5" and "1e1" pass through while the host types and are never sent, nor is
 * the "1" of a "11" (the pause is what tells a prefix from a choice). It is a text field with a
 * numeric keypad, not `type="number"`: the wheel and the arrow keys would change the size under
 * the host's cursor, and the browser would hide what was typed behind an empty value. Leaving the
 * field with something that is not a size puts the saved size back and turns the range from a hint
 * into an error. What was handed on stays on screen only while the screen still holds it, so a
 * refusal (the server's size back) or a preset replaces it; so does the error.
 */
export function PartySizeField({
  label,
  rangeHint,
  value,
  disabled,
  onChange,
}: PartySizeFieldProps) {
  const [typed, setTyped] = useState<{ text: string; handed: number | null } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [seen, setSeen] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ onChange, value })
  useEffect(() => {
    latest.current = { onChange, value }
  })
  /** A size waiting for the pause; leaving the page sends it rather than losing it. */
  const waiting = useRef<number | null>(null)
  const settle = () => {
    window.clearTimeout(timer.current)
    const size = waiting.current
    waiting.current = null
    if (size === null) return
    if (size !== latest.current.value) latest.current.onChange(size)
    setTyped((now) => (now === null ? now : { ...now, handed: size }))
  }
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      const size = waiting.current
      if (size !== null && size !== latest.current.value) latest.current.onChange(size, true)
    },
    [],
  )

  // The screen's size moved (a preset, a refusal, a reload): what was typed, and what was said of
  // it, is over. (State adjusted while rendering, the documented way to derive it from a prop.)
  if (seen !== value) {
    setSeen(value)
    setInvalid(false)
    if (typed !== null && typed.handed !== value) setTyped(null)
  }

  const shown = typed !== null ? typed.text : String(value)
  return (
    <Field label={label} {...(invalid ? { error: rangeHint } : { hint: rangeHint })}>
      {(control) => (
        <TextInput
          {...control}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={shown}
          disabled={disabled}
          onBlur={() => {
            settle()
            // Leaving with something that is not a size: the saved one comes back, with the range.
            if (usablePartySize(shown) === null) setInvalid(true)
            setTyped(null)
          }}
          onChange={(event) => {
            const text = event.target.value
            window.clearTimeout(timer.current)
            waiting.current = usablePartySize(text)
            setInvalid(false)
            setTyped({ text, handed: null })
            if (waiting.current !== null)
              timer.current = window.setTimeout(settle, PARTY_SIZE_SETTLE_MS)
          }}
        />
      )}
    </Field>
  )
}
