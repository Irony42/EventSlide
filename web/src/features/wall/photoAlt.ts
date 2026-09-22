import type { WallItemDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'

/**
 * A wall item's alternative text: its caption and who sent it.
 *
 * 1.0 used the stored filename, so a screen reader read out `IMG_4821.jpg`. The author
 * is always named even when the caption carries the meaning, because "who sent this"
 * is the part a listener cannot get from the picture.
 *
 * A clip says "vidéo" rather than "photo", and it says it whether or not this layout is
 * playing it: the row **is** a video, and describing the poster frame as a photograph
 * would be wrong in the four layouts that show the still as well as in the two that do
 * not. The pairing is a table rather than a conditional for the reason the presenters use
 * one — it is a fact indexed by `kind`, not a rule.
 *
 * **The copy is passed in rather than imported**, because this is not a component and
 * cannot ask a hook. The wall speaks the event's language, which arrives on the wall
 * response, so there is no table this module could reach for that would be right — the
 * French one it used to import was right only while the whole surface was French. The two
 * lookup tables are therefore built per call rather than at module load, which is the one
 * cost of the change and is a pair of object literals in an `alt` attribute.
 *
 * **The caption and the author are the event's content and are not translated**, here or
 * anywhere. What this function translates is the frame around them — "Photo envoyée par",
 * the em dash, and the word for an anonymous guest — so a German wall reads
 * "Les confettis — Foto von Léa", which is exactly right: the caption is what a guest
 * wrote and the sentence around it is what the product says.
 */
export const photoAlt = (item: WallItemDto, text: UiText): string => {
  const byAuthor: Readonly<Record<WallItemDto['kind'], (name: string) => string>> = {
    photo: (name) => text.wall.photoBy(name),
    clip: (name) => text.wall.videoBy(name),
  }

  const byAnonymous: Readonly<Record<WallItemDto['kind'], string>> = {
    photo: text.wall.photoByAnonymous,
    clip: text.wall.videoByAnonymous,
  }

  const author =
    item.authorName === null || item.authorName === ''
      ? byAnonymous[item.kind]
      : byAuthor[item.kind](item.authorName)

  return item.caption === null || item.caption === '' ? author : `${item.caption} — ${author}`
}
