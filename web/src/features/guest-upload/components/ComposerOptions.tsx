import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ClipLimits } from '../clipFile'
import type { ClipUpload } from '../hooks/useClipUpload'
import { CaptionField } from './CaptionField'
import { ClipComposer } from './ClipComposer'
import styles from './ComposerOptions.module.css'

/**
 * The two things a guest may add to a send, and neither is the reason they opened the page.
 *
 * The caption and the video were both shown in full by default, and both are on by default in
 * an event's settings, so the pane at the bottom of the screen was 61 to 83 % of a phone before
 * the guest had chosen a single photo: pinned, it left them nothing to scroll; in the flow, the
 * send button was a scroll away. Now each is a labelled button under the two pickers, "Légende"
 * and "Vidéo", that unfolds its control in place. The words are on screen the whole time, so
 * nothing is hidden behind a menu: the guest who wants a caption sees where it is. The hint that
 * used to stand over each control ("140 caractères maximum", "15 secondes et 80 Mo maximum")
 * is part of what unfolds, so no information is dropped, only moved to the moment it is for.
 *
 * What is **not** folded away, whatever the guest pressed last:
 *
 * - a caption with text in it, and a clip that has been chosen or is on its way. Folding them
 *   would hide something that is about to be sent, so the button stays on screen, reports the
 *   state (`aria-expanded`) and declines the press (`aria-disabled`, not `disabled`: it keeps
 *   its place in the tab order and says so, rather than vanishing under a finger).
 * - a section the guest has unfolded stays unfolded when they empty it, so deleting the last
 *   letter of a caption never takes the field from under the cursor.
 *
 * Focus follows the guest into what they opened: the caption's textarea, or the first video
 * picker. Folding leaves focus on the button that was pressed, so there is nothing to trap or to
 * lose. Both sections stay in the DOM when folded (`hidden`), which is what keeps `aria-controls`
 * pointing at something and a half-written caption alive.
 *
 * Rendered only for what the event allows: with captions off and video off there is no row at
 * all, and with one of them off the other is the only button.
 */

export interface ComposerOptionsProps {
  /** The host's setting. When `false` there is no caption button and no field. */
  readonly captions: boolean
  readonly caption: string
  readonly onCaptionChange: (value: string) => void
  /** The host's setting. When `false` there is no video button and no composer. */
  readonly clips: boolean
  readonly clip: ClipUpload
  readonly limits: ClipLimits
}

export function ComposerOptions({
  captions,
  caption,
  onCaptionChange,
  clips,
  clip,
  limits,
}: ComposerOptionsProps) {
  const t = useTranslations()
  const ids = useId()
  const captionToggleId = `${ids}-caption-toggle`
  const captionPanelId = `${ids}-caption`
  const clipToggleId = `${ids}-clip-toggle`
  const clipPanelId = `${ids}-clip`

  const captionInput = useRef<HTMLTextAreaElement | null>(null)
  const clipInput = useRef<HTMLInputElement | null>(null)

  const [captionOpen, setCaptionOpen] = useState(caption.length > 0)
  const [clipOpen, setClipOpen] = useState(clip.stage !== 'idle')

  // Unfolded the moment there is something in them, and left unfolded: derived while rendering
  // rather than in an effect, so there is no frame with a caption in a folded field.
  const captionHeld = caption.length > 0
  const clipHeld = clip.stage !== 'idle'
  if (captionHeld && !captionOpen) setCaptionOpen(true)
  if (clipHeld && !clipOpen) setClipOpen(true)

  if (!captions && !clips) return null

  /**
   * `flushSync` so the section is no longer `hidden` when focus is asked for: an element that
   * is not rendered cannot take it, and a state update alone lands after this handler returns.
   */
  const toggleCaption = () => {
    if (captionHeld) return
    const next = !captionOpen
    flushSync(() => setCaptionOpen(next))
    if (next) captionInput.current?.focus()
  }
  const toggleClip = () => {
    if (clipHeld) return
    const next = !clipOpen
    flushSync(() => setClipOpen(next))
    if (next) clipInput.current?.focus()
  }

  const trimmed = caption.trim()

  return (
    <div className={styles['options']}>
      <div className={styles['toggles']}>
        {captions ? (
          <Button
            id={captionToggleId}
            variant="secondary"
            size="sm"
            className={styles['toggle']}
            icon={<span aria-hidden="true">{captionOpen ? '−' : '+'}</span>}
            aria-expanded={captionOpen}
            aria-controls={captionPanelId}
            aria-disabled={captionHeld || undefined}
            onClick={toggleCaption}
          >
            {t.upload.captionLabel}
          </Button>
        ) : null}
        {clips ? (
          <Button
            id={clipToggleId}
            variant="secondary"
            size="sm"
            className={styles['toggle']}
            icon={<span aria-hidden="true">{clipOpen ? '−' : '+'}</span>}
            aria-expanded={clipOpen}
            aria-controls={clipPanelId}
            aria-disabled={clipHeld || undefined}
            onClick={toggleClip}
          >
            {t.upload.clipSection}
          </Button>
        ) : null}
      </div>

      {captions ? (
        <div id={captionPanelId} hidden={!captionOpen}>
          <CaptionField value={caption} onChange={onCaptionChange} inputRef={captionInput} />
        </div>
      ) : null}
      {/*
        Below the caption, because the caption travels with the clip as well — a guest who
        wrote one and then sent a video must not lose it — and above the send button, because
        the video has a send button of its own and two of them side by side would be a guess
        about which one does what.

        Rendered only when the host allowed video. On a gallery created before clips shipped
        this setting reads `false`, and offering the control there would mean a `403` after
        eighty megabytes.
      */}
      {clips ? (
        <ClipComposer
          id={clipPanelId}
          labelledBy={clipToggleId}
          hidden={!clipOpen}
          libraryRef={clipInput}
          clip={clip}
          limits={limits}
          caption={trimmed.length === 0 ? null : trimmed}
        />
      ) : null}
    </div>
  )
}
