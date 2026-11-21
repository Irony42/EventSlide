import type { InviteShot } from './invitePreferences'

/** The pixels of the image a phone posts: a square for groups and messages, a story. */
export const SHOT_SIZE: Readonly<
  Record<InviteShot, { readonly width: number; readonly height: number }>
> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
}
