import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './WallSoundButton.module.css'

export interface WallSoundButtonProps {
  /** The host switched the sound on, this screen is not allowed to play yet, and the pointer moved. */
  readonly visible: boolean
  readonly onActivate: () => void
}

/**
 * « Activer le son sur cet écran » (spec 12). It stands for the gesture a browser demands before
 * it lets a page play a sound; it writes nothing to the server, so it is public like the wall.
 */
export function WallSoundButton({ visible, onActivate }: WallSoundButtonProps) {
  const text = useTranslations()
  if (!visible) return null

  return (
    <button
      type="button"
      className={styles['button']}
      aria-label={text.wall.soundActivate}
      title={text.wall.soundActivate}
      onClick={onActivate}
    >
      <svg className={styles['icon']} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" />
        <path
          d="m16 9 5 6m0-6-5 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}
