import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { RenderPng, ShotSize } from './imageRender'

export type CardImageState =
  | { readonly status: 'rendering' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly blob: Blob }

/** The image is remade this long after the last change, so typing does not draw it at every key. */
const SETTLE_MS = 450

interface Answer {
  /** What the picture was drawn from: an answer for another key is for a state that is gone. */
  readonly key: string
  readonly state: CardImageState
}

/**
 * The PNG of the card on its ground, kept ready (spec 29). It is made **before** the host presses
 * "Partager": a phone only opens its share sheet from a tap, and a picture drawn after the tap
 * takes long enough for the system to forget it. A change (design, colour, text, shape) throws the
 * picture away and makes the next one once the host stops; an answer for a state that has been
 * replaced since is never shown.
 */
export const useCardImage = (
  node: RefObject<HTMLElement | null>,
  /** Everything the picture is drawn from: a new value is a new picture. */
  key: string,
  size: ShotSize,
  render: RenderPng,
  /** Held back while what is drawn is not final (the blurred ground is still coming). */
  hold = false,
): CardImageState => {
  const [answer, setAnswer] = useState<Answer | null>(null)

  useEffect(() => {
    if (hold) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const element = node.current
      if (element === null) return
      // Two frames: the fit of the card's texts and the fonts have had their turn.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void render(element, size).then(
            (blob) => {
              if (!cancelled) setAnswer({ key, state: { status: 'ready', blob } })
            },
            () => {
              if (!cancelled) setAnswer({ key, state: { status: 'failed' } })
            },
          )
        }),
      )
    }, SETTLE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [node, key, size, render, hold])

  return useMemo(
    () => (answer !== null && answer.key === key && !hold ? answer.state : { status: 'rendering' }),
    [answer, key, hold],
  )
}
