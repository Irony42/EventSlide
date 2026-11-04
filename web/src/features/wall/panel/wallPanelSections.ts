import type { WallPanelSection } from './panelTypes'

/**
 * Every section of the panel, found rather than listed: each file of `./sections/` exports a
 * `section`, and this sorts them by `order`. A spec adds its section by adding its file, never by
 * editing the panel or another spec's section (spec 13, §6).
 */
const modules = import.meta.glob<{ readonly section: WallPanelSection }>('./sections/*.tsx', {
  eager: true,
})

export const WALL_PANEL_SECTIONS: readonly WallPanelSection[] = Object.values(modules)
  .map((module) => module.section)
  .sort((a, b) => a.order - b.order)
