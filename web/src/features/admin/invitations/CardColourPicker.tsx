import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../../../design-system/classNames'
import { Icon } from '../../../design-system/components/Icon'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { PRINT_SWATCHES, PRINT_SWATCH_IDS } from '../../../lib/print/printColours'
import { isHexColour } from '../print/printKit'
import styles from './CardColourPicker.module.css'

/** How many swatches the row shows; the rest are one tap away, in the popover. */
export const ROW_SIZE = 6

interface Entry {
  readonly name: string
  readonly hex: string
  /** What is handed to `onColour`: `null` is the event's own colour. */
  readonly value: string | null
}

export interface CardColourPickerProps {
  /** The chosen colour: `null` is the event's own. */
  readonly chosen: string | null
  readonly eventColour: string
  readonly onColour: (colour: string | null) => void
}

/**
 * The colour of the card: **one row of six swatches** and a "+6" that opens the rest in a popover
 * (the twelve colours and a free picker), instead of a column of thirteen. The chosen one is
 * marked by an outline **and a check** (never by its colour alone) and named above the row; it is
 * always in the row, taking the last place when it lives in the popover. Arrows move between the
 * swatches and choose, a choice made in the popover closes it, Escape closes it and gives the focus
 * back to the "+6".
 */
export function CardColourPicker({ chosen, eventColour, onColour }: CardColourPickerProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const ids = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)

  const entries: readonly Entry[] = [
    { name: t.admin.printKitColourEvent, hex: eventColour, value: null },
    ...PRINT_SWATCH_IDS.map((id) => ({
      name: t.admin.printSwatchNames[id],
      hex: PRINT_SWATCHES[id] as string,
      value: PRINT_SWATCHES[id] as string,
    })),
  ]
  const index = chosen === null ? 0 : entries.findIndex((entry) => entry.value === chosen)
  const custom: Entry | null =
    index === -1 && chosen !== null
      ? { name: t.admin.printKitColourCustom, hex: chosen, value: chosen }
      : null
  const current: Entry | undefined = custom ?? entries[Math.max(index, 0)]
  // The chosen colour is always on the row: it takes the last place when it is further on.
  const row: readonly Entry[] =
    custom !== null
      ? [...entries.slice(0, ROW_SIZE - 1), custom]
      : index >= ROW_SIZE
        ? [...entries.slice(0, ROW_SIZE - 1), entries[index] as Entry]
        : entries.slice(0, ROW_SIZE)
  const hidden = entries.length - ROW_SIZE

  const close = (giveFocusBack: boolean) => {
    setOpen(false)
    if (giveFocusBack) more.current?.focus()
  }

  // A press elsewhere closes the popover; the focus stays where the person put it.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Opened: the focus goes to the chosen colour of the popover.
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[data-grid] [role="radio"][tabindex="0"]')?.focus()
    // The column scrolls: the popover is brought into view, not left under its edge.
    root.current
      ?.querySelector<HTMLElement>('[data-popover]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [open])

  /** Arrows choose the neighbour (wrapping) and keep the focus on it. */
  const move = (list: readonly Entry[], from: number, event: KeyboardEvent<HTMLElement>) => {
    const key = event.key
    const step =
      key === 'ArrowRight' || key === 'ArrowDown'
        ? 1
        : key === 'ArrowLeft' || key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0 && key !== 'Home' && key !== 'End') return
    event.preventDefault()
    const target =
      key === 'Home'
        ? list[0]
        : key === 'End'
          ? list[list.length - 1]
          : list[(from + step + list.length) % list.length]
    if (target === undefined) return
    onColour(target.value)
    const group = event.currentTarget.closest('[role="radiogroup"]')
    // The swatches are drawn again for their new state: the focus follows once they are.
    requestAnimationFrame(() => {
      group?.querySelector<HTMLElement>(`[data-colour="${target.hex}"]`)?.focus()
    })
  }

  const swatch = (entry: Entry, list: readonly Entry[], at: number, inPopover: boolean) => {
    const on = current !== undefined && entry.hex === current.hex && entry.value === current.value
    return (
      <button
        key={`${inPopover ? 'all' : 'row'}-${entry.hex}-${at}`}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={entry.name}
        title={entry.name}
        data-colour={entry.hex}
        tabIndex={on ? 0 : -1}
        className={cx(styles['swatch'], on && styles['on'])}
        onClick={() => {
          onColour(entry.value)
          if (inPopover) close(true)
        }}
        onKeyDown={(event) => move(list, at, event)}
      >
        <span className={styles['dot']} style={{ background: entry.hex }} />
        {on ? (
          <span className={styles['check']}>
            <Icon name="check" size="sm" />
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <div
      ref={root}
      className={styles['root']}
      onBlur={(event) => {
        // The focus went elsewhere on the page (Tab past the popover): it closes, the focus stays there.
        const next = event.relatedTarget
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close(true)
        }
      }}
    >
      <p className={styles['label']} id={`${ids}-label`}>
        {t.admin.printKitColour}
        <span className={styles['name']}>{current?.name}</span>
      </p>
      <div className={styles['row']}>
        <div role="radiogroup" aria-labelledby={`${ids}-label`} className={styles['swatches']}>
          {row.map((entry, at) => swatch(entry, row, at, false))}
        </div>
        <button
          ref={more}
          type="button"
          className={styles['more']}
          aria-expanded={open}
          aria-controls={`${ids}-all`}
          aria-label={text.colourMore}
          onClick={() => setOpen((now) => !now)}
        >
          {`+${hidden}`}
        </button>
      </div>
      {open ? (
        <div id={`${ids}-all`} className={styles['popover']} data-popover>
          <div role="radiogroup" aria-label={text.colourAll} className={styles['grid']} data-grid>
            {entries.map((entry, at) => swatch(entry, entries, at, true))}
          </div>
          <label className={styles['custom']}>
            {t.admin.printKitColourCustom}
            <input
              type="color"
              value={chosen ?? PRINT_SWATCHES.coral}
              onChange={(event) => {
                if (isHexColour(event.target.value)) onColour(event.target.value.toLowerCase())
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
