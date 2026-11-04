import { Button } from '../../../design-system/components/Button'
import { Icon } from '../../../design-system/components/Icon'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ScreenControls } from './panelTypes'
import styles from './WallSettingsPanel.module.css'

/**
 * "Cet écran seulement": what changes this one projector and is not saved. Visibly apart from
 * what the panel writes for the event (a dashed frame, a screen glyph), so a host knows which of
 * the two they are touching.
 */
export function ThisScreenBlock({ screen }: { readonly screen: ScreenControls }) {
  const t = useTranslations()
  const text = t.wall.panel

  return (
    <section className={styles['group']} aria-labelledby="wall-panel-screen">
      <h3 id="wall-panel-screen" className={styles['groupTitle']}>
        <Icon name="monitor" size="sm" />
        {text.thisScreen}
      </h3>
      <p className={styles['hint']}>{text.thisScreenHint}</p>
      <div className={styles['actions']}>
        <Button size="sm" onClick={screen.onTogglePause}>
          <Icon name={screen.paused ? 'play' : 'pause'} size="sm" />
          {screen.paused ? text.resume : text.pause}
        </Button>
        <Button size="sm" onClick={screen.onToggleFullscreen}>
          <Icon name="fullscreen" size="sm" />
          {text.fullscreen}
        </Button>
        <Button size="sm" onClick={screen.onCycleLayout}>
          <Icon name="layout" size="sm" />
          {text.screenLayout(screen.layoutName)}
        </Button>
        {screen.qr === null ? null : (
          <Button size="sm" onClick={screen.qr.onToggle}>
            <Icon name="qr" size="sm" />
            {screen.qr.hidden ? text.showQr : text.hideQr}
          </Button>
        )}
      </div>
    </section>
  )
}
