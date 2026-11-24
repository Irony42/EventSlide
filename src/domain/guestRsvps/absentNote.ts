import { DisplayName } from '../guests/displayName'

/**
 * The word of those who cannot come (spec 30, lot 4): a guest who answered "no" may leave a written
 * message in the guestbook. The message is judged by the guestbook's own text rules and ceilings; what
 * this file decides is **who signs it**: the first word of the name they gave the reply (a first name
 * is what the guestbook shows), cut at forty characters, or nobody when there is none to show.
 *
 * `maxChars` is the cut; it is `DisplayName`'s own ceiling, and only a test asks for another (a longer
 * word, which the display name then refuses and the note is signed by nobody).
 */
export const absentNoteAuthorName = (
  replyName: string,
  maxChars: number = DisplayName.maxLength,
): DisplayName | null => {
  const name = replyName.trim()
  const first = name.slice(0, name.search(/\s|$/u))
  const parsed = DisplayName.createOptional([...first].slice(0, maxChars).join(''))
  return parsed.ok ? parsed.value : null
}
