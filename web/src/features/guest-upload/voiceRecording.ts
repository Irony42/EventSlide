/**
 * What the phone knows about recording a voice message (spec 25), as pure functions.
 *
 * Nothing here decides a rule of the product: the length a message may have, how many a guest may
 * leave and whether the event takes any are the server's answers. What lives here is what only a
 * browser can say: which format it can produce, whether it can record at all, and how to tell a
 * page the browser forbade from a guest who said no.
 */

/** The phone stops the recording here. The server does not rely on it: it bounds the output itself. */
export const MAX_VOICE_SECONDS = 60

/**
 * Where the phone stops: the box's `MAX_VOICE_SECONDS` as the server said it, and never above
 * {@link MAX_VOICE_SECONDS}. A recording longer than the server's limit is refused as `voice.tooLong`,
 * and a refused recording is a lost one, so the phone must never be more generous than the box. Nothing
 * said (an older server) or nonsense: the constant.
 */
export const voiceCapSeconds = (serverMaxSeconds: number | undefined): number =>
  typeof serverMaxSeconds === 'number' && Number.isFinite(serverMaxSeconds) && serverMaxSeconds >= 1
    ? Math.min(MAX_VOICE_SECONDS, Math.floor(serverMaxSeconds))
    : MAX_VOICE_SECONDS

/** "Il reste 10 secondes" is said once, when the clock is this far from the end. */
export const VOICE_WARNING_BEFORE_END_SECONDS = 10

/** A press by mistake is not a message: the server's floor is one second (`VOICE_MIN_MS`). */
export const MIN_VOICE_MS = 1_000

/** A caption is 140 characters, like a photograph's (`src/domain/photos/caption.ts`). */
export const VOICE_CAPTION_MAX = 140

/**
 * The formats to ask `MediaRecorder` for, best first.
 *
 * AAC in MP4 is what Safari (iOS and macOS) records; Opus in WebM is Chrome, Edge and Firefox on
 * Android; Opus in Ogg is Firefox on a desktop. The chosen type is only a hint for the file name
 * and the local preview: **the server never reads it** and identifies the bytes itself.
 */
export const VOICE_FORMATS: readonly string[] = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
]

/** The first format the browser says it can produce, or `null`: then no button is offered at all. */
export const pickVoiceFormat = (isTypeSupported: (type: string) => boolean): string | null =>
  VOICE_FORMATS.find((format) => isTypeSupported(format)) ?? null

/** `message-vocal.m4a`, `.webm` or `.ogg`: a name the guest sees when saving a recording to their phone. */
export const voiceFileName = (mimeType: string): string => {
  const base = mimeType.toLowerCase()
  if (base.startsWith('audio/mp4')) return 'message-vocal.m4a'
  if (base.startsWith('audio/ogg')) return 'message-vocal.ogg'
  return 'message-vocal.webm'
}

/** The type without its codecs: `audio/webm;codecs=opus` is a `File` of type `audio/webm`. */
export const baseMimeType = (mimeType: string): string => mimeType.split(';')[0]?.trim() ?? mimeType

/** `0:07`, `1:00`. From the phone's own timer, never from `audio.duration` (a WebM recording reports `Infinity`). */
export const formatClock = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** What this browser has, as plain values, so the rule below is testable without a browser. */
export interface VoiceEnvironment {
  readonly isSecureContext: boolean
  readonly hasGetUserMedia: boolean
  readonly mediaRecorder: { isTypeSupported: (type: string) => boolean } | null
}

/** Reads the real browser. The only place the globals are touched. */
export const currentVoiceEnvironment = (): VoiceEnvironment => ({
  isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
  hasGetUserMedia:
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
  mediaRecorder: typeof MediaRecorder === 'undefined' ? null : MediaRecorder,
})

/**
 * Whether this browser can record a message: a secure context, `getUserMedia`, `MediaRecorder` and
 * a format of the ladder. Without any one of them the button is not offered.
 *
 * A box served over plain `http://` on a local network has no microphone, which is the browser's
 * rule and not a bug (`docs/INSTALL.md`).
 */
export const canRecordVoice = (environment: VoiceEnvironment): boolean =>
  environment.isSecureContext &&
  environment.hasGetUserMedia &&
  environment.mediaRecorder !== null &&
  pickVoiceFormat((type) => environment.mediaRecorder?.isTypeSupported(type) === true) !== null

/**
 * Whether the page's own policy forbids the microphone, where the browser says (`false` when it
 * does not expose the question). A guest cannot undo that in their settings, so the message differs from a refusal.
 */
export const microphoneForbiddenByPage = (doc: Document = document): boolean => {
  const policy = (
    doc as Document & {
      readonly permissionsPolicy?: { allowsFeature: (feature: string) => boolean }
    }
  ).permissionsPolicy
  return policy?.allowsFeature('microphone') === false
}

/**
 * The browsers that open a link inside an app (WhatsApp, Instagram, Messenger, Facebook, Snapchat,
 * Line, WeChat, a bare Android WebView). They have no microphone for a web page.
 *
 * **Read for one sentence only** ("ouvrez cette page dans Safari ou Chrome"): no other behaviour
 * depends on the user agent.
 */
const IN_APP_BROWSER =
  /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Messenger|Snapchat|Line\/|MicroMessenger|; wv\)/i

export const isInAppBrowser = (userAgent: string): boolean => IN_APP_BROWSER.test(userAgent)
