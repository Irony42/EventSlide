import type { ReactNode } from 'react'

export interface VisuallyHiddenProps {
  readonly children: ReactNode
  /** `span` inside a sentence, `div` when it wraps block content. */
  readonly as?: 'span' | 'div'
}

/**
 * Text for assistive technology only.
 *
 * No colocated module: the clip technique lives in base.css as `.visually-hidden`
 * because the skip link and the live regions need it before any component mounts, and
 * a second copy in a module would be a second thing to keep correct. `display: none`
 * is not an option — it removes the text from the accessibility tree too.
 */
export function VisuallyHidden({ children, as: Element = 'span' }: VisuallyHiddenProps) {
  return <Element className="visually-hidden">{children}</Element>
}
