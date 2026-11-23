/**
 * `npm run push:keys` - in the image, `node dist/ops/scripts/generateVapidKeys.js`.
 *
 * Makes the key pair Web Push needs (spec 30, lot 4; RFC 8292) and prints the three lines to put in
 * the environment (`.env` or a secrets manager). **The private key is a credential**: it signs the
 * token every push service sees. It is printed once, to the terminal, and written nowhere; keep it
 * out of the repository, and out of `compose.yaml`.
 *
 * Browser notifications for the host stay off until all three of `VAPID_PUBLIC_KEY`,
 * `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set. Changing the pair later makes every browser's
 * subscription stop working (each host has to turn the notification on again), so make it once.
 *
 * `run(write)` is exported and returns an exit code so a test can drive it.
 */

import { generateVapidKeys } from '../src/infrastructure/push/webPushCrypto'

export const run = (write: (line: string) => void = console.log): number => {
  const keys = generateVapidKeys()
  write('# Browser notifications (Web Push). Put these three lines in .env, then restart the box.')
  write('# The private key is a credential: keep it out of the repository and out of compose.yaml.')
  write(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
  write(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
  write('# How a push service can reach you (a mailto: or an https address): set your own.')
  write('VAPID_SUBJECT=mailto:you@example.org')
  return 0
}

/** Run as a program, and not when a test imports `run` (see `backup.ts`). */
if (require.main === module) {
  process.exitCode = run()
}
