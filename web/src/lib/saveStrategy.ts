/**
 * How a photograph reaches a guest's phone (spec 24, section 5.5): the system's share sheet,
 * or an ordinary download.
 *
 * **Why two ways, and why the line falls where it does.** iOS Safari does not file a download in
 * Photos: an `<a download>` lands in the Files app. What puts an image in Photos is the share
 * sheet (`navigator.share({ files })`, "Enregistrer l'image"). Android Chrome is the other way
 * round: a downloaded JPEG goes to Downloads, the gallery sees it, and it took one gesture,
 * where the share sheet is a list of applications and "save on the device" is not on it
 * everywhere. A computer wants a download too, and `canShare({ files })` is true on Chrome and
 * Edge for Windows and Safari for macOS: a host on their laptop must not get a sheet.
 *
 * So the sheet is for a touch device, with a coarse pointer, that can share a file, **and is
 * made by Apple**. The last clause is the one platform test in the web app, taken on purpose
 * where the spec said to avoid it (question 13): "iOS" is not a capability, it is the one fact
 * that decides where a file ends up, and nothing a browser exposes says it. It is read in one
 * place (`appleTouchDevice`) and nowhere else, so that if a measurement on a real Android shows
 * the sheet to be better, this is the only line that changes.
 *
 * **The decision is a pure function of facts**, so a test can state each one: the facts are read
 * from `navigator` and `matchMedia` by {@link saveEnvironmentOf}, which takes both as parameters
 * and can be given a fake. Playwright's WebKit does not emulate iOS's share sheet; what the sheet
 * really does is measured by hand and written down in docs/TESTING.md ("Appareils réels").
 */

export type SaveStrategy = 'share' | 'download'

/** The facts the choice rests on. */
export interface SaveEnvironment {
  /** `navigator.canShare({ files: [a JPEG] })` answered true. */
  readonly canShareFiles: boolean
  /** `(pointer: coarse)`: a finger, not a mouse. */
  readonly coarsePointer: boolean
  /** An iPhone, an iPod, or an iPad (which Safari presents as a Mac when it asks for desktop sites). */
  readonly appleTouchDevice: boolean
}

/** The part of `navigator` that is read. A fake in a test, the real one in the app. */
export interface NavigatorFacts {
  readonly canShare?: (data: ShareData) => boolean
  readonly userAgent?: string
  readonly platform?: string
  readonly maxTouchPoints?: number
}

/** The part of `window.matchMedia` that is read. */
export type MatchMediaFacts = (query: string) => { readonly matches: boolean }

/** The sheet only where it is the way into Photos; a download everywhere else. */
export const saveStrategy = (env: SaveEnvironment): SaveStrategy =>
  env.canShareFiles && env.coarsePointer && env.appleTouchDevice ? 'share' : 'download'

/**
 * The one help line a guest may be shown, once per device (see `usePhotoSave`): what to
 * choose in the sheet that is about to open, or where the file went when it was a download on
 * an Apple device. Android and computers need none.
 */
export type SaveHelp = 'sheet' | 'files' | null

export const saveHelpFor = (env: SaveEnvironment, strategy: SaveStrategy): SaveHelp => {
  if (!env.appleTouchDevice) return null
  return strategy === 'share' ? 'sheet' : 'files'
}

/** A stand-in for the photograph, for asking `canShare` before the bytes have arrived. */
const probe = (): File => new File([new Uint8Array(1)], 'photo.jpg', { type: 'image/jpeg' })

const canShareFiles = (nav: NavigatorFacts): boolean => {
  if (typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [probe()] })
  } catch {
    return false
  }
}

/**
 * Whether this is an iPhone, an iPod or an iPad. **The only reading of the user agent in the web
 * app.** An iPad that asks for desktop sites says it is a Mac, and a Mac has no touch points,
 * hence the second test.
 */
const isAppleTouchDevice = (nav: NavigatorFacts): boolean =>
  /\b(iPhone|iPad|iPod)\b/u.test(nav.userAgent ?? '') ||
  (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)

export const saveEnvironmentOf = (
  nav: NavigatorFacts,
  matchMedia: MatchMediaFacts | undefined,
): SaveEnvironment => ({
  canShareFiles: canShareFiles(nav),
  coarsePointer: matchMedia?.('(pointer: coarse)').matches === true,
  appleTouchDevice: isAppleTouchDevice(nav),
})

/** The facts of the browser this runs in. Read at the moment of the tap, never at load. */
export const currentSaveEnvironment = (): SaveEnvironment =>
  saveEnvironmentOf(
    navigator,
    typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined,
  )
