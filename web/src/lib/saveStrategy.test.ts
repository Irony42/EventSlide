import { describe, expect, it } from 'vitest'
import {
  saveEnvironmentOf,
  saveHelpFor,
  saveStrategy,
  type NavigatorFacts,
  type SaveEnvironment,
} from './saveStrategy'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const sharing = (yes: boolean) => ({ canShare: () => yes })
const pointer = (coarse: boolean) => (query: string) => ({
  matches: query === '(pointer: coarse)' && coarse,
})

const iphone: SaveEnvironment = { canShareFiles: true, coarsePointer: true, appleTouchDevice: true }

describe('the way a photograph is saved', () => {
  it('opens the share sheet on an Apple touch device that can share a file', () => {
    expect(saveStrategy(iphone)).toBe('share')
  })

  it('downloads when the device cannot share a file (a messaging app’s own browser)', () => {
    expect(saveStrategy({ ...iphone, canShareFiles: false })).toBe('download')
  })

  it('downloads on a computer even though its browser can share a file (a fine pointer)', () => {
    expect(saveStrategy({ ...iphone, coarsePointer: false })).toBe('download')
  })

  it('downloads on Android, whose gallery already sees a downloaded file', () => {
    // Chrome for Android answers `canShare({ files })` true on a touch screen: the decision is
    // the platform's, not the capability's.
    expect(saveStrategy({ ...iphone, appleTouchDevice: false })).toBe('download')
  })

  it('says nothing to the guest outside Apple devices', () => {
    expect(saveHelpFor({ ...iphone, appleTouchDevice: false }, 'download')).toBeNull()
    expect(saveHelpFor({ ...iphone, appleTouchDevice: false }, 'share')).toBeNull()
  })

  it('names the sheet’s choice when it is about to open, and the Files app after a download', () => {
    expect(saveHelpFor(iphone, 'share')).toBe('sheet')
    expect(saveHelpFor(iphone, 'download')).toBe('files')
  })
})

describe('the facts it is read from', () => {
  const read = (nav: NavigatorFacts, coarse = true) => saveEnvironmentOf(nav, pointer(coarse))

  it('asks canShare about a JPEG file, not about nothing', () => {
    let asked: ShareData | null = null
    read({
      canShare: (data) => {
        asked = data
        return true
      },
    })

    expect(asked).not.toBeNull()
    const files = (asked as unknown as ShareData).files ?? []
    expect(files).toHaveLength(1)
    expect(files[0]?.type).toBe('image/jpeg')
  })

  it('treats a missing or throwing canShare as "cannot share"', () => {
    expect(read({}).canShareFiles).toBe(false)
    expect(
      read({
        canShare: () => {
          throw new TypeError('no')
        },
      }).canShareFiles,
    ).toBe(false)
  })

  it('reads the pointer from matchMedia, and a browser without it as a fine one', () => {
    expect(read(sharing(true), true).coarsePointer).toBe(true)
    expect(read(sharing(true), false).coarsePointer).toBe(false)
    expect(saveEnvironmentOf(sharing(true), undefined).coarsePointer).toBe(false)
  })

  it('recognises an iPhone and an iPad that asks for desktop sites, and nothing else', () => {
    expect(read({ userAgent: IPHONE_UA }).appleTouchDevice).toBe(true)
    // An iPad in desktop mode says it is a Mac, with touch points a Mac does not have.
    expect(read({ platform: 'MacIntel', maxTouchPoints: 5 }).appleTouchDevice).toBe(true)
    expect(read({ platform: 'MacIntel', maxTouchPoints: 0 }).appleTouchDevice).toBe(false)
    expect(read({ userAgent: ANDROID_UA, platform: 'Linux armv8l' }).appleTouchDevice).toBe(false)
  })

  it('shares from a real iPhone’s facts and downloads from an Android’s', () => {
    expect(saveStrategy(read({ ...sharing(true), userAgent: IPHONE_UA }))).toBe('share')
    expect(saveStrategy(read({ ...sharing(true), userAgent: ANDROID_UA }))).toBe('download')
  })

  it('downloads from a laptop whose browser shares files', () => {
    expect(
      saveStrategy(read({ ...sharing(true), platform: 'MacIntel', maxTouchPoints: 0 }, false)),
    ).toBe('download')
  })
})
