import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button } from '../../../design-system/components/Button'
import { themeSurfaceProps } from '../../../design-system/eventTheme'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { MyPhotos } from '../../guest-upload/components/MyPhotos'
import { PhotoPicker } from '../../guest-upload/components/PhotoPicker'
import { WallLayouts } from '../../wall/components/WallLayouts'
import { WallOverlay } from '../../wall/components/WallOverlay'
import type { Slideshow } from '../../wall/hooks/useSlideshow'
import styles from './AmbiancePreview.module.css'
import type { EventThemeDto, GuestPhotoDto, WallItemDto } from '../../../lib/api/dto'
// Photographs the product already ships: the ambiances' grounds. A sample, never a guest's picture.
import sampleWall from '../../../design-system/ambiances/champs-ground-1600.webp'
import sampleFirst from '../../../design-system/ambiances/riviera-ground-1600.webp'
import sampleSecond from '../../../design-system/ambiances/guinguette-ground-1600.webp'

/**
 * The two screens a host is dressing, drawn by the real components with the draft theme
 * (ADR 0011, decision 6): the guest's upload screen in a phone, and the wall in a 16:9 frame.
 *
 * Surface: **the host's laptop**, serving the guest's phone and the room.
 *
 * ## It is a simulation, so nothing in it is live
 *
 * No request, no stream, no upload: the photographs are bundled samples, the slideshow is a
 * value that never advances, and every control is inert. A photograph held still is also why
 * there is no motion to decline under `prefers-reduced-motion`.
 *
 * ## The draft never dresses the page
 *
 * Both frames carry `data-template-preview`, and the theme goes on the frame itself through
 * `themeSurfaceProps`, exactly as `TemplateThemePreview` does. `tokens.css` and `base.css`
 * exclude that marker from their `:root:has()` twins, so the console around the frames keeps
 * the event's saved look until the host presses Enregistrer.
 *
 * ## The wall is the wall, scaled
 *
 * A projector's type and spacing are tuned for 1920 by 1080, and a smaller box would lay the
 * same components out differently. The stage is therefore drawn at that size and shrunk with a
 * transform, whose factor is measured: a computed number, which is what an inline custom
 * property is for.
 */

/** What the real wall response would hold for one photograph. */
const WALL_ITEM: WallItemDto = {
  id: 'preview-photo',
  displayUrl: sampleWall,
  thumbUrl: sampleWall,
  width: 1600,
  height: 1067,
  caption: null,
  authorName: null,
  createdAt: '2026-06-20T21:04:11.031Z',
  kind: 'photo',
  videoUrl: null,
  durationMs: null,
}

const noop = (): void => undefined

/** A playlist that stays on one photograph, so there is no transition and no zoom to draw. */
const stillOn = (current: WallItemDto): Slideshow => ({
  current,
  next: null,
  previous: null,
  index: 0,
  intervalMs: 0,
  generation: 0,
  recent: [{ item: current, fresh: false }],
  upcoming: [],
  fresh: false,
  paused: true,
  pause: noop,
  resume: noop,
  advance: noop,
})

const GUEST_PHOTOS: readonly GuestPhotoDto[] = [
  {
    id: 'preview-1',
    status: 'published',
    thumbUrl: sampleFirst,
    caption: null,
    createdAt: '2026-06-20T21:04:11.031Z',
    canDelete: false,
    kind: 'photo',
    videoUrl: null,
    durationMs: null,
  },
  {
    id: 'preview-2',
    status: 'pending',
    thumbUrl: sampleSecond,
    caption: null,
    createdAt: '2026-06-20T21:06:40.000Z',
    canDelete: false,
    kind: 'photo',
    videoUrl: null,
    durationMs: null,
  },
]

type StageStyle = CSSProperties & { readonly '--preview-scale'?: string }

/** The factor that fits the stage's own width into the frame's. `null` until it is known. */
const useFitScale = () => {
  const frame = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState<number | null>(null)

  useEffect(() => {
    const outer = frame.current
    const inner = stage.current
    if (outer === null || inner === null || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      // `offsetWidth` ignores the transform, which is the stage's natural size.
      if (inner.offsetWidth > 0) setScale(outer.clientWidth / inner.offsetWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [])

  return { frame, stage, scale }
}

export interface AmbiancePreviewProps {
  /** The draft: the event's own theme, made Sur mesure. */
  readonly theme: EventThemeDto
  readonly eventName: string
  /** The event's real code and link, so the QR is the one the room would show. */
  readonly join: { readonly code: string; readonly url: string }
}

export function AmbiancePreview({ theme, eventName, join }: AmbiancePreviewProps) {
  const t = useTranslations()
  const { frame, stage, scale } = useFitScale()

  const guest = themeSurfaceProps(theme, 'guest', { preview: true })
  const wall = themeSurfaceProps(theme, 'wall', { preview: true })
  const stageStyle: StageStyle = {
    ...wall.style,
    ...(scale === null ? {} : { '--preview-scale': String(scale) }),
  }
  const slide: WallItemDto = {
    ...WALL_ITEM,
    caption: t.admin.customPreviewCaption,
    authorName: t.admin.customPreviewAuthor,
  }

  return (
    <div className={styles['previews']}>
      <figure className={styles['figure']}>
        <figcaption className={styles['label']}>{t.admin.customPreviewPhone}</figcaption>
        {/* `inert` keeps every control in the frame out of the tab order and the pointer's
            reach: it is a picture of the screen, not the screen. */}
        <div
          {...guest}
          data-template-preview="guest"
          className={styles['phone']}
          aria-hidden="true"
          inert
        >
          <div className={styles['guestPage']}>
            <header className={styles['guestHeader']}>
              <p className={styles['guestTitle']}>{eventName}</p>
              <p className={styles['guestIntro']}>{t.upload.intro}</p>
              <p className={styles['guestSignature']}>
                {t.upload.signedAs(t.admin.customPreviewAuthor)}
              </p>
            </header>
            <MyPhotos
              photos={GUEST_PHOTOS}
              loading={false}
              error={null}
              onRetry={noop}
              onDelete={() => Promise.resolve()}
            />
            <div className={styles['composer']}>
              <PhotoPicker onPick={noop} />
              <Button variant="primary" size="lg" block>
                {t.upload.send}
              </Button>
            </div>
          </div>
        </div>
      </figure>

      <figure className={styles['figure']}>
        <figcaption className={styles['label']}>{t.admin.customPreviewWall}</figcaption>
        <div ref={frame} className={styles['wallFrame']} aria-hidden="true" inert>
          <div
            {...wall}
            ref={stage}
            data-template-preview="wall"
            className={styles['wallStage']}
            style={stageStyle}
          >
            <WallLayouts
              layout="spotlight"
              items={[slide]}
              slideshow={stillOn(slide)}
              kenBurnsDurationMs={0}
              transitionMs={0}
            />
            <WallOverlay join={join} onDismiss={noop} />
          </div>
        </div>
      </figure>
    </div>
  )
}
