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
 */

export interface GuestbookExportLine {
  /** The guest's first name, or `null` when it was removed. */
  readonly author: string | null
  readonly at: Date
  readonly text: string
}

/** The signature of a message whose author has no name. Content-neutral, like the wall's. */
export const ANONYMOUS_SIGNATURE = 'Un invité'

const dateOf = (at: Date): string => at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export const renderGuestbookText = (
  eventName: string,
  lines: readonly GuestbookExportLine[],
): string => {
  const blocks = lines.map(
    (line) => `${line.author ?? ANONYMOUS_SIGNATURE}, ${dateOf(line.at)}\n${line.text}\n`,
  )
  return `${eventName}\n\n${blocks.join('\n')}`
}
