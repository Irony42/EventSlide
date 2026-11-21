import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../../design-system/components/Button'
import { cx } from '../../../../design-system/classNames'
import { Field } from '../../../../design-system/components/Field'
import { Textarea } from '../../../../design-system/components/Textarea'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { SHORT_MESSAGE_MAX, graphemeCount, graphemesOf } from '../../../../lib/invite/cardTexts'
import { PRINT_SWATCHES, PRINT_SWATCH_IDS } from '../../../../lib/print/printColours'
import {
  INVITATION_DESIGNS,
  isInvitationDesign,
  invitationUsesPhoto,
  inkLoadOf,
  invitationQrShareOf,
} from '../../../../lib/print/printDesigns'
import { Notice } from '../../../../design-system/components/Notice'
import { DesignPicker, PhotoControls } from '../../print/PrintCardControls'
import { readPrintPhoto, writePrintPhoto } from '../../print/printPhoto'
import { PrintSheet } from '../../print/PrintSheet'
import { isHexColour, isQrTooSmall } from '../../print/printKit'
import { usePrintPageRule } from '../../print/usePrintPageRule'
import {
  INVITE_FORMATS,
  readInvitePreferences,
  writeInvitePreferences,
  type InvitePreferences,
} from './invitePreferences'
import { inviteCardOf } from './inviteCard'
import type { InvitationTabProps } from './tabProps'
import styles from './PrintTab.module.css'

/**
 * The "Imprimer" tab: the invitation card, A6 four to a sheet or A5 two to a sheet (spec 29, PR 4).
 *
 * Surface: the host's paper. The card is read in the **language and the zone of the invitation**,
 * not the console's, and the QR leads to the invitation's own link. The address **is printed**:
 * paper goes to the guests the host chose, and the help line says so. Choices are kept on this
 * device only (`eventslide.invite.<slug>`).
 */
