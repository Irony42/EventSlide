/**
 * The five entries of the print page's rail, in the order the host meets them: the design first,
 * the words, the photograph, the colours (card and QR ink together), then the printing itself.
 */
export const PRINT_PANELS = ['design', 'texts', 'photo', 'colours', 'print'] as const

export type PrintPanel = (typeof PRINT_PANELS)[number]

/** The id of the one tabpanel the rail controls: the page gives it to the panel it shows. */
export const PRINT_PANEL_ID = 'print-panel'

export const printTabId = (panel: PrintPanel): string => `print-tab-${panel}`

export const DEFAULT_PRINT_PANEL: PrintPanel = 'design'

export const isPrintPanel = (value: unknown): value is PrintPanel =>
  PRINT_PANELS.some((panel) => panel === value)

/** What the preview shows: one card, big, for design work; or the whole sheet with its cut marks. */
export type PrintView = 'card' | 'sheet'

/** The sheet is what is printed, so it is what the Impression entry shows; the others show one card. */
export const defaultViewOf = (panel: PrintPanel): PrintView =>
  panel === 'print' ? 'sheet' : 'card'

/** The next entry for an arrow key, Home or End on the rail; `null` for any other key. */
export const panelAfterKey = (current: PrintPanel, key: string): PrintPanel | null => {
  const index = PRINT_PANELS.indexOf(current)
  const last = PRINT_PANELS.length - 1
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return PRINT_PANELS[index === last ? 0 : index + 1] ?? null
    case 'ArrowUp':
    case 'ArrowLeft':
      return PRINT_PANELS[index === 0 ? last : index - 1] ?? null
    case 'Home':
      return PRINT_PANELS[0]
    case 'End':
      return PRINT_PANELS[last] ?? null
    default:
      return null
  }
}
