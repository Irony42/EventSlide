import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { TextInput } from '../../../design-system/components/TextInput'
import { Textarea } from '../../../design-system/components/Textarea'
import { cx } from '../../../design-system/classNames'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { Locale } from '../../../lib/i18n/locale'
import { PrintCard, type PrintCardInvitation, type PrintCardTexts } from './PrintCard'
import { PRINT_SWATCHES, PRINT_SWATCH_IDS } from '../../../lib/print/printColours'
import {
  PRINT_DESIGNS,
  PRINT_TEXT_LIMITS,
  inkLoadOf,
  type PrintDesign,
  type PrintTextField,
} from '../../../lib/print/printDesigns'
import { isHexColour } from './printKit'
import { preparePrintPhoto } from './printPhoto'
import { useFitText } from './useFitText'
import styles from './PrintCardControls.module.css'

export interface PrintCardControlsProps {
  readonly design: PrintDesign
  readonly onDesign: (design: PrintDesign) => void
  /** What the host typed, field by field; an absent field prints its default. */
  readonly texts: Partial<Record<PrintTextField, string>>
  readonly onText: (field: PrintTextField, value: string) => void
  readonly eventName: string
  readonly steps: boolean
  readonly onSteps: (steps: boolean) => void
  readonly photoUrl: string | null
  readonly onPhoto: (url: string | null) => void
  readonly focusX: number
  readonly focusY: number
  readonly onFocus: (axis: 'focusX' | 'focusY', value: number) => void
  /** `null` is the event's own colour. */
  readonly colour: string | null
  readonly onColour: (colour: string | null) => void
  /** The event's colour as CSS, for its swatch and the previews. */
  readonly eventColour: string
  readonly accentHue: number
  /** The language the thumbnails speak: the evening's, as the sheet does. */
  readonly locale: Locale
  /** The resolved words, so the thumbnails show the host's own card. */
  readonly previewTexts: PrintCardTexts
}

const FIELDS: readonly PrintTextField[] = ['title', 'tagline', 'note', 'date', 'table']

/**
 * What the host chooses about the card itself (spec 28): the design, the words, a photograph, the
 * colour. Components render and dispatch: every value goes up through a callback, the page keeps
 * and stores it.
 */
export function PrintCardControls(props: PrintCardControlsProps) {
  const t = useTranslations()
  const labels: Readonly<Record<PrintTextField, { label: string; hint?: string }>> = {
    title: { label: t.admin.printKitTitleField, hint: t.admin.printKitTitleHint },
    tagline: { label: t.admin.printKitTagline },
    note: { label: t.admin.printKitNote, hint: t.admin.printKitOptional },
    date: { label: t.admin.printKitDate, hint: t.admin.printKitOptional },
    table: { label: t.admin.printKitTable, hint: t.admin.printKitTableHint },
  }
  const placeholders: Readonly<Record<PrintTextField, string>> = {
    title: props.eventName,
    tagline: props.previewTexts.tagline ?? t.printKit.title,
    note: '',
    date: t.admin.printKitDateExample,
    table: '',
  }

  return (
    <>
      <DesignPicker {...props} />
      {inkLoadOf(props.design) === 'high' ? (
        <Notice tone="neutral" role="status" variant="boxed">
          {t.admin.printKitInkHeavy}
        </Notice>
      ) : null}

      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t.admin.printKitTexts}</legend>
        {FIELDS.map((field) => (
          <Field
            key={field}
            label={labels[field].label}
            {...(labels[field].hint === undefined ? {} : { hint: labels[field].hint })}
          >
            {(control) =>
              field === 'note' ? (
                <Textarea
                  {...control}
                  rows={2}
                  maxLength={PRINT_TEXT_LIMITS[field]}
                  value={props.texts[field] ?? ''}
                  onChange={(event) => props.onText(field, event.target.value)}
                />
              ) : (
                <TextInput
                  {...control}
                  maxLength={PRINT_TEXT_LIMITS[field]}
                  placeholder={placeholders[field]}
                  value={props.texts[field] ?? ''}
                  onChange={(event) => props.onText(field, event.target.value)}
                />
              )
            }
          </Field>
        ))}
        <CheckboxField
          label={t.admin.printKitSteps}
          checked={props.steps}
          onChange={props.onSteps}
        />
      </fieldset>

      <PhotoControls {...props} />
      <ColourPicker {...props} />
    </>
  )
}

/** What a design picker needs; the table-card page gives it the whole of its props. */
export type DesignPickerProps = Pick<
  PrintCardControlsProps,
  | 'design'
  | 'onDesign'
  | 'previewTexts'
  | 'steps'
  | 'photoUrl'
  | 'focusX'
  | 'focusY'
  | 'accentHue'
  | 'colour'
  | 'eventColour'
  | 'locale'
> & {
  /** The designs offered, in order: all fifteen by default. */
  readonly designs?: readonly PrintDesign[]
  /** Set for an invitation: the thumbnails then show the invitation layouts. */
  readonly invitation?: PrintCardInvitation | undefined
  readonly name?: string
}

