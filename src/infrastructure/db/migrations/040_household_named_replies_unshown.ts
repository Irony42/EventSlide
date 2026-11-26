import type { Migration } from '../migrator'

/**
 * A household's reply named as the household is never shown among "who comes" (spec 30, lot 3).
 *
 * 3.18.0 offered the "show my first name" box on a household's link, whose form is filled with the
 * household's name, and published the first word of it: "Famille". The writes now refuse the tick for
 * such a reply (`householdReply`, `unshowHouseholdNamed`); this withdraws the ticks 3.18.0 stored.
 *
 * The comparison is SQLite's `lower(trim(…))`, which folds ASCII letters only, where the domain's
 * `namesItsHousehold` also folds accented capitals and runs of spaces. The page fills the field with
 * the household's name exactly, so the replies this cleans are the exact ones; a reply that differs
 * only by an accented capital keeps its tick until the household answers again, which the write
 * then withdraws. `updated_at` is not touched: this is no guest's word.
 */
export const migration040: Migration = {
  id: 40,
  name: 'household_named_replies_unshown',
  sql: `
      UPDATE guest_rsvps
         SET details = json_set(details, '$.showName', json('false'))
       WHERE household_id IS NOT NULL
         AND json_extract(details, '$.showName') = 1
         AND EXISTS (
               SELECT 1 FROM guest_households h
                WHERE h.id = guest_rsvps.household_id
                  AND h.event_id = guest_rsvps.event_id
                  AND lower(trim(h.name)) = lower(trim(guest_rsvps.name))
             );
  `,
}
