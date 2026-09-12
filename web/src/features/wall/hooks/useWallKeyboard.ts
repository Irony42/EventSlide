import { useEffect, useRef } from 'react'

export interface WallShortcuts {
  readonly onTogglePause: () => void
  /** `1` for the next photo, `-1` for the previous one. */
  readonly onStep: (step: number) => void
  readonly onToggleFullscreen: () => void
  readonly onCycleLayout: () => void
  readonly onToggleHelp: () => void
  /** Escape: put away whatever is covering the photo. */
  readonly onDismiss: () => void
}

/** A control the browser already operates with these keys owns them. */
const HANDS_OFF = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])

const ignores = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || HANDS_OFF.has(target.tagName)
}

/**
 * The keyboard, for the host who does walk up to the projector.
 *
 * The wall assumes no input device — it has to run for eight hours untouched — but the
 * one person who touches it is a host who wants to hold a photo while a speech happens,
 * or skip past one, without opening the admin console on another machine.
 *
 * The listener is bound once and reads the current handlers through a ref: rebinding a
 * window listener on every render of a screen that re-renders on every SSE signal is
 * how a long-running page accumulates work it never gives back.
 */
export const useWallKeyboard = (shortcuts: WallShortcuts): void => {
  const shortcutsRef = useRef(shortcuts)

  useEffect(() => {
    shortcutsRef.current = shortcuts
  }, [shortcuts])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A browser or OS shortcut is not ours to intercept.
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (ignores(event.target)) return

      const handlers = shortcutsRef.current

      switch (event.key) {
        case ' ':
          // Without this the page also scrolls, which on a projector shows the letterbox.
          event.preventDefault()
          handlers.onTogglePause()
          return
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          handlers.onStep(1)
          return
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          handlers.onStep(-1)
          return
        case '?':
          event.preventDefault()
          handlers.onToggleHelp()
          return
        case 'Escape':
          handlers.onDismiss()
          return
        default:
          break
      }

      switch (event.key.toLowerCase()) {
        case 'f':
          event.preventDefault()
          handlers.onToggleFullscreen()
          return
        case 'l':
          event.preventDefault()
          handlers.onCycleLayout()
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
