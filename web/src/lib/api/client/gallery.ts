import type { Transport } from '../../http'
import type { GalleryDto, GalleryPage } from '../dto'
import { encode } from './shared'

// The shared gallery a guest opens by its link.

export const galleryApi = (transport: Transport) => ({
  /**
   * What a guest holding the link is shown. `401 gallery.passwordRequired` until the
   * password has been entered in this browser; `404 gallery.notAvailable` for a dead link,
   * whatever killed it.
   */
  gallery: (token: string, signal?: AbortSignal): Promise<GalleryDto> =>
    transport.get(`/api/gallery/${encode(token)}`, undefined, signal),

  /**
   * The password, in a body and never in a URL. The answer is an `HttpOnly` cookie this
   * code cannot read, which the two reads beside it then carry.
   */
  unlockGallery: (token: string, password: string): Promise<void> =>
    transport.post(`/api/gallery/${encode(token)}/unlock`, { password }),

  galleryPhotos: (
    token: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<GalleryPage> =>
    transport.get(
      `/api/gallery/${encode(token)}/photos`,
      cursor === null ? undefined : { cursor },
      signal,
    ),
})
