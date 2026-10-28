import { useLayoutEffect } from 'react'
import type { EventThemeDto, ThemeAmbiance, ThemeCustom } from '../lib/api/dto'

/**
 * Carries a host's own ground hue (ADR 0011) up to `<html>`, for the page around the event.
 *
 * `tokens.css` dresses the body and the header through the `:root:has(…)` twin of the custom
 * blocks, and that twin reads `--ground-hue` on the root. The inline angle `customGroundProps`
 * writes sits on the themed surface or the marker, and an inline custom property on a
 * descendant never reaches its ancestors, so without this the page around a custom event wears
 * the root's default hue while the surface inside it wears the host's.
 *
 * A layout effect, so the root has the angle before the first paint, and it is removed when
 * the page that set it goes. Only pages that are about one event call it: the template and
 * editor previews never do, which is what keeps a draft off the console around them.
 */
export function useRootGroundHue(
  ambiance: ThemeAmbiance | null | undefined,
  custom: ThemeCustom | null | undefined,
): void {
  const hue =
    ambiance === 'custom' && custom !== null && custom !== undefined ? custom.groundHue : null
  useLayoutEffect(() => {
    if (hue === null) return undefined
    const root = document.documentElement
    root.style.setProperty('--ground-hue', `${hue}deg`)
    return () => {
      root.style.removeProperty('--ground-hue')
    }
  }, [hue])
}

/** The hook as an element, for a page that returns early before its themed surface renders. */
export function RootGroundHue({ theme }: { readonly theme: EventThemeDto | null }) {
  useRootGroundHue(theme?.ambiance, theme?.custom)
  return null
}
