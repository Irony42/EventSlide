import { Button } from '../../../../design-system/components/Button'
import { WallSoundFields } from '../../../admin/components/WallSoundFields'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/**
 * "Son" (order 60, spec 12): the same four controls as the settings page, saved on the fly, and
 * the state of **this** screen's speakers with the button that allows them. "Tester" plays on
 * this screen, which is the point: the host sets the volume by ear, in the room.
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function SoundSection({ settings, save, screen }: WallPanelContext) {
  const t = useTranslations()

  return (
    <>
      <WallSoundFields visual wall={settings.wall} onChange={(patch) => save({ wall: patch })} />
      <p aria-live="polite">
        {screen.sound.active ? t.wall.panel.soundScreenOn : t.wall.panel.soundScreenOff}
      </p>
      {screen.sound.active ? null : (
        <Button size="sm" onClick={screen.sound.onActivate}>
          {t.wall.soundActivate}
        </Button>
      )}
    </>
  )
}

export const section: WallPanelSection = {
  id: 'sound',
  order: 60,
  title: (text) => text.admin.wallSound.title,
  icon: 'speaker',
  summary: (text, { wall }) =>
    wall.soundEnabled
      ? `${text.admin.wallSound.toneNames[wall.soundTone]} · ${text.admin.wallSound.volumeValue(wall.soundVolume)}`
      : text.wall.panel.summaryOff,
  Component: SoundSection,
}
