import { holdsVoiceSource } from '../../../domain/guestbook/guestbookVoiceState'
import type { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import type { MediaStore } from '../../ports/mediaStore'

/**
 * Takes a voice message's **bytes** off the disk, and nothing else: the helper both of the paths
 * that remove a recording call before they remove its row (`deleteGuestbookEntry`, the guest's own
 * removal, and `eraseGuestContribution`, "Tout effacer"; spec 25, section 10).
 *
 * **Bytes first, then the row**, for the reason a photograph's removal has (`removePhotoRecord`):
 * the row is the only record of the file's address, so removing it first would strand a recording
 * that nobody can name, which neither the guest's second try nor the retention purge could ever
 * find again. A crash between the two leaves a row whose file is gone, which is an ordinary state
 * (the lost-file path of the archive and of the media route). A failing delete **throws**: the row
 * stays, and the guest presses the button again.
 *
 * Which bytes: the **source** while it is still on the disk (`reserved`, `queued`, `running`, the
 * states that hold it) and the **output** once `ready`. A `failed` voice has neither: its source went
 * when it was given up, and its digest may by now be the very bytes of a fresh attempt of the same
 * guest, which a delete by digest would take with it.
 *
 * A recording **in the worker's hands** when this runs finishes against a row that is gone, which
 * `transcodeNextVoice` treats as "retired under me" and cleans up after.
 */
export type RemoveVoiceBytes = (entry: GuestbookEntry) => Promise<void>

export const makeRemoveVoiceBytes =
  ({ media }: { readonly media: Pick<MediaStore, 'delete'> }): RemoveVoiceBytes =>
  async (entry) => {
    const voice = entry.voice
    if (voice === null) return
    if (holdsVoiceSource(voice.state)) await media.delete(entry.eventId, voice.sourceHash)
    if (voice.state === 'ready' && voice.audioHash !== null) {
      await media.delete(entry.eventId, voice.audioHash)
    }
  }
