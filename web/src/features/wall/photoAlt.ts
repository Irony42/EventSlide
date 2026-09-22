import type { WallItemDto } from '../../lib/api/dto'
import { fr } from '../../lib/i18n/fr'

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
 */
const BY_AUTHOR: Readonly<Record<WallItemDto['kind'], (name: string) => string>> = {
  photo: (name) => fr.wall.photoBy(name),
  clip: (name) => fr.wall.videoBy(name),
}

const BY_ANONYMOUS: Readonly<Record<WallItemDto['kind'], string>> = {
  photo: fr.wall.photoByAnonymous,
  clip: fr.wall.videoByAnonymous,
}

export const photoAlt = (item: WallItemDto): string => {
  const author =
    item.authorName === null || item.authorName === ''
      ? BY_ANONYMOUS[item.kind]
      : BY_AUTHOR[item.kind](item.authorName)

  return item.caption === null || item.caption === '' ? author : `${item.caption} — ${author}`
}
