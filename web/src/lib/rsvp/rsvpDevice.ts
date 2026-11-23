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
  if (taken?.invite === inviteToken) taken = null
  try {
    window.localStorage.removeItem(KEY(inviteToken))
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/** A token as the server mints it: URL-safe base64, never longer than the door accepts. */
const FRAGMENT_TOKEN = /^[A-Za-z0-9_-]{8,128}$/

/**
 * What the last fragment held, **per invitation**: taking the fragment removes it from the bar, so a
 * second look finds nothing. React may run an initializer twice (StrictMode in development) and a
 * device with no usable storage cannot hand the token back from there, so the one value taken is
 * kept here for the next ask, until the token is forgotten.
 */
let taken: { readonly invite: string; readonly token: string } | null = null

/** Removes a `#r=` fragment from the address bar, whatever it holds, and says what it held. */
const stripFragment = (): string | null => {
  const hash = window.location.hash
  if (!hash.startsWith('#r=')) return null
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
  return hash.slice(3)
}

/**
 * The token a link carries in its fragment (`#r=<token>`), taken **and removed** from the address
 * bar, and kept for the device. `null` when there is none (a fragment that is not one of ours is
 * left alone: another tool may own it). Asked twice for the same invitation, the same answer.
 */
export const takeEditTokenFromFragment = (inviteToken: string): string | null => {
  const raw = stripFragment()
  if (raw === null) return taken?.invite === inviteToken ? taken.token : null
  if (!FRAGMENT_TOKEN.test(raw)) return null
  taken = { invite: inviteToken, token: raw }
  storeEditToken(inviteToken, raw)
  return raw
}

/**
 * The host's preview shows the page without using the token: the fragment still must not stay in
 * the address bar of the person who opened a link on the wrong screen.
 */
export const discardEditTokenFragment = (): void => {
  stripFragment()
}

/**
 * The private link a guest keeps to change their reply from another device: the invitation's own
 * address and the token in the fragment.
 */
export const ownReplyLink = (origin: string, inviteToken: string, editToken: string): string =>
  `${origin}/i/${encodeURIComponent(inviteToken)}#r=${editToken}`

const JOIN_NAME_KEY = 'eventslide.joinNamePrefill'
const JOIN_NAME_MAX_CHARS = 40
/** How long an offered name stays: a guest who does not go straight on to the join screen is not offered it. */
export const JOIN_NAME_TTL_MS = 120_000

/** A join code as the two screens compare it: letters and digits, upper case. */
const codeKey = (code: string): string => code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** The code of a join link (`/join/H7K2QM`): its last path segment, or `null`. */
const codeOfJoinUrl = (joinUrl: string): string | null => {
  const last = joinUrl.split(/[?#]/, 1)[0]?.split('/').filter(Boolean).at(-1)
  if (last === undefined) return null
  try {
    return codeKey(decodeURIComponent(last)) || null
  } catch {
    return null
  }
}

/**
 * The first name the join screen offers a guest whose device knows their reply (spec 30, section
 * 9.1): the first word of the name they gave, at most 40 characters, in `sessionStorage` only for
 * the move from the invitation to the join screen. **Nothing goes through the address or the
 * server.** It is **scoped to the join code of the link that was pressed** (the join screen offers it
 * for that event only), expires after two minutes, is cleared when the join screen reads it and
 * when the page goes away. Wrapped like the rest: without storage the guest types their name.
 */
export const writeJoinNamePrefill = (fullName: string, joinUrl: string): void => {
  const first = [...(fullName.trim().split(/\s+/, 1)[0] ?? '')]
    .slice(0, JOIN_NAME_MAX_CHARS)
    .join('')
  const code = codeOfJoinUrl(joinUrl)
  if (first === '' || code === null) return
  try {
    window.sessionStorage.setItem(
      JOIN_NAME_KEY,
      JSON.stringify({ code, name: first, at: Date.now() }),
    )
    window.addEventListener('pagehide', clearJoinNamePrefill, { once: true })
  } catch {
    // The guest types their name.
  }
}

/**
 * What the join screen offers for **this** join code, or `null`: another event's name, an expired
 * one or one that is not ours is never offered. Does not clear: {@link clearJoinNamePrefill} does.
 */
export const readJoinNamePrefill = (code: string | undefined): string | null => {
  if (code === undefined) return null
  try {
    const raw = window.sessionStorage.getItem(JOIN_NAME_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const stored: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
    const { name, at } = stored
    if (typeof name !== 'string' || name === '' || typeof at !== 'number') return null
    if (Date.now() - at > JOIN_NAME_TTL_MS) return null
    return typeof stored['code'] === 'string' && stored['code'] === codeKey(code) ? name : null
  } catch {
    return null
  }
}

export const clearJoinNamePrefill = (): void => {
  try {
    window.sessionStorage.removeItem(JOIN_NAME_KEY)
  } catch {
    // Nothing was kept.
  }
}
