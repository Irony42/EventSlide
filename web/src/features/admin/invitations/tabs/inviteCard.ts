import type { EventDto } from '../../../../lib/api/dto'
import { parseLocale, type Locale } from '../../../../lib/i18n/locale'
import { translationsFor } from '../../../../lib/i18n/translations'
import { readableLink, shortMessageOf } from '../../../../lib/invite/cardTexts'
import { shortDayLabel, whenParts, type WhenParts } from '../../../../lib/invite/inviteTexts'
import type { PrintCardInvitation, PrintCardTexts } from '../../print/PrintCard'
import { hueOfHex } from '../../print/printKit'
import {
  DEFAULT_INVITE_DESIGN,
  DEFAULT_INVITE_FORMAT,
  type InviteFormat,
  type InvitePreferences,
} from './invitePreferences'
import type { InvitationTabProps } from './tabProps'

/**
 * What the invitation card says and wears, from the invitation and the host's choices on this
 * device (spec 29). One function for the paper and the image, so the two stay one look: the same
 * moment read in the same zone and language, the same short word, the same colour.
 *
 * Pure: no screen, no storage. `address` is the one thing that differs between the two: paper goes
 * to the guests the host chose and prints it, an image is posted where everyone sees it and hides
 * it unless the host says so.
 */
export interface InviteCardView {
  readonly lang: Locale
  readonly zone: string
  readonly when: WhenParts
  readonly design: NonNullable<InvitePreferences['design']>
  readonly format: InviteFormat
  readonly focusX: number
  readonly focusY: number
  /** The event's own colour, as CSS. */
  readonly eventColour: string
  /** The host's `#rrggbb`, or `null` for the event's. */
  readonly chosen: string | null
  /** The colour the card is drawn in. */
  readonly colour: string
  readonly hue: number
  /** The automatic short word, and what the field shows now. */
  readonly auto: string | null
  readonly isAuto: boolean
  readonly shown: string
  readonly texts: PrintCardTexts
  readonly invitation: PrintCardInvitation
}

export const inviteCardOf = (
  event: EventDto,
  invite: InvitationTabProps['invite'],
  preferences: InvitePreferences,
  options: { readonly showAddress: boolean },
): InviteCardView => {
  const lang = parseLocale(invite.language) ?? 'fr'
  const card = translationsFor(lang).guestInvite.card
  const eventHue = event.settings.theme.accentHue
  const eventColour = `oklch(58% 0.14 ${eventHue})`
  const chosen = preferences.colour ?? null

  // Read in the invitation's own zone: the card is for the guests there, not for the host's desk.
  const zone = invite.timeZone ?? 'UTC'
  const when = whenParts(
    { startsAt: invite.startsAt, endsAt: invite.endsAt, timeZone: zone },
    lang,
    zone,
  )
  const auto = shortMessageOf(invite.message)
  const isAuto = preferences.short === undefined
  const shown = isAuto ? (auto ?? '') : (preferences.short ?? '')
  const printed = shortMessageOf(shown)
  const full = shortMessageOf(invite.message, Number.MAX_SAFE_INTEGER)

  return {
    lang,
    zone,
    when,
    design: preferences.design ?? DEFAULT_INVITE_DESIGN,
    format: preferences.format ?? DEFAULT_INVITE_FORMAT,
    focusX: preferences.focusX ?? 50,
    focusY: preferences.focusY ?? 50,
    eventColour,
    chosen,
    colour: chosen ?? eventColour,
    hue: chosen === null ? eventHue : (hueOfHex(chosen) ?? eventHue),
    auto,
    isAuto,
    shown,
    texts: {
      title: invite.title ?? event.name,
      tagline: null,
      note: null,
      date: null,
      table: null,
    },
    invitation: {
      eyebrow: card.eyebrow,
      day: when.day,
      dayShort: shortDayLabel(new Date(invite.startsAt), lang, zone),
      hours: when.hours,
      venue: invite.venueName,
      address: options.showAddress ? invite.address : null,
      message: printed,
      more: full !== null && full !== printed ? card.more : null,
      link: card.link(readableLink(invite.url)),
    },
  }
}
