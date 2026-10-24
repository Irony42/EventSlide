import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { StepUpDialog } from './components/StepUpDialog'
import { StepUpContext } from './stepUpContext'

/**
 * One confirmation prompt for the whole console, opened by whichever write needs it.
 *
 * **One at a time.** A second `confirm()` while the prompt is up returns the same answer instead of
 * opening another: two buttons pressed in a row ask the person once, and both writes go out on
 * the one confirmation they gave.
 *
 * The prompt is a dialog and not a page of its own, because the person is in the middle of
 * something (a reason half typed, a client open) that a navigation would lose.
 */
export function StepUpProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const waiting = useRef<Promise<boolean> | null>(null)
  const settle = useRef<((confirmed: boolean) => void) | null>(null)

  const confirm = useCallback((): Promise<boolean> => {
    if (waiting.current !== null) return waiting.current
    const asked = new Promise<boolean>((resolve) => {
      settle.current = (confirmed) => {
        waiting.current = null
        settle.current = null
        setOpen(false)
        resolve(confirmed)
      }
    })
    waiting.current = asked
    setOpen(true)
    return asked
  }, [])

  const store = useMemo(() => ({ confirm }), [confirm])

  return (
    <StepUpContext.Provider value={store}>
      {children}
      <StepUpDialog
        open={open}
        onConfirmed={() => settle.current?.(true)}
        onCancel={() => settle.current?.(false)}
      />
    </StepUpContext.Provider>
  )
}
