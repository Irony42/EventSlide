import { useSearchParams } from 'react-router-dom'
import type { WallLayout } from '../../../lib/api/dto'

/**
 * Every layout the wire contract names, as a value a running browser can check against.
 *
 * The set itself is the domain's — `WALL_LAYOUTS` in `src/domain/slideshow/wallLayout.ts`
 * — and it reaches the browser as the `WallLayout` union in `web/src/lib/api/dto.ts`,
 * because the web app talks to the server over HTTP only and lint forbids importing
 * across that boundary (`eslint.config.mjs`). A union is erased at runtime, so the guard
 * below needs one value, and this is it: `Record<WallLayout, true>` makes TypeScript
 * check it in both directions — a layout added to the contract fails to compile here
 * until it is listed, and a name that is not in the contract is rejected as an excess
 * property. That is what keeps this from being a fourth hand-copied list of strings.
 */
const LAYOUT_NAMES: Readonly<Record<WallLayout, true>> = {
  spotlight: true,
  mosaic: true,
  polaroid: true,
  filmstrip: true,
}

const isWallLayout = (value: string): value is WallLayout => Object.hasOwn(LAYOUT_NAMES, value)

/**
 * The layout the display URL asks for, or `null` for "whatever the wall already shows".
 *
 * Layout is a presentation choice made at the screen, not a property of the event: the
 * host's `L` shortcut already changes it in one browser with no server round trip, and
 * this is the same capability in a form a kiosk's autostart can hold. A projector left
 * alone in the corner has nobody to press `L`, so `/e/:slug/display?layout=mosaic` is
 * how that room gets the mosaic. Nothing is sent to the API and nothing is stored.
 *
 * An unknown or malformed value is `null` rather than an error. This is the one screen
 * in the product that must never go blank — it runs unattended for eight hours — so a
 * typo in a kiosk config falls back to the layout the wall response carries instead of
 * taking the room's screen down, exactly as `useTimingOverrides` ignores a timing it
 * cannot parse.
 */
export const useLayoutParam = (): WallLayout | null => {
  const [params] = useSearchParams()
  const raw = params.get('layout')
  // A primitive, so no memo: the value is compared by identity anyway.
  return raw !== null && isWallLayout(raw) ? raw : null
}
