import { DisplayName } from '../guests/displayName'

/**
 * The word of those who cannot come (spec 30, lot 4): a guest who answered "no" may leave a written
 * message in the guestbook. The message is judged by the guestbook's own text rules and ceilings; what
 * this file decides is **who signs it**: the first word of the name they gave the reply (a first name
 * is what the guestbook shows), cut at forty characters, or nobody when there is none to show.
 */

/** The display name the note is signed with, or `null` (anonymous) when the reply's name gives none. */
export const absentNoteAuthorName = (replyName: string): DisplayName | null => {
  const first = replyName.trim().split(/\s+/u)[0] ?? ''
  const name = DisplayName.createOptional([...first].slice(0, DisplayName.maxLength).join(''))
  return name.ok ? name.value : null
}