export function PrintTab({ event, invite }: InvitationTabProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const slug = event.slug
  const [preferences, setPreferences] = useState<InvitePreferences>(() =>
    readInvitePreferences(slug),
  )
  const [totalModules, setTotalModules] = useState<number | null>(null)
  usePrintPageRule()

  const [photoUrl, setPhotoUrl] = useState<string | null>(() => readPrintPhoto(slug))
  const [photoKept, setPhotoKept] = useState(true)

  // A slider moves a hundred times a second: the screen follows at once, the storage once it rests.
  const pending = useRef<InvitePreferences | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const flush = () => {
    window.clearTimeout(timer.current)
    if (pending.current === null) return
    writeInvitePreferences(slug, pending.current)
    pending.current = null
  }
  // Leaving the page writes what the slider last said.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (pending.current !== null) writeInvitePreferences(slug, pending.current)
    },
    [slug],
  )

  const update = (next: InvitePreferences) => {
    setPreferences(next)
    pending.current = next
    flush()
  }

  const updateFocus = (next: InvitePreferences) => {
    setPreferences(next)
    pending.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 300)
  }

  const choosePhoto = (url: string | null) => {
    setPhotoUrl(url)
    setPhotoKept(writePrintPhoto(slug, url))
  }

  const view = inviteCardOf(event, invite, preferences, { showAddress: true })
  const { lang, format, design, focusX, focusY, eventColour, chosen, hue, auto, isAuto, shown } =
    view

  const setShort = (value: string) => {
    const { short: _dropped, ...rest } = preferences
    const kept = graphemesOf(value).slice(0, SHORT_MESSAGE_MAX).join('')
    // An emptied field is the host's choice of no word at all, not a return to the automatic cut.
    update(kept === auto ? rest : { ...rest, short: kept })
  }

  const resetShort = () => {
    const { short: _dropped, ...rest } = preferences
    update(rest)
  }

  const setColour = (colour: string | null) => {
    const { colour: _dropped, ...rest } = preferences
    update(colour === null ? rest : { ...rest, colour })
  }

  const { texts, invitation } = view

  const custom = chosen !== null && !Object.values(PRINT_SWATCHES).includes(chosen as never)

  return (
    <div className={styles['tab']} data-invite-sheet>
      <div className={styles['controls']}>
        <DesignPicker
          design={design}
          onDesign={(chosenDesign) => {
            if (isInvitationDesign(chosenDesign)) update({ ...preferences, design: chosenDesign })
          }}
          previewTexts={texts}
          steps={false}
          photoUrl={photoUrl}
          focusX={focusX}
          focusY={focusY}
          accentHue={hue}
          colour={chosen}
          eventColour={eventColour}
          locale={lang}
          designs={INVITATION_DESIGNS}
          invitation={invitation}
          name="invite-design"
        />
        {inkLoadOf(design) === 'high' ? (
          <Notice tone="neutral" role="status" variant="boxed">
            {t.admin.printKitInkHeavy}
          </Notice>
        ) : null}

        <fieldset className={styles['group']}>
          <legend className={styles['legend']}>{text.printFormatLegend}</legend>
          {INVITE_FORMATS.map((choice) => (
            <label key={choice} className={styles['radio']}>
              <input
                type="radio"
                name="invite-format"
                value={choice}
                checked={format === choice}
                onChange={() => update({ ...preferences, format: choice })}
              />
              {choice === 'card' ? text.printFormatCard : text.printFormatA5}
            </label>
          ))}
          <p className={styles['help']}>{text.printA5Help}</p>
        </fieldset>

        <fieldset className={styles['group']}>
          <legend className={styles['legend']}>{t.admin.printKitColour}</legend>
          <div className={styles['swatches']}>
            <label className={styles['swatch']} title={t.admin.printKitColourEvent}>
              <input
                type="radio"
                name="invite-colour"
                checked={chosen === null}
                onChange={() => setColour(null)}
                aria-label={t.admin.printKitColourEvent}
              />
              <span className={styles['dot']} style={{ background: eventColour }} />
            </label>
            {PRINT_SWATCH_IDS.map((id) => (
              <label key={id} className={styles['swatch']} title={t.admin.printSwatchNames[id]}>
                <input
                  type="radio"
                  name="invite-colour"
                  checked={chosen === PRINT_SWATCHES[id]}
                  onChange={() => setColour(PRINT_SWATCHES[id])}
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
                value={chosen ?? PRINT_SWATCHES.coral}
                aria-label={t.admin.printKitColourCustom}
                onChange={(e) => {
                  if (isHexColour(e.target.value)) setColour(e.target.value.toLowerCase())
                }}
              />
            </label>
          </div>
        </fieldset>

        {invitationUsesPhoto(design) ? (
          <PhotoControls
            photoUrl={photoUrl}
            onPhoto={choosePhoto}
            focusX={focusX}
            focusY={focusY}
            onFocus={(axis, value) => updateFocus({ ...preferences, [axis]: value })}
            hint={text.photoHint}
            notKept={photoKept ? undefined : text.photoNotKept}
          />
        ) : null}

        <Field label={text.shortLabel} hint={text.shortHint}>
          {(control) => (
            <>
              <Textarea
                {...control}
                rows={4}
                grow={false}
                value={shown}
                onChange={(e) => setShort(e.target.value)}
              />
              <p className={styles['count']}>
                <span>{text.shortCount(graphemeCount(shown), SHORT_MESSAGE_MAX)}</span>
                {isAuto ? <span className={styles['auto']}>{text.shortAuto}</span> : null}
              </p>
              {isAuto ? null : (
                <button type="button" className={styles['reset']} onClick={resetShort}>
                  {text.shortReset}
                </button>
              )}
            </>
          )}
        </Field>

        {totalModules !== null &&
        isQrTooSmall(format, invitationQrShareOf(design), totalModules) ? (
          <Notice tone="warning" role="status" variant="boxed">
            {t.admin.printKitLongLink}
          </Notice>
        ) : null}

        <Button variant="primary" onClick={() => window.print()}>
          {text.printButton}
        </Button>
        <p className={styles['help']}>{text.printHelp}</p>
      </div>

      <section className={styles['preview']} aria-label={text.previewLabel}>
        <PrintSheet
          eventName={event.name}
          joinUrl={invite.url}
          joinCode=""
          format={format}
          locale={lang}
          ink="black"
          accentHue={hue}
          colour={chosen ?? eventColour}
          design={design}
          onQrModules={setTotalModules}
          texts={texts}
          steps={false}
          photoUrl={photoUrl}
          focusX={focusX}
          focusY={focusY}
          invitation={invitation}
        />
      </section>
    </div>
  )
}
