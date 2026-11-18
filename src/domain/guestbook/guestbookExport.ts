/**
 * The guestbook as the plain text file of the host's album archive (spec 01, PR 5).
 *
 * UTF-8 text with no interpretation: no markup, no escaping, nothing a reader's software could
 * act on. A message is untrusted text, so what this writes is what the guest typed after
 * `GuestbookText`'s cleaning and nothing around it that could be mistaken for more. One block per
 * message, oldest first: the signature and the date on one line, then the message, then a blank
 * line. A guest whose name was taken off is signed with the same words the wall uses.
 *
 * Which messages are in it is `isInAlbum`'s answer, as for photographs, asked by the caller:
 * published and hidden are, pending and rejected are not, and an operator takedown never is.
 *
 * **A voice message has its own block** (spec 25): the signature, then one bracketed line that says
 * it is a voice message, how long it is and which file of the archive holds it, then the guest's
 * optional caption. Still plain text, nothing interpreted. A voice kept secret is **not** a block:
 * its file is not in the archive either (an unzipped archive would otherwise lift the secret), and
 * the file ends with one line that says how many were left out and why.
 */

interface GuestbookExportLineBase {
  /** The guest's first name, or `null` when it was removed. */
  readonly author: string | null
  readonly at: Date
}

/** A written message. */
export interface WrittenExportLine extends GuestbookExportLineBase {
  readonly text: string
}

/** A voice message in the archive, or whose file the disk no longer has (`file: null`). */
export interface VoiceExportLine extends GuestbookExportLineBase {
  readonly voice: {
    readonly durationMs: number
    /** The name inside the archive's folder, `voice/0007-9f2c1a.m4a`, or `null` for a missing file. */
    readonly file: string | null
    readonly caption: string | null
  }
}

export type GuestbookExportLine = WrittenExportLine | VoiceExportLine

/** The signature of a message whose author has no name. Content-neutral, like the wall's. */
export const ANONYMOUS_SIGNATURE = 'Un invité'

const dateOf = (at: Date): string => at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

/** `0:23`, `1:05`: whole seconds, rounded to the nearest, never `0:60`. */
export const clockOf = (durationMs: number): string => {
  const seconds = Math.max(0, Math.round(durationMs / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const blockOf = (line: GuestbookExportLine): string => {
  const head = `${line.author ?? ANONYMOUS_SIGNATURE}, ${dateOf(line.at)}`
  if (!('voice' in line)) return `${head}\n${line.text}\n`
  const { durationMs, file, caption } = line.voice
  const body = `[message vocal, ${clockOf(durationMs)}, ${file ?? 'fichier absent'}]`
  return caption === null ? `${head}\n${body}\n` : `${head}\n${body}\n${caption}\n`
}

/** The closing line for the voices left out because they are still secret; empty for none. */
const sealedLine = (sealedVoices: number): string => {
  if (sealedVoices <= 0) return ''
  return sealedVoices === 1
    ? '\n1 message vocal scellé, non inclus\n'
    : `\n${sealedVoices} messages vocaux scellés, non inclus\n`
}

export const renderGuestbookText = (
  eventName: string,
  lines: readonly GuestbookExportLine[],
  /** How many voice messages are kept secret and so are not in the archive. */
  sealedVoices = 0,
): string => `${eventName}\n\n${lines.map(blockOf).join('\n')}${sealedLine(sealedVoices)}`
