import type { MouseEvent } from 'react'
import { useToast } from '../../../design-system/components/useToast'
import { probeArchive, startDownload } from '../../../lib/archiveDownload'
import { useTranslations } from '../../../lib/i18n/useTranslations'

/**
 * The click handler of a host export link (`album.zip`, `best-of.zip`): the link stays a link, and
 * a plain click first asks the server whether it will send the archive. A refusal becomes a toast
 * in the host's language; otherwise the browser's own download starts (see `lib/archiveDownload`).
 * A click with a modifier (a new tab, "save link as") is left to the browser.
 */
export function useArchiveDownload(): (event: MouseEvent<HTMLAnchorElement>) => void {
  const t = useTranslations()
  const toast = useToast()

  return (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    const url = event.currentTarget.getAttribute('href')
    if (url === null) return
    void probeArchive(url).then((refusal) => {
      if (refusal === null) {
        startDownload(url)
        return
      }
      const message =
        refusal.reason === 'busy'
          ? t.admin.exportBusy(refusal.retryAfterSeconds)
          : refusal.reason === 'notReady'
            ? t.admin.exportNotReady(refusal.retryAfterSeconds)
            : t.admin.exportFailed
      toast.show(message, { tone: 'danger' })
    })
  }
}
