import { useEffect, useRef } from 'react'

/**
 * The single-key shortcuts that make a hundred-photo queue survivable.
 *
 * A host moderating a wedding has one hand on the keyboard and their eyes on the
 * projector. Reaching for the mouse per photo is what makes a queue back up, and a
 * backed-up queue is what makes a host switch moderation off — the one setting that
 * turns the product into a liability.
 *
 * Two rules that are the whole reason this is a hook and not a `keydown` in a
 * component:
 *
 * - **Never while text is being typed.** A caption or a search box would otherwise
 *   swallow letters into decisions: typing "Photo" would publish, hide and refuse
 *   three different photos.
 * - **Removed on unmount.** A listener left on `window` keeps firing after the host
 *   navigates away, against a queue that no longer exists.
 */

export interface ModerationShortcutHandlers {
  /** J — next photo in the displayed order. */
  readonly onNext: () => void
  /** K — previous photo. */
  readonly onPrevious: () => void
  /** P — publish. */
  readonly onPublish: () => void
  /** R — refuse. */
  readonly onReject: () => void
  /** H — take off the screen. */
  readonly onHide: () => void
  /** Z — undo the last decision. */
  readonly onUndo: () => void
  /** Space — add the focused photo to the selection. */
  readonly onToggleSelect: () => void
  /** Escape — drop the selection. */
  readonly onClear: () => void
}

export interface ModerationShortcutOptions {
  /** `false` while a modal owns the keyboard, so the two do not both react. */
  readonly enabled?: boolean
}

/**
 * Input types that take typed text. A checkbox, a radio or a button is an input too,
 * and a host tabbing through tiles must not lose the shortcuts because their focus
 * happens to sit on a selection checkbox.
 */
const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
])

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(target.type)
  return false
}

const isCheckbox = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.type === 'checkbox'

export const useModerationShortcuts = (
  handlers: ModerationShortcutHandlers,
  { enabled = true }: ModerationShortcutOptions = {},
): void => {
  /**
   * Held in a ref so the listener is attached once. The handlers close over the queue
   * and are new objects on every render; re-binding them per render would mean the
   * console re-registers a `keydown` listener each time a photo arrives.
   */
  const current = useRef(handlers)
  useEffect(() => {
    current.current = handlers
  }, [handlers])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog that already acted on the key — Escape closing the lightbox — marks
      // it handled. Acting again would clear the selection the host did not ask about.
      if (event.defaultPrevented) return
      // Browser and OS shortcuts stay the browser's: Ctrl+P is print, Cmd+R reloads.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTextEntry(event.target)) return

      const actions = current.current

      if (event.key === 'Escape') {
        actions.onClear()
        return
      }

      if (event.key === ' ') {
        // The browser already toggles a focused checkbox on Space, and doing it here
        // too would select and immediately deselect the photo.
        if (isCheckbox(event.target)) return
        // Space scrolls the page otherwise, which moves the queue out from under the
        // host mid-selection.
        event.preventDefault()
        actions.onToggleSelect()
        return
      }

      switch (event.key.toLowerCase()) {
        case 'j':
          actions.onNext()
          return
        case 'k':
          actions.onPrevious()
          return
        case 'p':
          actions.onPublish()
          return
        case 'r':
          actions.onReject()
          return
        case 'h':
          actions.onHide()
          return
        case 'z':
          actions.onUndo()
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
