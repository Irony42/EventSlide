import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { EventDto } from '../../../../lib/api/dto'
import { blurPhoto, renderCardPng, type RenderPng } from './imageRender'
import { inviteCardOf, type InviteCardView } from './inviteCard'
import type { InvitePreferences, InviteShot } from './invitePreferences'
import { SHOT_SIZE } from './shotSize'
import type { InvitationTabProps } from './tabProps'
import { useCardImage, type CardImageState } from './useCardImage'

/** A short fingerprint of a long string (a photograph as a data URL), so a key does not carry it. */
const fingerprint = (text: string | null): string => {
  if (text === null) return ''
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

export interface InviteImageOptions {
  readonly event: EventDto
  readonly invite: InvitationTabProps['invite']
  /** What the host chose on this device (`invitePreferences`): the design, the colour, the address... */
  readonly preferences: InvitePreferences
  readonly shot: InviteShot
  /** The photograph the host chose (the print kit's, kept on this device), or none. */
  readonly photoUrl: string | null
  /** The name of the file the picture becomes. */
  readonly fileName: string
  readonly renderPng?: RenderPng | undefined
}

export interface InviteImage {
  readonly view: InviteCardView
  readonly photoUrl: string | null
  readonly backdropUrl: string | null
  /** The element the picture is made from: it must be drawn somewhere on the page. */
  readonly node: RefObject<HTMLDivElement | null>
  readonly image: CardImageState
  /** The picture as a file, once it is made. */
  readonly file: File | null
  /** Starts the picture again, after a failure. */
  readonly retry: () => void
}

/**
 * The picture of the invitation card on its ground, for the tabs that hand it over (the image to
 * share, the e-mail's attachment): the card the host chose on this device, its photograph from
 * the print kit, the ground of the card's colour or of the blurred photograph, made by one
 * renderer, before anyone taps. The address is the host's choice (`showAddress`, off by default).
 *
 * The one place that reads the preferences and the photograph, keys the picture on everything it
 * is drawn from (a rotated link or a new date is a new picture) and remakes it on a failure.
 */
export const useInviteImage = ({
  event,
  invite,
  preferences,
  shot,
  photoUrl,
  fileName,
  renderPng = renderCardPng,
}: InviteImageOptions): InviteImage => {
  const view = inviteCardOf(event, invite, preferences, {
    showAddress: preferences.showAddress ?? false,
  })

  // The ground: the photograph, blurred; the card's colour until it is, and without one.
  const [backdrop, setBackdrop] = useState<{
    readonly of: string
    readonly url: string | null
  } | null>(null)
  useEffect(() => {
    if (photoUrl === null) return
    let cancelled = false
    void blurPhoto(photoUrl).then((url) => {
      if (!cancelled) setBackdrop({ of: photoUrl, url })
    })
    return () => {
      cancelled = true
    }
  }, [photoUrl])
  const backdropUrl = photoUrl !== null && backdrop?.of === photoUrl ? backdrop.url : null
  const backdropPending = photoUrl !== null && backdrop?.of !== photoUrl

  const photoKey = useMemo(() => fingerprint(photoUrl), [photoUrl])
  const backdropKey = useMemo(() => fingerprint(backdropUrl), [backdropUrl])
  const [attempt, setAttempt] = useState(0)
  const node = useRef<HTMLDivElement>(null)
  const image = useCardImage(
    node,
    JSON.stringify([
      shot,
      view.design,
      view.invitation,
      view.colour,
      photoKey,
      view.focusX,
      view.focusY,
      view.texts,
      backdropKey,
      // A rotated link, or a new date, is a new picture: the QR on it must lead to the live link.
      invite.url,
      invite.startsAt,
      invite.endsAt,
      attempt,
    ]),
    SHOT_SIZE[shot],
    renderPng,
    backdropPending,
  )
  const blob = image.status === 'ready' ? image.blob : null
  const file = useMemo(
    () => (blob === null ? null : new File([blob], fileName, { type: 'image/png' })),
    [blob, fileName],
  )

  return {
    view,
    photoUrl,
    backdropUrl,
    node,
    image,
    file,
    retry: () => setAttempt((count) => count + 1),
  }
}
