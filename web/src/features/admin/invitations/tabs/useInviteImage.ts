import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { EventDto } from '../../../../lib/api/dto'
import { readPrintPhoto } from '../../print/printPhoto'
import { blurPhoto, renderCardPng, type RenderPng } from './imageRender'
import { inviteCardOf, type InviteCardView } from './inviteCard'
import { readInvitePreferences } from './invitePreferences'
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
 * The square picture of the invitation card, as the "Image à partager" tab makes it, for a tab
 * that attaches it to something else (the e-mail): the card the host chose on this device, on a
 * ground of its colour or of the blurred photograph, made by the same renderer. The address is the
 * image tab's choice, off unless the host turned it on there.
 */
export const useInviteImage = (
  event: EventDto,
  invite: InvitationTabProps['invite'],
  fileStem: string,
  renderPng: RenderPng = renderCardPng,
): InviteImage => {
  const slug = event.slug
  const preferences = useMemo(() => readInvitePreferences(slug), [slug])
  const photoUrl = useMemo(() => readPrintPhoto(slug), [slug])
  const view = inviteCardOf(event, invite, preferences, {
    showAddress: preferences.showAddress ?? false,
  })

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
      view.design,
      view.invitation,
      view.colour,
      photoKey,
      view.focusX,
      view.focusY,
      view.texts,
      backdropKey,
      invite.url,
      invite.startsAt,
      invite.endsAt,
      attempt,
    ]),
    SHOT_SIZE.square,
    renderPng,
    backdropPending,
  )
  const blob = image.status === 'ready' ? image.blob : null
  const file = useMemo(
    () => (blob === null ? null : new File([blob], `${fileStem}.png`, { type: 'image/png' })),
    [blob, fileStem],
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
