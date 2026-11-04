import { useId } from 'react'
import { Icon } from '../../../../design-system/components/Icon'
import type { WallLayout } from '../../../../lib/api/dto'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { LayoutThumb, type LayoutThumbName } from './LayoutThumb'
import styles from './controls.module.css'

export interface LayoutTilesProps {
  /** `null`: the event does not choose, each screen does. */
  readonly value: WallLayout | null
  readonly onChange: (layout: WallLayout | null) => void
}

/**
 * The layout, as one tile per disposition drawn as the room sees it, plus « Au choix de chaque
 * écran ». A radio group: the names are the same words the select used, and the keys are the
 * arrows. The chosen tile carries a check and an accent edge, never the tint alone.
 */
export function LayoutTiles({ value, onChange }: LayoutTilesProps) {
  const t = useTranslations()
  const name = useId()
  const layouts = Object.keys(t.wall.layoutNames) as WallLayout[]
  const tiles: readonly (readonly [LayoutThumbName, string, WallLayout | null])[] = [
    ['auto', t.admin.wallDisplay.layoutUnset, null],
    ...layouts.map((layout) => [layout, t.wall.layoutNames[layout], layout] as const),
  ]

  return (
    <fieldset className={styles['field']}>
      <legend className={styles['legend']}>{t.admin.wallDisplay.layout}</legend>
      <div className={styles['tiles']}>
        {tiles.map(([thumb, label, layout]) => (
          <label key={thumb} className={styles['tile']}>
            <input
              type="radio"
              className={styles['input']}
              name={name}
              checked={value === layout}
              onChange={() => onChange(layout)}
            />
            <LayoutThumb name={thumb} />
            <span>{label}</span>
            <Icon name="check" size="sm" className={styles['check']} />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
