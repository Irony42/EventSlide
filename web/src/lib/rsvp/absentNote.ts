/**
 * The word of those who cannot come (spec 30, lot 4), as the page bounds it: the guestbook's own ceiling for
 * a message and a guest name's for the signature. Both mirror the server (`GUESTBOOK_TEXT_MAX_LENGTH`,
 * `DisplayName.maxLength`), counted in code points like it (`lib/characters.ts`), and
 * `src/domain/guestRsvps/absentNoteLimits.test.ts` reads this file and fails when they drift.
 */
export const ABSENT_NOTE_MAX_CHARS = 500
export const ABSENT_NOTE_SIGNATURE_MAX_CHARS = 40
