import { QrPicker } from '../controls/QrPicker'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/**
 * "QR code" (order 30, spec 14): the same three controls as the settings page, written one key
 * at a time (the panel debounces and merges the writes).
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function QrSection({ settings, save }: WallPanelContext) {
  return <QrPicker wall={settings.wall} onChange={(patch) => save({ wall: patch })} />
}

export const section: WallPanelSection = {
  id: 'qr',
  order: 30,
  title: (text) => text.wall.panel.sectionQr,
  icon: 'qr',
  summary: (text, { wall }) =>
    wall.qrVisible
      ? `${text.admin.wallDisplay.qrCorners[wall.qrPlacement]} · ${text.admin.wallDisplay.qrSizeValue(wall.qrScale)}`
      : text.wall.panel.summaryHidden,
  Component: QrSection,
}
