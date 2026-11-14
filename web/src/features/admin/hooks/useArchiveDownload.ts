import { useRef, type MouseEvent } from 'react'
import { useToast } from '../../../design-system/components/useToast'
import { probeArchive, startDownload } from '../../../lib/archiveDownload'
import { useTranslations } from '../../../lib/i18n/useTranslations'

/** What the server is given to see the aborted probe close before the real download asks. */
const SETTLE_MS = 250

/**
 * The click handler of a host export link (`album.zip`, `best-of.zip`): the link stays a link, and
 * a plain click first asks the server whether it will send the archive. A refusal becomes a toast
 * in the host's language; otherwise the browser's own download starts (see `lib/archiveDownload`).
 * A click with a modifier (a new tab, "save link as") is left to the browser.
 */
export function useArchiveDownload(): (event: MouseEvent<HTMLAnchorElement>) => void {
  const t = useTranslations()
  const toast = useToast()
  // One question at a time: a second click while the server is still answering would start a
  // second probe and a second download, and the second export slot is not free yet.
  const asking = useRef(false)

  return (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    if (asking.current) return
    asking.current = true
    const url = event.currentTarget.getAttribute('href')
    if (url === null) return
    void probeArchive(url).then(async (refusal) => {
      asking.current = false
      if (refusal === null) {
        // The aborted probe's slot is given back when the server sees the connection close.
        await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS))
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
