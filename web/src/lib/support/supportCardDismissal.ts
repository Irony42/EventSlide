/**
 * Whether a host has already closed the support card of a given event (roadmap G4-02).
 *
 * `localStorage`, one key **per event**, because the answer is about that event and about
 * this device and nothing else: a host who closed it for the wedding is still shown it for
 * the conference, once, and the server never learns who looked at what. It is a courtesy
 * remembered by the browser, not a fact about a person, which is why no endpoint exists to
 * keep it and none should be added: a "have they seen the donation ask?" column is the
 * first step to a nag.
 *
 * Every access is wrapped, because both of them throw: Safari in private browsing throws on
 * write, and a browser with site data blocked throws on read. The failure is survivable on
 * purpose. A card that cannot be remembered is shown again on the next page load and is
 * still closable for the rest of this one; failing the host's event page over a donation
 * card would be the wrong way round. {@link ../pwa/install.ts} makes the same trade.
 */

const KEY_PREFIX = 'eventslide.support.dismissed.'

/** The stored answer, exactly `'1'` and nothing else: anything this build did not write is "no". */
export const wasSupportCardDismissed = (eventId: string): boolean => {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${eventId}`) === '1'
  } catch {
    // Not remembered, so not dismissed: the card is shown again, never hidden by a guess.
    return false
  }
}

export const rememberSupportCardDismissal = (eventId: string): void => {
  try {
    localStorage.setItem(`${KEY_PREFIX}${eventId}`, '1')
  } catch {
    // The card is gone for this page load regardless; only the memory of it is lost.
  }
}
