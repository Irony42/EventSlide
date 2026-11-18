/**
 * What the host's reading of the guestbook says about voice messages when there are none
 * (spec 25): nothing processing, no secret, a clock that never matters. Spread into a
 * `GuestbookQueueDto` fixture so a test about written messages states only what it is about.
 */
export const QUIET_VOICE_BOOK = {
  voiceProcessing: 0,
  voiceSealed: false,
  voiceOpensAtMs: null,
  serverNowMs: 0,
} as const
