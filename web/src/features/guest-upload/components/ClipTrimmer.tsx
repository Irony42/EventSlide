import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { Icon } from '../../../design-system/components/Icon'
import { IconButton } from '../../../design-system/components/IconButton'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { moveEnd, moveStart, secondsOf, type TrimRange } from '../clipTrim'
import type { ClipTrimState } from '../hooks/useClipUpload'
import styles from './ClipTrimmer.module.css'

/**
 * Choose which part of a too-long recording to send (spec 16).
 *
 * **Two native `<input type="range">`, stacked**, not a component of our own. Keyboard,
 * screen reader, touch and reduced-motion come with the platform; a hand-written slider
 * is pointer code to write and to test on Safari iOS, which is exactly where a guest is
 * standing. The rules of the two handles are not here either: `clipTrim.ts` keeps every
 * position valid, so this screen has no error state at all.
 *
 * The preview plays only the chosen part, looping, muted (the room hears the wall, not a
 * phone). On a browser that cannot decode this recording, HEVC on a desktop say, the
 * picture is replaced by a sentence and the handles keep working on the timeline: the
 * server cuts what the numbers say whether or not this phone could show it.
 */

export interface ClipTrimmerProps {
  readonly file: File
  readonly trim: ClipTrimState
  readonly maxSeconds: number
  /** True while the clip is on its way: the handles hold still. */
  readonly disabled: boolean
  readonly onChange: (range: TrimRange) => void
}

/** The step of the handles: a tenth of a second, which is as fine as a thumb is. */
const STEP_MS = 100

type SelectionStyle = CSSProperties & {
  readonly '--trim-from': string
  readonly '--trim-to': string
}

export function ClipTrimmer({ file, trim, maxSeconds, disabled, onChange }: ClipTrimmerProps) {
  const t = useTranslations()
  const titleId = useId()
  const video = useRef<HTMLVideoElement | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  const { durationMs, startMs, endMs } = trim
  const maxMs = maxSeconds * 1_000

  // One object URL per file, revoked on every exit: it pins the whole recording otherwise.
  // The composer mounts this screen per file (`key`), so the state above starts fresh.
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const element = video.current
    if (element !== null) element.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // The picture shows the frame under the handle being moved. Only the latest position is
  // kept and applied on the next animation frame, so a fast drag never queues seeks.
  const seek = useRef<{ frame: number; seconds: number }>({ frame: 0, seconds: 0 })
  useEffect(() => {
    const state = seek.current
    return () => cancelAnimationFrame(state.frame)
  }, [])

  const showFrame = (ms: number) => {
    const element = video.current
    if (element === null) return
    element.pause()
    setPlaying(false)
    const state = seek.current
    state.seconds = ms / 1_000
    if (state.frame !== 0) return
    state.frame = requestAnimationFrame(() => {
      state.frame = 0
      try {
        element.currentTime = state.seconds
      } catch {
        // A browser that has not read the header yet; `loadedmetadata` seeks again.
      }
    })
  }

  // Nothing keeps playing behind another tab.
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        video.current?.pause()
        setPlaying(false)
      }
    }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [])

  const toggle = () => {
    const element = video.current
    if (element === null) return
    if (playing) {
      element.pause()
      setPlaying(false)
      return
    }
    if (element.currentTime < startMs / 1_000 || element.currentTime >= endMs / 1_000) {
      element.currentTime = startMs / 1_000
    }
    setPlaying(true)
    void Promise.resolve(element.play()).catch(() => setPlaying(false))
  }

  const loop = () => {
    const element = video.current
    if (element === null || element.paused) return
    if (element.currentTime >= endMs / 1_000) element.currentTime = startMs / 1_000
  }

  const changeStart = (event: ChangeEvent<HTMLInputElement>) => {
    const range = moveStart(trim, Number(event.target.value), durationMs, maxMs)
    onChange(range)
    showFrame(range.startMs)
  }
  const changeEnd = (event: ChangeEvent<HTMLInputElement>) => {
    const range = moveEnd(trim, Number(event.target.value), durationMs, maxMs)
    onChange(range)
    showFrame(range.endMs)
  }

  const selection: SelectionStyle = {
    '--trim-from': `${(startMs / durationMs) * 100}%`,
    '--trim-to': `${(endMs / durationMs) * 100}%`,
  }

  return (
    <div
      className={styles['trimmer']}
      role="group"
      aria-labelledby={titleId}
      data-testid="clip-trimmer"
    >
      <p className={styles['title']} id={titleId}>
        {t.upload.clipTrimTitle(maxSeconds)}
      </p>

      {previewFailed ? (
        <p className={styles['notice']}>{t.upload.clipTrimNoPreview}</p>
      ) : (
        <>
          {/* A picture of what the guest is choosing; the sliders carry the information. */}
          <video
            ref={video}
            className={styles['preview']}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            onTimeUpdate={loop}
            onLoadedMetadata={() => {
              if (video.current !== null) video.current.currentTime = startMs / 1_000
            }}
            onEnded={() => setPlaying(false)}
            onError={() => setPreviewFailed(true)}
          />
          <IconButton
            variant="solid"
            aria-label={playing ? t.upload.clipTrimPause : t.upload.clipTrimPlay}
            icon={<Icon name={playing ? 'pause' : 'play'} />}
            onClick={toggle}
            disabled={disabled}
            data-testid="clip-trim-play"
          />
        </>
      )}

      <div className={styles['sliders']} style={selection}>
        <div className={styles['rail']} aria-hidden="true" />
        <input
          className={styles['range']}
          type="range"
          min={0}
          max={durationMs}
          step={STEP_MS}
          value={startMs}
          disabled={disabled}
          aria-label={t.upload.clipTrimStart}
          aria-valuetext={t.upload.clipTrimValue(secondsOf(startMs))}
          data-testid="clip-trim-start"
          onChange={changeStart}
        />
        <input
          className={styles['range']}
          type="range"
          min={0}
          max={durationMs}
          step={STEP_MS}
          value={endMs}
          disabled={disabled}
          aria-label={t.upload.clipTrimEnd}
          aria-valuetext={t.upload.clipTrimValue(secondsOf(endMs))}
          data-testid="clip-trim-end"
          onChange={changeEnd}
        />
      </div>

      {/* Announced politely, without interrupting a guest who is still dragging. */}
      <p className={styles['summary']} role="status">
        {t.upload.clipTrimSummary(secondsOf(endMs - startMs), maxSeconds)}
      </p>
    </div>
  )
}
