import type { Migration } from '../migrator'

/**
 * The word of those who cannot come (spec 30, lot 4): a guest who answered "no" may leave a message in
 * the guestbook, which needs an author, and the guestbook's authors are `guests` rows.
 *
 * - **`guests.via_rsvp`**: the row was made for a note, not by someone joining the wall. It has no device
 *   token, nobody can sign in as it, and it is **left out of every count of guests** (the host's list,
 *   the people present, the statistics, the dashboard's `guest_count`): an absent guest is not a guest
 *   of the party.
 * - **`guest_rsvps.absent_note_guest_id`**: the `guests` row made for this reply's note, or `NULL`. One
 *   note per reply is "this is not null". Deleting the reply (the guest's, the host's, the retention
 *   sweep) deletes that row, and the guestbook entry goes with it (`ON DELETE CASCADE`); the event's
 *   purge takes them all. It is not a foreign key on purpose: the reply and the guest row are deleted
 *   together by the repository, in one transaction, and a key here would make the order matter.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration039: Migration = {
  id: 39,
  name: 'rsvp_absent_notes',
  sql: `
      ALTER TABLE guests ADD COLUMN via_rsvp INTEGER NOT NULL DEFAULT 0 CHECK (via_rsvp IN (0, 1));
      ALTER TABLE guest_rsvps ADD COLUMN absent_note_guest_id TEXT;
  `,
}
