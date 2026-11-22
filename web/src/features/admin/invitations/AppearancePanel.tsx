import type { EventDto } from '../../../lib/api/dto'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { PRINT_SWATCHES, PRINT_SWATCH_IDS } from '../../../lib/print/printColours'
import {
  INVITATION_DESIGNS,
  invitationUsesPhoto,
  isInvitationDesign,
} from '../../../lib/print/printDesigns'
import { DesignPicker, PhotoControls } from '../print/PrintCardControls'
import { isHexColour } from '../print/printKit'
import { inviteCardOf } from './tabs/inviteCard'
import type { InvitationTabProps } from './tabs/tabProps'
import type { InviteLook } from './useInvitePreferences'
import styles from './AppearancePanel.module.css'

export interface AppearancePanelProps {
  readonly event: EventDto
  /** The invitation as it is being written, once it can be shown. */
  readonly invite: InvitationTabProps['invite']
  readonly look: InviteLook
}

/**
 * "L'apparence": the model, the colour and the photograph, set **once** for the card and the image
 * (they were in the print tab, and the image borrowed them from there). Each choice is on the
 * preview at once and kept on this device.
 */
export function AppearancePanel({ event, invite, look }: AppearancePanelProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const { preferences, update, updateSoft, photoUrl, photoKept, choosePhoto } = look
  const view = inviteCardOf(event, invite, preferences, { showAddress: true })
  const { lang, design, focusX, focusY, eventColour, chosen, hue, texts, invitation } = view

  const setColour = (colour: string | null) => {
    const { colour: _dropped, ...rest } = preferences
    update(colour === null ? rest : { ...rest, colour })
  }
  const custom = chosen !== null && !Object.values(PRINT_SWATCHES).includes(chosen as never)

  return (
    <div className={styles['group']}>
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
          onFocus={(axis, value) => updateSoft({ ...preferences, [axis]: value })}
          hint={text.photoHint}
          notKept={photoKept ? undefined : text.photoNotKept}
        />
      ) : null}
    </div>
  )
}
