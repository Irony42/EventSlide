import type { EventDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  INVITATION_DESIGNS,
  invitationUsesPhoto,
  isInvitationDesign,
} from '../../../lib/print/printDesigns'
import { DesignPicker, PhotoControls } from '../print/PrintCardControls'
import { inviteCardOf } from './tabs/inviteCard'
import type { InvitationTabProps } from './tabs/tabProps'
import type { InviteLook } from './useInvitePreferences'
import { CardColourPicker } from './CardColourPicker'
import { Disclosure } from './Disclosure'
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

      <CardColourPicker chosen={chosen} eventColour={eventColour} onColour={setColour} />

      {invitationUsesPhoto(design) ? (
        <Disclosure
          id="photo"
          title={t.admin.printKitPhoto}
          summary={photoUrl === null ? text.photoNone : text.photoChosen}
        >
          <PhotoControls
            photoUrl={photoUrl}
            onPhoto={choosePhoto}
            focusX={focusX}
            focusY={focusY}
            onFocus={(axis, value) => updateSoft({ ...preferences, [axis]: value })}
            hint={text.photoHint}
            notKept={photoKept ? undefined : text.photoNotKept}
          />
        </Disclosure>
      ) : null}
    </div>
  )
}
