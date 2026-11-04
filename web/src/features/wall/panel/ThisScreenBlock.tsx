import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ScreenControls } from './panelTypes'
import styles from './WallSettingsPanel.module.css'

/**
 * "Cet écran seulement": what changes this one projector and is not saved. Visibly apart from
 * what the panel writes for the event, so a host knows which of the two they are touching.
 */
export function ThisScreenBlock({ screen }: { readonly screen: ScreenControls }) {
  const t = useTranslations()
  const text = t.wall.panel

  return (
    <section className={styles['group']} aria-labelledby="wall-panel-screen">
      <h3 id="wall-panel-screen" className={styles['groupTitle']}>
        {text.thisScreen}
      </h3>
      <p className={styles['hint']}>{text.thisScreenHint}</p>
      <div className={styles['actions']}>
        <Button size="sm" onClick={screen.onTogglePause}>
          {screen.paused ? text.resume : text.pause}
        </Button>
        <Button size="sm" onClick={screen.onToggleFullscreen}>
          {text.fullscreen}
        </Button>
        <Button size="sm" onClick={screen.onCycleLayout}>
          {text.screenLayout(screen.layoutName)}
        </Button>
        {screen.qr === null ? null : (
          <Button size="sm" onClick={screen.qr.onToggle}>
            {screen.qr.hidden ? text.showQr : text.hideQr}
          </Button>
        )}
      </div>
    </section>
  )
}
