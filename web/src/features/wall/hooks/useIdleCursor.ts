import { useEffect, useState } from 'react'

/** How long the pointer has to lie still before the wall takes it off the photo. */
export const CURSOR_IDLE_MS = 3_000

/**
 * Whether the mouse arrow should be hidden, because nobody has moved it for a few seconds.
 *
 * A host who clicked into the tab to open it leaves the arrow planted in the middle of the
 * photograph for the whole evening. It is back at the first movement, so the person who walks
 * up to the machine is never hunting for a pointer that is not there.
 *
 * The timer starts when the wall mounts, not at the first movement: a wall opened with
 * the arrow already on it should not wait for a mouse that nobody will touch.
 */
export const useIdleCursor = (): boolean => {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer: number | undefined

    const arm = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), CURSOR_IDLE_MS)
    }

    const onMove = (): void => {
      // `setIdle(false)` while already false is a bail-out, so a mouse that moves a hundred
      // times a second costs one timer reset each and no render.
      setIdle(false)
      arm()
    }

    arm()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onMove, { passive: true })

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
    }
  }, [])

  return idle
}
