/**
 * An identifier for a stored photo.
 *
 * `crypto.randomUUID` would be the obvious call and is the wrong one here: it is
 * defined only in a secure context, and the guest surface is routinely opened over
 * plain HTTP on a venue's LAN address during a rehearsal. `getRandomValues` has no
 * such restriction, so the id generator does not become the thing that breaks on the
 * one network where this feature matters most.
 *
 * `Math.random()` is not used, deliberately: two tabs seeded alike would collide, and
 * a collision here means one guest's photo silently replacing another's in the store.
 */
export const newOutboxId = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0')
  return id
}
