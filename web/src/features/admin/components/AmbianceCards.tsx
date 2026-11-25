import { useId } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../../design-system/classNames'
import { Icon } from '../../../design-system/components/Icon'
import { THEME_AMBIANCES } from '../../../design-system/eventTheme'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './AmbianceCards.module.css'
import type { ThemeAmbiance } from '../../../lib/api/dto'

/** The ambiances a card picks: « Sur mesure » is a link to its own page, never a plain option. */
type PlainAmbiance = Exclude<ThemeAmbiance, 'custom'>

export interface AmbianceCardsProps {
  /** The ambiance the event wears now. */
  readonly value: ThemeAmbiance
  readonly disabled: boolean
  /** Where the editor of the host's own ambiance is; the link is withheld while the page is read-only. */
  readonly customAmbiancePath: string
  /** Never called with `custom`: its object is made on its own page (ADR 0011). */
  readonly onChange: (ambiance: PlainAmbiance) => void
}

const PLAIN: readonly PlainAmbiance[] = THEME_AMBIANCES.filter(
  (ambiance): ambiance is PlainAmbiance => ambiance !== 'custom',
)

/**
 * The ambiances as a grid of pictures (Pierre, 25/11, mock-up B1 « Atelier »): each card is the
 * ambiance's own ground, drawn through the real tokens with its name in its own display face, and
 * under it a name, one sentence and who it is for. A choice is a real radio, so the arrow keys move
 * it, and it is shown by an outline **and** a check mark, never by colour alone.
 *
 * Surface: the host's laptop or phone, before the event.
 *
 * The picture wears the ambiance through `data-event-ambiance`, as a template preview does, and
 * `data-template-preview` keeps the console around it on the event's own look: a card never
 * re-themes the page it is a choice on. Its colours, ground and face are those tokens and nothing
 * is written here. « Sur mesure » is the last card and a link: choosing it needs its object, which
 * only its page makes (the server refuses `custom` without one), so it can be neither a radio nor a
 * silent `PATCH`.
 */
export function AmbianceCards({
  value,
  disabled,
  customAmbiancePath,
  onChange,
}: AmbianceCardsProps) {
  const t = useTranslations()
  const group = useId()
  const names = t.admin.themeAmbianceNames
  const copy = t.admin.appearance
  const isCustom = value === 'custom'

  return (
    <fieldset className={styles['cards']}>
      <legend className="visually-hidden">{copy.ambianceTitle}</legend>
      {PLAIN.map((ambiance) => {
        const nameId = `${group}-${ambiance}-name`
        const textId = `${group}-${ambiance}-text`
        return (
          <label key={ambiance} className={styles['card']}>
            <input
              type="radio"
              className={styles['input']}
              name={group}
              value={ambiance}
              checked={value === ambiance}
              disabled={disabled}
              aria-labelledby={nameId}
              aria-describedby={textId}
              onChange={() => onChange(ambiance)}
            />
            <span
              className={styles['picture']}
              aria-hidden="true"
              data-event-ambiance={ambiance}
              data-template-preview="ambiance-card"
            >
              <span className={styles['display']}>{names[ambiance]}</span>
            </span>
            <span className={styles['tick']} aria-hidden="true">
              <Icon name="check" size="sm" />
            </span>
            <span className={styles['text']}>
              <b id={nameId} className={styles['name']}>
                {names[ambiance]}
              </b>
              <span id={textId}>
                {copy.sentences[ambiance]}{' '}
                <span className={styles['for']}>{copy.audience(copy.audiences[ambiance])}</span>
              </span>
            </span>
          </label>
        )
      })}

      {/* Not an option of the group: it leads to the page that makes the host's own ambiance. */}
      {disabled ? (
        <span className={cx(styles['card'], styles['custom'], styles['inert'])}>
          <CustomPicture current={isCustom} />
          <span className={styles['text']}>
            <b className={styles['name']}>
              {names['custom']}
              {/* The tick says it to the eye; this says it to a screen reader, on a page read-only. */}
              {isCustom ? <span className="visually-hidden"> {copy.currentAmbiance}</span> : null}
            </b>
            <span>{copy.sentences['custom']}</span>
          </span>
        </span>
      ) : (
        <Link
          to={customAmbiancePath}
          className={cx(styles['card'], styles['custom'], isCustom && styles['current'])}
          aria-current={isCustom ? 'true' : undefined}
        >
          <CustomPicture current={isCustom} />
          <span className={styles['text']}>
            <b className={styles['name']}>{names['custom']}</b>
            <span>
              {copy.sentences['custom']}{' '}
              <span className={styles['for']}>
                {isCustom ? t.admin.customAmbianceEdit : copy.customCardAction}
              </span>
            </span>
          </span>
        </Link>
      )}
    </fieldset>
  )
}

function CustomPicture({ current }: { readonly current: boolean }) {
  return (
    <>
      <span className={cx(styles['picture'], styles['stripes'])} aria-hidden="true">
        <Icon name="palette" />
      </span>
      {current ? (
        <span className={styles['tick']} aria-hidden="true">
          <Icon name="check" size="sm" />
        </span>
      ) : null}
    </>
  )
}
