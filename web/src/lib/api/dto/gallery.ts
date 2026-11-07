// The shared gallery and its link.
import type { EventThemeDto, MediaKind } from './common'

/**
 * The event's shared gallery link as its owner sees it (roadmap §4.1). No address: only the
 * token's digest is stored, so the address exists once, on {@link ShareLinkCreated}.
 */
export interface ShareLinkDto {
  readonly id: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly hasPassword: boolean
  /** Whether a guest opening it right now would see the album. */
  readonly available: boolean
}
export interface ShareLinkResponse {
  readonly link: ShareLinkDto | null
}
/** The new link and its address — the only time the address exists anywhere but here. */
export interface ShareLinkCreated {
  readonly link: ShareLinkDto
  readonly url: string
}
/** What a guest who opened the link sees above the grid. */
export interface GalleryDto {
  /** Content: the host's own words, never translated. */
  readonly eventName: string
  readonly theme: EventThemeDto
  readonly photoCount: number
  readonly expiresAt: string
  readonly archiveUrl: string
}
/** One tile. Three signed URLs, each good for an hour. */
export interface GalleryPhotoDto {
  readonly id: string
  readonly kind: MediaKind
  readonly width: number
  readonly height: number
  /** Content, as the guest typed it. */
  readonly caption: string | null
  readonly previewUrl: string
  readonly viewUrl: string
  readonly downloadUrl: string
}
export interface GalleryPage {
  readonly items: readonly GalleryPhotoDto[]
  readonly nextCursor: string | null
}
