import type { OutboxEntry } from '../../lib/offline/outbox'

/**
 * Hands a recording the phone is holding back to the guest as a file ("Enregistrer sur mon
 * téléphone", spec 25): the way out of a refusal of the moment (the host switched the voices off, a
 * ceiling is reached), so a recording that cannot be sent is never a recording lost.
 *
 * A download of the bytes the queue kept, through an object URL that is released at once. Resolves
 * to whether a file was offered; it never throws, because the button is the guest's last resort and
 * a failure has no one to report to.
 */
export const saveRecordingToPhone = (entry: OutboxEntry): boolean => {
  if (typeof URL.createObjectURL !== 'function') return false
  try {
    const url = URL.createObjectURL(new Blob([entry.bytes], { type: entry.fileType }))
    const link = document.createElement('a')
    link.href = url
    link.download = entry.fileName
    document.body.append(link)
    link.click()
    link.remove()
    // After the click has been handled: some browsers read the URL asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}
