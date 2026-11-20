/**
 * The colours offered for a printed card (spec 28), as swatches beside the event's own colour and
 * a free picker. Data the host chooses among, not the interface's palette: what a swatch is drawn
 * with on paper is decided by `tokens.css` from the hue of the colour (`printKit.hueOfHex`), so
 * the QR ink and the dark shades stay dark whichever one is picked.
 */
export const PRINT_SWATCHES = {
  coral: '#e8604c',
  raspberry: '#c2185b',
  plum: '#7b3f73',
  lavender: '#8e7cc3',
  navy: '#1f3a68',
  ocean: '#1e88a8',
  fir: '#2e6b4f',
  olive: '#7d8b3a',
  mustard: '#d9a62e',
  terracotta: '#b5603a',
  charcoal: '#3d3d45',
} as const

export type PrintSwatch = keyof typeof PRINT_SWATCHES

export const PRINT_SWATCH_IDS = Object.keys(PRINT_SWATCHES) as readonly PrintSwatch[]
