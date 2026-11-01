import type { PhotoStatus } from '../photos/photoStatus'

/**
 * Whether a photograph goes into the book: `published` and nothing else.
 *
 * Not `isInAlbum`. The book is made to be handed on, like the shared gallery
 * (`isInSharedGallery`), and "hidden" means "not for the room". The ZIP keeps hidden photos
 * because it is the host's own archive.
 */
export const isInBook = (status: PhotoStatus): boolean => status === 'published'