export function DesignPicker({
  design,
  onDesign,
  previewTexts,
  steps,
  photoUrl,
  focusX,
  focusY,
  accentHue,
  colour,
  eventColour,
  locale,
  designs = PRINT_DESIGNS,
  invitation,
  name = 'print-design',
}: DesignPickerProps) {
  const t = useTranslations()
  const root = useRef<HTMLDivElement>(null)
  useFitText(
    root,
    `${JSON.stringify(previewTexts)}|${JSON.stringify(invitation)}|${photoUrl === null}|${locale}`,
  )
  const style = {
    '--accent-hue': String(accentHue),
    '--pd-color': colour ?? eventColour,
  } as CSSProperties
  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{t.admin.printKitDesign}</legend>
      <div ref={root} className={styles['designs']} style={style}>
        <LocaleOverride locale={locale}>
          {designs.map((choice) => (
            <label
              key={choice}
              className={cx(styles['design'], choice === design && styles['chosen'])}
            >
              <input
                type="radio"
                name={name}
                value={choice}
                checked={choice === design}
                onChange={() => onDesign(choice)}
                className={styles['designInput']}
              />
              <span className={styles['thumb']} aria-hidden="true">
                <PrintCard
                  design={choice}
                  texts={previewTexts}
                  steps={steps}
                  photoUrl={photoUrl}
                  focusX={focusX}
                  focusY={focusY}
                  joinCode="ABC123"
                  address={null}
                  invitation={invitation}
                  qr={<span className={styles['qrStandIn']} />}
                />
              </span>
              <span className={styles['designName']}>{t.admin.printDesignNames[choice]}</span>
            </label>
          ))}
        </LocaleOverride>
      </div>
    </fieldset>
  )
}

export function PhotoControls({
  photoUrl,
  onPhoto,
  focusX,
  focusY,
  onFocus,
  hint,
}: Pick<PrintCardControlsProps, 'photoUrl' | 'onPhoto' | 'focusX' | 'focusY' | 'onFocus'> & {
  /** Replaces the table card's sentence about where the photo stays. */
  readonly hint?: string
}) {
  const t = useTranslations()
  const input = useRef<HTMLInputElement>(null)
  const [failed, setFailed] = useState(false)

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    const url = await preparePrintPhoto(file)
    setFailed(url === null)
    if (url !== null) onPhoto(url)
  }

  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{t.admin.printKitPhoto}</legend>
      <p className={styles['help']}>{hint ?? t.admin.printKitPhotoHint}</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className={styles['file']}
        data-testid="print-photo-input"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={t.admin.printKitPhotoChoose}
        onChange={(event) => void choose(event)}
      />
      <div className={styles['row']}>
        <Button onClick={() => input.current?.click()}>{t.admin.printKitPhotoChoose}</Button>
        {photoUrl === null ? null : (
          <Button onClick={() => onPhoto(null)}>{t.admin.printKitPhotoRemove}</Button>
        )}
      </div>
      {failed ? (
        <Notice tone="warning" role="alert" variant="boxed">
          {t.admin.printKitPhotoFailed}
        </Notice>
      ) : null}
      {photoUrl === null ? null : (
        <>
          <label className={styles['range']}>
            {t.admin.printKitFocusX}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={focusX}
              onChange={(event) => onFocus('focusX', Number(event.target.value))}
            />
          </label>
          <label className={styles['range']}>
            {t.admin.printKitFocusY}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={focusY}
              onChange={(event) => onFocus('focusY', Number(event.target.value))}
            />
          </label>
        </>
      )}
    </fieldset>
  )
}

function ColourPicker({ colour, onColour, eventColour }: PrintCardControlsProps) {
  const t = useTranslations()
  const custom = colour !== null && !Object.values(PRINT_SWATCHES).includes(colour as never)
  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{t.admin.printKitColour}</legend>
      <div className={styles['swatches']}>
        <label className={styles['swatch']} title={t.admin.printKitColourEvent}>
          <input
            type="radio"
            name="print-colour"
            checked={colour === null}
            onChange={() => onColour(null)}
            aria-label={t.admin.printKitColourEvent}
          />
          <span className={styles['dot']} style={{ background: eventColour }} />
        </label>
        {PRINT_SWATCH_IDS.map((id) => (
          <label key={id} className={styles['swatch']} title={t.admin.printSwatchNames[id]}>
            <input
              type="radio"
              name="print-colour"
              checked={colour === PRINT_SWATCHES[id]}
              onChange={() => onColour(PRINT_SWATCHES[id])}
              aria-label={t.admin.printSwatchNames[id]}
            />
            <span className={styles['dot']} style={{ background: PRINT_SWATCHES[id] }} />
          </label>
        ))}
        <label
          className={cx(styles['swatch'], styles['customSwatch'], custom && styles['customOn'])}
          title={t.admin.printKitColourCustom}
        >
          <input
            type="color"
            value={colour ?? PRINT_SWATCHES.coral}
            aria-label={t.admin.printKitColourCustom}
            onChange={(event) => {
              if (isHexColour(event.target.value)) onColour(event.target.value.toLowerCase())
            }}
          />
        </label>
      </div>
    </fieldset>
  )
}
