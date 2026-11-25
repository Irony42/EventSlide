/**
 * The bounds of "au plus par réponse", the domain's own (`PARTY_SIZE_MIN` / `PARTY_SIZE_MAX` in
 * `src/domain/guestRsvps/rsvpForm.ts`). The web app cannot import `src/`:
 * `partySizeContract.test.ts` (server project) fails when these drift.
 */
export const PARTY_SIZE_MIN = 1
export const PARTY_SIZE_MAX = 10

/**
 * The size a field holds once it is a choice: a whole number within the bounds. A number field
 * passes through "", "1e" and "11" while it is typed; those are not choices and are never sent.
 */
export const usablePartySize = (value: string): number | null => {
  if (!/^\d{1,3}$/.test(value)) return null
  const size = Number(value)
  return size >= PARTY_SIZE_MIN && size <= PARTY_SIZE_MAX ? size : null
}
