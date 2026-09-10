import { useCallback, useMemo, useRef, useState } from 'react'
import type { ModerationPhotoDto } from '../../../lib/api/dto'

/**
 * Which photos are selected, and which one the keyboard is on.
 *
 * Both are derived against the current queue rather than pruned in an effect. Photos
 * leave the list constantly — another moderator decides, a guest deletes their own,
 * the filter changes — and a selection holding an id that is no longer on screen is
 * how a bulk action reaches a photo the host cannot see. Deriving makes that
 * impossible instead of making it a bug to remember.
 */

export interface FocusOptions {
  /**
   * Whether to move the browser's focus too. The lightbox passes `false`: it is a
   * modal, and focusing a tile behind it would break the dialog's focus trap.
   */
  readonly moveDomFocus?: boolean
}

export interface QueueSelection {
  readonly selectedIds: readonly string[]
  readonly focusedId: string | null
  isSelected: (photoId: string) => boolean
  toggle: (photoId: string) => void
  selectAll: () => void
  clear: () => void
  focus: (photoId: string, options?: FocusOptions) => void
  /** Move by `delta` positions in the displayed order. A no-op at either end. */
  moveFocus: (delta: number, options?: FocusOptions) => void
  /** Called by each tile so the keyboard can put the browser's focus on it. */
  registerCard: (photoId: string, element: HTMLElement | null) => void
}

export const useQueueSelection = (items: readonly ModerationPhotoDto[]): QueueSelection => {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const [requested, setRequested] = useState<string | null>(null)
  const cards = useRef(new Map<string, HTMLElement>())

  const selectedIds = useMemo(
    () => items.filter((item) => chosen.has(item.id)).map((item) => item.id),
    [items, chosen],
  )

  const focusedId = useMemo(
    () => (items.some((item) => item.id === requested) ? requested : null),
    [items, requested],
  )

  const isSelected = useCallback((photoId: string) => selectedIds.includes(photoId), [selectedIds])

  const toggle = useCallback((photoId: string) => {
    setChosen((previous) => {
      const next = new Set(previous)
      if (!next.delete(photoId)) next.add(photoId)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setChosen(new Set(items.map((item) => item.id)))
  }, [items])

  const clear = useCallback(() => {
    setChosen(new Set())
  }, [])

  const registerCard = useCallback((photoId: string, element: HTMLElement | null) => {
    if (element === null) cards.current.delete(photoId)
    else cards.current.set(photoId, element)
  }, [])

  const focus = useCallback((photoId: string, options: FocusOptions = {}) => {
    setRequested(photoId)
    if (options.moveDomFocus === false) return
    cards.current.get(photoId)?.focus()
  }, [])

  const moveFocus = useCallback(
    (delta: number, options: FocusOptions = {}) => {
      if (items.length === 0) return
      const index = items.findIndex((item) => item.id === focusedId)
      // Nothing focused yet: J starts at the top of the queue and K at the bottom.
      const raw = index === -1 ? (delta > 0 ? 0 : items.length - 1) : index + delta
      // Clamped, not wrapped. A host holding J expects to stop at the end of the
      // queue, not to be sent back to a photo they have already dealt with.
      const target = items[Math.min(Math.max(raw, 0), items.length - 1)]
      if (target === undefined) return
      focus(target.id, options)
    },
    [items, focusedId, focus],
  )

  return {
    selectedIds,
    focusedId,
    isSelected,
    toggle,
    selectAll,
    clear,
    focus,
    moveFocus,
    registerCard,
  }
}
