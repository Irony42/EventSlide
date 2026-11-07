import type { UiText } from '../../lib/i18n/translations'

/**
 * What the moderation surfaces say about one photo or clip (WEB-HOST-09): who it is from, in the
 * two places the name appears, and its alternative text. Written once because four components
 * spelled it, like `lib/photoAlt.ts` does for the wall.
 *
 * - `authorInName` reads inside "la photo de ...", so an anonymous guest is "un invite", not
 *   "Invite anonyme" (`byAnonymous` is the standalone caption line).
 * - `authorLine` is the caption line under the picture.
 * - `alt` says "video" for a clip and includes the caption when there is one.
 *
 * `isClip` is the caller's, because the surfaces disagree on what a clip is: the grid card goes
 * by `kind`, the swipe card and the lightbox also need a video address to play.
 */
export interface PhotoLabels {
  readonly authorInName: string
  readonly authorLine: string
  readonly alt: string
}

export const photoLabels = (
  photo: { readonly authorName: string | null; readonly caption: string | null },
  isClip: boolean,
  text: UiText,
): PhotoLabels => {
  const authorInName = photo.authorName ?? text.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? text.moderation.byAnonymous : text.moderation.by(photo.authorName)
  const describe = isClip ? text.moderation.videoAlt : text.moderation.photoAlt
  const describeWithCaption = isClip
    ? text.moderation.videoAltWithCaption
    : text.moderation.photoAltWithCaption
  const alt =
    photo.caption === null
      ? describe(authorInName)
      : describeWithCaption(photo.caption, authorInName)
  return { authorInName, authorLine, alt }
}
