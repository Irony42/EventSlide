import type { ReactNode } from 'react'
import { VisuallyHidden } from '../design-system/components/VisuallyHidden'
import { useTranslations } from '../lib/i18n/useTranslations'

export interface NewTabLinkProps {
  readonly href: string
  readonly className?: string | undefined
  readonly children: ReactNode
}

/**
 * A link that leaves the page it is on, in a tab of its own.
 *
 * **Why a new tab.** The footer is on the guest upload screen, and an unmount there aborts
 * every upload in flight (`useUploadQueue` cancels its controllers on cleanup): a guest
 * who brushes the footer with a thumb mid-send would lose their photographs to a link they
 * never meant to follow. A new tab costs the guest nothing and the page keeps going.
 *
 * **`rel="noopener noreferrer"`**, always, and in this one place: a page opened with
 * `target="_blank"` and no `noopener` can navigate the tab that opened it, and the source
 * host has no business learning which event's address a guest came from. The announcement
 * for a screen reader says what the link does, since the browser will not.
 */
export function NewTabLink({ href, className, children }: NewTabLinkProps) {
  const text = useTranslations()

  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children} <VisuallyHidden>({text.about.opensInNewTab})</VisuallyHidden>
    </a>
  )
}
