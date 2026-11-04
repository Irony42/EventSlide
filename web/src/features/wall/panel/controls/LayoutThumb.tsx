import type { WallLayout } from '../../../../lib/api/dto'
import styles from './controls.module.css'

/** `auto` is "chosen by the event's own setting": no layout of its own. */
export type LayoutThumbName = WallLayout | 'auto'

const box = (x: number, y: number, w: number, h: number): string => `M${x} ${y}h${w}v${h}h-${w}z`

/** Each layout in a 64 x 40 box, as filled blocks: what the room sees, not what the code calls it. */
const SHAPES: Readonly<Record<LayoutThumbName, string>> = {
  auto: `${box(6, 6, 24, 14)}${box(34, 6, 24, 14)}${box(6, 24, 24, 10)}${box(34, 24, 24, 10)}`,
  spotlight: box(4, 4, 56, 32),
  mosaic: [0, 1, 2]
    .flatMap((col) => [0, 1].map((row) => box(4 + col * 19, 4 + row * 17, 17, 15)))
    .join(''),
  polaroid: `${box(16, 3, 32, 34)}`,
  filmstrip: [0, 1, 2, 3].map((i) => box(3 + i * 15, 8, 13, 24)).join(''),
  collage: `${box(4, 4, 26, 18)}${box(34, 4, 26, 12)}${box(34, 20, 26, 16)}${box(4, 26, 26, 10)}`,
  split: `${box(4, 6, 27, 28)}${box(33, 6, 27, 28)}`,
  clothesline: `${box(2, 6, 60, 2)}${box(6, 10, 14, 18)}${box(25, 10, 14, 22)}${box(44, 10, 14, 16)}`,
}

export function LayoutThumb({ name }: { readonly name: LayoutThumbName }) {
  return (
    <svg className={styles['thumb']} viewBox="0 0 64 40" aria-hidden="true" focusable="false">
      <path d={SHAPES[name]} />
      {name === 'polaroid' ? <path className={styles['hole']} d={box(20, 7, 24, 20)} /> : null}
    </svg>
  )
}
