import type { Migration } from '../migrator'

/**
 * The host's browser notifications (spec 30, lot 4, Web Push): one row per browser that asked to be
 * told when replies come in, **for one event and one account**.
 *
 * - **`UNIQUE (endpoint, event_id, user_id)`**: a browser that serves several events, or several
 *   accounts, holds one row for each, and subscribing again is an upsert. The endpoint alone is not
 *   unique on purpose (a family laptop, two co-owners).
 * - **`endpoint`, `p256dh`, `auth`** are the three values the push service and the browser give: the
 *   endpoint is a capability URL (whoever holds it can ask the push service to wake that browser, so
 *   it is never logged or sent anywhere but to its own push service), and the two keys are what the
 *   payload is encrypted to. Nothing else about the browser is kept.
 * - **`failures`** counts the consecutive sends the push service did not take (a non-2xx, a timeout): a
 *   subscription that reaches the limit is pruned, and a delivery resets it.
 * - Both foreign keys are `ON DELETE CASCADE` and each has its own index (the migrator's test asks
 *   for one starting with every foreign key column): a purged event or a deleted account takes its
 *   subscriptions with it.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration038: Migration = {
  id: 38,
  name: 'push_subscriptions',
  sql: `
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        endpoint   TEXT NOT NULL,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        failures   INTEGER NOT NULL DEFAULT 0,

        CHECK (length(endpoint) BETWEEN 1 AND 2048),
        CHECK (failures >= 0),
        UNIQUE (endpoint, event_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (user_id);
      CREATE INDEX IF NOT EXISTS push_subscriptions_event ON push_subscriptions (event_id);
  `,
}
