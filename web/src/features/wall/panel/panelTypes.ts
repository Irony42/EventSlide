import type { ComponentType } from 'react'
import type { EventSettingsPatch } from '../../../lib/api/client'
import type { EventSettingsDto } from '../../../lib/api/dto'
import type { UiText } from '../../../lib/i18n/translations'

/**
 * What the panel hands a section (spec 13, §6).
 *
 * `settings` is what the screen shows **now**: the server's last answer with the host's pending
 * changes laid over it, so a control moves at once and goes back to the saved value if the save
 * fails. `save` takes **only the field that changed**: the server merges the `wall` group per
 * key and the panel and the settings page write at different moments.
 */
export interface WallPanelContext {
  readonly slug: string
  readonly settings: EventSettingsDto
  readonly save: (patch: EventSettingsPatch) => void
}

/**
 * One section of the panel, declared by its own file in `./sections/` and nothing else
 * (`wallPanelSections.ts` collects them): adding one is adding a file, not touching the panel.
 * The names and the order of the six sections are fixed for the whole batch (spec 13, §3).
 */
export interface WallPanelSection {
  readonly id: string
  /** 10 Affichage, 20 Ambiance, 30 QR code, 40 A l'ecran, 50 Defi photo, 60 Son. */
  readonly order: number
  readonly title: (text: UiText) => string
  readonly Component: ComponentType<WallPanelContext>
}

/**
 * What only **this screen** does (spec 13, section "Cet écran seulement"): not saved, lost at
 * the next reload. Handed to the panel by the wall page, which owns each of these.
 */
export interface ScreenControls {
  readonly paused: boolean
  readonly onTogglePause: () => void
  readonly onToggleFullscreen: () => void
  /** The layout this screen shows now, in the room's language, and the `L` key's own action. */
  readonly layoutName: string
  readonly onCycleLayout: () => void
  /** `null` when there is no corner card to put away (closed event, empty wall, no invitation). */
  readonly qr: { readonly hidden: boolean; readonly onToggle: () => void } | null
}
