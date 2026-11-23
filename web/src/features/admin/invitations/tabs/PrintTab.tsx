import { useCallback, useState } from 'react'
import { Button } from '../../../../design-system/components/Button'
import { Field } from '../../../../design-system/components/Field'
import { Notice } from '../../../../design-system/components/Notice'
import { Textarea } from '../../../../design-system/components/Textarea'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { householdLink } from '../../../../lib/rsvp/households'
import { useApi } from '../../../../lib/useApi'
import { useLoader } from '../../../../lib/useLoader'
import { SHORT_MESSAGE_MAX, graphemeCount, graphemesOf } from '../../../../lib/invite/cardTexts'
import { inkLoadOf, invitationQrShareOf } from '../../../../lib/print/printDesigns'
import { PrintSheet } from '../../print/PrintSheet'
import { PRINT_FORMAT_SPECS, isQrTooSmall } from '../../print/printKit'
import { usePrintPageRule } from '../../print/usePrintPageRule'
import { INVITE_FORMATS } from './invitePreferences'
import { inviteCardOf } from './inviteCard'
import { PreviewBox } from './PreviewBox'
import type { OutputProps } from './tabProps'
import styles from './PrintTab.module.css'

/**
 * The printed card: A6 four to a sheet or A5 two to a sheet (spec 29, PR 4). It hands the page two
 * halves, the sheet for the middle and its options (format, word, the print button) for the right.
 * The design, colour and photo are the page's (`AppearancePanel`), shared with the image.
 *
 * Surface: the host's paper. The card is read in the **language and the zone of the invitation**,
 * not the console's, and the QR leads to the invitation's own link. The address **is printed**:
 * paper goes to the guests the host chose, and the help line says so.
 */
export function PrintTab({
  event,
  invite,
  preferences,
  onPreferences,
  photoUrl,
  children,
}: OutputProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const [totalModules, setTotalModules] = useState<number | null>(null)
  usePrintPageRule()

  // The guest list (spec 30, lot 3): when the host listed households, a card can be printed for each one.
  const api = useApi()
  const loadHouseholds = useCallback(
    (signal: AbortSignal) => api.households(event.slug, signal),
    [api, event.slug],
  )
  const households = useLoader(loadHouseholds).data?.households ?? []
  const [perHousehold, setPerHousehold] = useState(false)

  const view = inviteCardOf(event, invite, preferences, { showAddress: true })
  const { lang, format, design, focusX, focusY, eventColour, chosen, hue, auto, isAuto, shown } =
    view
  const { texts, invitation } = view

  const setShort = (value: string) => {
    const { short: _dropped, ...rest } = preferences
    const kept = graphemesOf(value).slice(0, SHORT_MESSAGE_MAX).join('')
    // An emptied field is the host's choice of no word at all, not a return to the automatic cut.
    onPreferences(kept === auto ? rest : { ...rest, short: kept })
  }

  const resetShort = () => {
    const { short: _dropped, ...rest } = preferences
    onPreferences(rest)
  }

  const options = (
    <div className={styles['controls']}>
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
              onChange={() => onPreferences({ ...preferences, format: choice })}
            />
            {choice === 'card' ? text.printFormatCard : text.printFormatA5}
          </label>
        ))}
        <p className={styles['help']}>{text.printA5Help}</p>
      </fieldset>

      {households.length === 0 ? null : (
        <div className={styles['group']}>
          <label className={styles['radio']}>
            <input
              type="checkbox"
              name="invite-per-household"
              checked={perHousehold}
              onChange={(e) => setPerHousehold(e.target.checked)}
            />
            {text.printPerHousehold}
          </label>
          {perHousehold ? (
            <>
              <p className={styles['help']}>
                {text.printPerHouseholdHint(
                  households.length,
                  Math.ceil(households.length / PRINT_FORMAT_SPECS[format].perSheet),
                )}
              </p>
              <Notice tone="warning" role="status" variant="boxed">
                {text.printPerHouseholdPrivacy}
              </Notice>
              <p className={styles['help']}>{text.printPerHouseholdPreview}</p>
            </>
          ) : null}
        </div>
      )}

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

      {totalModules !== null && isQrTooSmall(format, invitationQrShareOf(design), totalModules) ? (
        <Notice tone="warning" role="status" variant="boxed">
          {t.admin.printKitLongLink}
        </Notice>
      ) : null}

      <p className={styles['help']}>{text.printHelp}</p>
    </div>
  )

  const actions = (
    <Button variant="primary" onClick={() => window.print()}>
      {text.printButton}
    </Button>
  )

  const preview = (
    <div className={styles['sheet']} data-invite-sheet>
      <PreviewBox ratio={format === 'a5' ? [297, 210] : [210, 297]} label={text.previewLabel}>
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
          households={
            perHousehold && households.length > 0
              ? households.map((household) => ({
                  id: household.id,
                  name: household.name,
                  url: householdLink(invite.url, household) ?? invite.url,
                }))
              : undefined
          }
        />
      </PreviewBox>
    </div>
  )

  return <>{children({ preview, options, actions })}</>
}
