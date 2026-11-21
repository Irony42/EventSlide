import { isHexColour } from '../../print/printKit'
import { isInvitationDesign, type InvitationDesign } from '../../../../lib/print/printDesigns'
import { isPrintPhotoUrl } from '../../print/printPhoto'
import { SHORT_MESSAGE_MAX, graphemeCount } from '../../../../lib/invite/cardTexts'

/**
 * What the host last chose for the invitation's card and image on this device, per event
 * (spec 29): the design, the colour, the format and the short word of the card. Shared by the paper
 * and the image so they stay one look. **Nothing here leaves the device**: the link and the token
 * are never stored (a stored link would outlive a change of it), and the server is told none of it.
 *
 * The same discipline as the table cards' preferences: read and written under `try/catch`
 * (a private window must leave the page working), and a value is kept only when it is of the
 * right kind.
 */

export type InviteFormat = 'card' | 'a5'

export const INVITE_FORMATS: readonly InviteFormat[] = ['card', 'a5']
export const DEFAULT_INVITE_FORMAT: InviteFormat = 'card'
export const DEFAULT_INVITE_DESIGN: InvitationDesign = 'essentiel'

export interface InvitePreferences {
  readonly design?: InvitationDesign
  /** `#rrggbb`; absent wears the event's own colour. */
  readonly colour?: string
  readonly format?: InviteFormat
  /** The word printed on the card **when the host wrote one of their own**; absent is the automatic cut. */
  readonly short?: string
  /** The host's photograph, reduced in the browser (`printPhoto`): a JPEG `data:` URL. Never sent anywhere. */
  readonly photo?: string
  /** Where the photograph is framed, in percent of its width and height. */
  readonly focusX?: number
  readonly focusY?: number
}

const keyFor = (slug: string): string => `eventslide.invite.${slug}`

const isFormat = (value: unknown): value is InviteFormat =>
  INVITE_FORMATS.some((format) => format === value)

const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100

export const readInvitePreferences = (slug: string): InvitePreferences => {
  try {
    const raw = window.localStorage.getItem(keyFor(slug))
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { design, colour, format, short, photo, focusX, focusY } = parsed as Record<
      string,
      unknown
    >
    return {
      ...(isInvitationDesign(design) ? { design } : {}),
      ...(isHexColour(colour) ? { colour: colour.toLowerCase() } : {}),
      ...(isFormat(format) ? { format } : {}),
      ...(typeof short === 'string' && graphemeCount(short) <= SHORT_MESSAGE_MAX ? { short } : {}),
      ...(isPrintPhotoUrl(photo) ? { photo } : {}),
      ...(isPercent(focusX) ? { focusX } : {}),
      ...(isPercent(focusY) ? { focusY } : {}),
    }
  } catch {
    return {}
  }
}

export const writeInvitePreferences = (slug: string, preferences: InvitePreferences): void => {
  try {
    window.localStorage.setItem(keyFor(slug), JSON.stringify(preferences))
  } catch {
    // A photograph that does not fit must not cost the host the rest of their choices.
    try {
      const { photo: _dropped, ...withoutPhoto } = preferences
      window.localStorage.setItem(keyFor(slug), JSON.stringify(withoutPhoto))
    } catch {
      // Storage is a convenience; the page works without it.
    }
  }
}
