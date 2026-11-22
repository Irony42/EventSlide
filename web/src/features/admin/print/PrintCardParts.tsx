import { useEffect, useId, useState } from 'react'
import { cx } from '../../../design-system/classNames'
import { coverRect } from '../../../lib/print/coverRect'
import styles from './PrintCard.module.css'

/** The host's photograph, or nothing. */
export function Photo({
  url,
  className,
}: {
  readonly url: string | null
  readonly className?: string | undefined
}) {
  if (url === null) return null
  return (
    <div className={cx(styles['photo'], className)} data-print-photo="">
      <img src={url} alt="" />
    </div>
  )
}

/** The garland of the EventSlide logo, drawn wide: prints pegged on a string (Garland.astro). */
const GARLAND_WIDTH = 90.4
const P0 = [-4, 2] as const
const P1 = [GARLAND_WIDTH / 2, 32] as const
const P2 = [GARLAND_WIDTH + 4, 2] as const
const onString = (u: number): readonly [number, number] => [
  (1 - u) ** 2 * P0[0] + 2 * (1 - u) * u * P1[0] + u * u * P2[0],
  (1 - u) ** 2 * P0[1] + 2 * (1 - u) * u * P1[1] + u * u * P2[1],
]
const slopeAt = (u: number): number => {
  const dx = 2 * (1 - u) * (P1[0] - P0[0]) + 2 * u * (P2[0] - P1[0])
  const dy = 2 * (1 - u) * (P1[1] - P0[1]) + 2 * u * (P2[1] - P1[1])
  return (Math.atan2(dy, dx) * 180) / Math.PI
}
const GARLAND_PRINTS = [
  { u: 0.08, tone: 'glSun', w: 11, h: 13.5 },
  { u: 0.24, tone: 'glSky', w: 12.5, h: 15 },
  { u: 0.5, tone: null, w: 30, h: 36 },
  { u: 0.76, tone: 'glPink', w: 12.5, h: 15 },
  { u: 0.92, tone: 'glMint', w: 11, h: 13.5 },
] as const
const r2 = (value: number): string => value.toFixed(2)

/**
 * The natural size of a picture, once the browser has it. `null` until then, and for a picture it
 * cannot read: the banner then draws it at its frame.
 */
const useNaturalSize = (url: string | null): { width: number; height: number } | null => {
  const [known, setKnown] = useState<{
    readonly of: string
    readonly width: number
    readonly height: number
  } | null>(null)
  useEffect(() => {
    if (url === null) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setKnown({ of: url, width: image.naturalWidth, height: image.naturalHeight })
    }
    image.src = url
    return () => {
      cancelled = true
      image.onload = null
    }
  }, [url])
  return known !== null && known.of === url ? known : null
}

/**
 * The prints pegged on a string, the photograph (or the monogram) in the middle one.
 *
 * The photograph is an SVG `<image>`, not an HTML one in a `foreignObject`: the picture of the
 * card made for sharing would lose the second (a `foreignObject` inside the capture's own is empty
 * in WebKit, and its styles are not carried over). It is placed **exactly** where the host's framing
 * puts it (`coverRect`, the box `object-fit: cover` and `object-position` would make), over the
 * tint and under the rounded clip the HTML one had.
 */
export function GarlandBanner({
  photoUrl,
  monogram,
  focusX = 50,
  focusY = 50,
}: {
  readonly photoUrl: string | null
  readonly monogram: string
  readonly focusX?: number
  readonly focusY?: number
}) {
  const natural = useNaturalSize(photoUrl)
  const clip = `glClip${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg className={styles['glBanner']} viewBox={`0 0 ${GARLAND_WIDTH} 56`} aria-hidden="true">
      <path
        className={styles['glString']}
        d={`M${P0[0]} ${P0[1]} Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`}
        fill="none"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
      {GARLAND_PRINTS.map(({ u, tone, w, h }) => {
        const [x, y] = onString(u)
        const turn = slopeAt(u) * 0.6
        const pegW = tone === null ? 2.6 : 2.2
        const pegH = tone === null ? 6.6 : 5.6
        const pad = 1.7
        const inner = w - 2 * pad
        return (
          <g key={u} transform={`rotate(${r2(turn)} ${r2(x)} ${r2(y)})`}>
            {tone === null ? (
              <>
                <rect
                  className={styles['glPrint']}
                  x={r2(x - w / 2)}
                  y={r2(y - 1)}
                  width={w}
                  height={h}
                  rx="2"
                />
                {photoUrl === null ? (
                  <>
                    <rect
                      className={styles['glCoral']}
                      x={r2(x - inner / 2)}
                      y={r2(y - 1 + pad)}
                      width={r2(inner)}
                      height={r2(inner)}
                      rx="1"
                    />
                    <text
                      className={styles['glMonogram']}
                      x={r2(x)}
                      y={r2(y - 1 + pad + inner / 2 + 2.6)}
                      textAnchor="middle"
                    >
                      {monogram}
                    </text>
                  </>
                ) : (
                  <>
                    <clipPath id={`${clip}-${r2(u * 100)}`}>
                      <rect
                        x={r2(x - inner / 2)}
                        y={r2(y - 1 + pad)}
                        width={r2(inner)}
                        height={r2(inner)}
                        rx="1"
                      />
                    </clipPath>
                    <rect
                      className={styles['glPhotoBack']}
                      x={r2(x - inner / 2)}
                      y={r2(y - 1 + pad)}
                      width={r2(inner)}
                      height={r2(inner)}
                      rx="1"
                    />
                    <PhotoImage
                      href={photoUrl}
                      box={coverRect(
                        natural,
                        { x: x - inner / 2, y: y - 1 + pad, width: inner, height: inner },
                        focusX,
                        focusY,
                      )}
                      clip={`url(#${clip}-${r2(u * 100)})`}
                    />
                  </>
                )}
              </>
            ) : (
              <rect
                className={styles[tone]}
                x={r2(x - w / 2)}
                y={r2(y - 1)}
                width={w}
                height={h}
                rx={r2(w * 0.13)}
              />
            )}
            <rect
              className={styles['glPeg']}
              x={r2(x - pegW / 2)}
              y={r2(y - pegH * 0.55)}
              width={pegW}
              height={pegH}
              rx={r2(pegW * 0.35)}
            />
          </g>
        )
      })}
    </svg>
  )
}

function PhotoImage({
  href,
  box,
  clip,
}: {
  readonly href: string
  readonly box: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly clip: string
}) {
  return (
    <image
      href={href}
      x={r2(box.x)}
      y={r2(box.y)}
      width={r2(box.width)}
      height={r2(box.height)}
      preserveAspectRatio="none"
      clipPath={clip}
    />
  )
}
