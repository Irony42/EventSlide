import { OptionCard } from '../controls/OptionCard'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/**
 * "À l'écran" (order 40, spec 11): the souvenir counter and the new-photo signal. The same two
 * settings, with the same labels, as the block of the same name on the settings page.
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function OnScreenSection({ settings, save }: WallPanelContext) {
  const t = useTranslations()
  const { wall } = settings

  return (
    <>
      <OptionCard
        art="counter"
        label={t.admin.wallDisplay.souvenirCounter}
        checked={wall.souvenirCounter}
        onChange={(souvenirCounter) => save({ wall: { souvenirCounter } })}
      />
      <OptionCard
        art="signal"
        label={t.admin.wallDisplay.newPhotoSignal}
        checked={wall.newPhotoSignal}
        onChange={(newPhotoSignal) => save({ wall: { newPhotoSignal } })}
      />
    </>
  )
}

export const section: WallPanelSection = {
  id: 'on-screen',
  order: 40,
  title: (text) => text.admin.wallDisplay.onScreen,
  icon: 'eye',
  summary: (text, { wall }) =>
    [
      wall.souvenirCounter ? text.admin.wallDisplay.souvenirCounter : null,
      wall.newPhotoSignal ? text.admin.wallDisplay.newPhotoSignal : null,
    ]
      .filter((label) => label !== null)
      .join(' · ') || text.wall.panel.summaryNone,
  Component: OnScreenSection,
}
