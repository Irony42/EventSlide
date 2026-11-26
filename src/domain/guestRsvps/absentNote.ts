import { DisplayName } from '../guests/displayName'
import { namesItsHousehold } from './household'

/**
 * The word of those who cannot come (spec 30, lot 4): a guest who answered "no" may leave a written
 * message in the guestbook. The message is judged by the guestbook's own text rules and ceilings; what
 * this file decides is **who signs it**: the first word of the name they gave the reply (a first name
 * is what the guestbook shows), cut at forty characters, or nobody when there is none to show. A reply
 * named as its household ("Famille Martin" on the Martins' link) is signed by that whole name: its
 * first word is nobody's first name.
 *
 * `maxChars` is the cut; it is `DisplayName`'s own ceiling, and only a test asks for another (a longer
 * word, which the display name then refuses and the note is signed by nobody).
 */
export const absentNoteAuthorName = (
  replyName: string,
  householdName: string | null = null,
  maxChars: number = DisplayName.maxLength,
): DisplayName | null => {
  const name = replyName.trim()
  const signed =
    householdName !== null && namesItsHousehold(name, householdName)
      ? name.replace(/\s+/gu, ' ')
      : name.slice(0, name.search(/\s|$/u))
  const parsed = DisplayName.createOptional([...signed].slice(0, maxChars).join(''))
  return parsed.ok ? parsed.value : null
}
