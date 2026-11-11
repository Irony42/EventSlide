/**
 * Which of the two moderation screens a device opens (the host and the moderator).
 *
 * There is one address, `/admin/events/:slug/moderation`, and two screens behind it: the
 * console built for a laptop (a grid, a keyboard, a selection) and the one built for a phone
 * held in one hand (one photo at a time, swipe or two big buttons). The event page used to
 * offer both as two links, and a host had to know which one they were holding. The device
 * answers instead:
 *
 * - **What the host chose wins.** Each screen carries a button to the other one, for the
 *   detection that guessed wrong (a tablet, a narrow laptop window, a phone in landscape). The
 *   choice is remembered on this device, for every event, because it is a fact about the
 *   device and not about the evening.
 * - **Otherwise the screen decides**: narrow, or driven by a finger, is a phone.
 *
 * Read once, when the page opens, and never subscribed to: turning a phone sideways must not
 * swap the screen under a thumb that is halfway through a swipe.
 *
 * Every storage access is wrapped, because both of them throw (Safari in private browsing on
 * write, a browser with site data blocked on read). A choice that cannot be remembered still
 * holds for the page that is open; the detection answers again on the next load.
 */

export type ModerationView = 'phone' | 'desktop'

const KEY = 'eventslide.moderation.view'

/** The query `onPhone` asks: narrow, or a coarse pointer. Exported for the tests that stub it. */
export const PHONE_QUERY = '(max-width: 767px), (pointer: coarse)'

/**
 * Whether the screen in front of the person is a phone's. A browser without `matchMedia` (a
 * test harness) is a laptop.
 */
export const onPhone = (): boolean => {
  try {
    return window.matchMedia(PHONE_QUERY).matches
  } catch {
    return false
  }
}

/** The choice this device remembers, or `null`: anything this build did not write is no choice. */
export const rememberedModerationView = (): ModerationView | null => {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'phone' || stored === 'desktop' ? stored : null
  } catch {
    return null
  }
}

export const rememberModerationView = (view: ModerationView): void => {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // The screen still switches for this page; only the memory of the choice is lost.
  }
}

/** The screen to open: the remembered choice if there is one, the device's shape otherwise. */
export const moderationViewFor = (
  remembered: ModerationView | null,
  phone: boolean,
): ModerationView => remembered ?? (phone ? 'phone' : 'desktop')
