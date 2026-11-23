/**
 * What the guest's device remembers of their reply (spec 30, section 6): **one token per invitation**,
 * in `localStorage`, so the page finds the reply again without asking anything.
 *
 * Every read and write is wrapped: a private window, blocked site data or a full quota make the
 * storage throw, and the page must work all the same (the guest then relies on their link). The
 * value is the token only: nothing the guest typed is stored here.
 *
 * The token reaches a second device through the **fragment** of the link (`/i/<invite>#r=<token>`):
 * a fragment never goes to the server, so it stays out of every access log. It is **read once and
 * removed from the address bar**, so it is not left in the history, a screenshot or a copied URL.
 */

const KEY = (inviteToken: string): string => `eventslide.rsvp.${inviteToken}`

/** The token of the reply this device holds for the invitation, or `null`. */
export const readStoredEditToken = (inviteToken: string): string | null => {
  try {
    const raw = window.localStorage.getItem(KEY(inviteToken))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value: unknown = Reflect.get(parsed, 'editToken')
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export const storeEditToken = (inviteToken: string, editToken: string): void => {
  try {
    window.localStorage.setItem(KEY(inviteToken), JSON.stringify({ editToken }))
  } catch {
    // The page works without a memory: the link is the way back.
  }
}

export const forgetEditToken = (inviteToken: string): void => {
  try {
    window.localStorage.removeItem(KEY(inviteToken))
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/** A token as the server mints it: URL-safe base64, never longer than the door accepts. */
const FRAGMENT_TOKEN = /^[A-Za-z0-9_-]{8,128}$/

/**
 * The token a link carries in its fragment (`#r=<token>`), taken **and removed** from the address
 * bar. `null` when the fragment is not one of ours (it is then left alone: another tool may own it).
 */
export const takeEditTokenFromFragment = (): string | null => {
  const hash = window.location.hash
  if (!hash.startsWith('#r=')) return null
  const token = hash.slice(3)
  // Removed whatever it holds: an `#r=` that is not a token is not meant to stay in the bar either.
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
  return FRAGMENT_TOKEN.test(token) ? token : null
}

/**
 * The private link a guest keeps to change their reply from another device: the invitation's own
 * address and the token in the fragment.
 */
export const ownReplyLink = (origin: string, inviteToken: string, editToken: string): string =>
  `${origin}/i/${encodeURIComponent(inviteToken)}#r=${editToken}`
