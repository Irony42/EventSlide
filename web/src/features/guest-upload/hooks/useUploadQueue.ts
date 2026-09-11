import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { fr, messageForCode } from '../../../lib/i18n/fr'
import { downscaleImage } from './downscaleImage'

/**
 * The upload queue: the one piece of state this feature genuinely owns.
 *
 * It is view-state, not a rule. Whether a file is an acceptable photo, how large it
 * may be and how many a guest may send are all the server's answers — the queue only
 * decides what the guest can see and press while those answers are on their way.
 */

export type UploadItemState =
  | 'pending'
  | 'preparing'
  | 'uploading'
  | 'done'
  /** Success, not failure: the same bytes are already in this event. */
  | 'duplicate'
  | 'failed'

export interface UploadItem {
  readonly id: string
  readonly file: File
  readonly previewUrl: string
  readonly state: UploadItemState
  /** 0-100, from the transport's upload progress events. */
  readonly progress: number
  /** A French sentence, ready to render. `null` while nothing has failed. */
  readonly error: string | null
  readonly photoId: string | null
  /** Whether offering "Réessayer" would be honest. A client fault fails again. */
  readonly retryable: boolean
}

export interface UploadQueueOptions {
  readonly slug: string
  /**
   * Shrinks a photo before it goes up. Injected because jsdom has no canvas, which is
   * the only reason this hook can be tested at all; the default is the real thing.
   */
  readonly resize?: (file: File) => Promise<File>
  /** Called when a batch has finished, whatever the outcome. */
  readonly onSettled?: () => void
}

export interface UploadQueue {
  readonly items: readonly UploadItem[]
  readonly sending: boolean
  /** How many photos a press of "Envoyer" would actually send. */
  readonly sendableCount: number
  readonly add: (files: readonly File[]) => void
  readonly remove: (id: string) => void
  readonly retry: (id: string) => void
  readonly send: (caption: string | null) => void
}

const SETTLED: readonly UploadItemState[] = ['done', 'duplicate']

export const useUploadQueue = (options: UploadQueueOptions): UploadQueue => {
  const { slug, resize = downscaleImage, onSettled } = options
  const api = useApi()

  const [items, setItems] = useState<readonly UploadItem[]>([])
  const [sending, setSending] = useState(false)

  /**
   * The queue, mirrored outside React state.
   *
   * The sequential runner has to read the queue as it is *now* — after a progress
   * event, after the guest removed the next photo in line — and a closure over the
   * rendered `items` is a snapshot of the past. One writer keeps the two from
   * drifting.
   */
  const itemsRef = useRef<readonly UploadItem[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const running = useRef(false)
  const caption = useRef<string | null>(null)
  const lastId = useRef(0)

  const commit = useCallback((next: readonly UploadItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const patch = useCallback(
    (id: string, changes: Partial<UploadItem>) => {
      commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item)))
    },
    [commit],
  )

  const add = useCallback(
    (files: readonly File[]) => {
      const arrived = files.map((file): UploadItem => {
        lastId.current += 1
        return {
          id: `upload-${lastId.current}`,
          file,
          previewUrl: URL.createObjectURL(file),
          state: 'pending',
          progress: 0,
          error: null,
          photoId: null,
          retryable: false,
        }
      })

      // A photo that arrived is listed under "Vos envois" now, so leaving it here
      // would report it twice — and would shift every `upload-item-<n>` that the
      // guest and the e2e suite read positionally.
      const kept = itemsRef.current.filter((item) => {
        if (!SETTLED.includes(item.state)) return true
        URL.revokeObjectURL(item.previewUrl)
        return false
      })

      commit([...kept, ...arrived])
    },
    [commit],
  )

  const remove = useCallback(
    (id: string) => {
      // Aborted first: a removed row whose request kept running would spend the
      // guest's remaining bandwidth on a photo they just took back.
      controllers.current.get(id)?.abort()
      const target = itemsRef.current.find((item) => item.id === id)
      if (target !== undefined) URL.revokeObjectURL(target.previewUrl)
      commit(itemsRef.current.filter((item) => item.id !== id))
    },
    [commit],
  )

  const uploadOne = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id)
      if (item === undefined) return

      patch(id, { state: 'preparing', progress: 0, error: null, retryable: false })
      // `resize` contracts never to lose a photo, but a rejected promise here would
      // leave the row stuck on "Préparation" for the rest of the evening.
      const prepared = await resize(item.file).catch(() => item.file)
      if (!itemsRef.current.some((candidate) => candidate.id === id)) return

      const controller = new AbortController()
      controllers.current.set(id, controller)
      patch(id, { state: 'uploading', progress: 0 })

      try {
        const response = await api.uploadPhotos(slug, {
          files: [prepared],
          caption: caption.current,
          onProgress: (progress) => patch(id, { progress: progress.percent }),
          signal: controller.signal,
        })

        const outcome = response.results[0]
        if (outcome === undefined) {
          patch(id, { state: 'failed', progress: 0, error: fr.errors.unknown, retryable: true })
          return
        }
        if (outcome.status === 'rejected') {
          // The server judged the file itself: an unsupported format, too many pixels.
          // The same bytes fail the same way, so no retry is offered for it.
          patch(id, { state: 'failed', error: messageForCode(outcome.code), retryable: false })
          return
        }
        patch(id, {
          state: outcome.status === 'duplicate' ? 'duplicate' : 'done',
          progress: 100,
          photoId: outcome.photoId,
          error: null,
          retryable: false,
        })
      } catch (cause) {
        // An abort is this hook's own doing — the guest removed the row, or the screen
        // unmounted — and in both cases there is no row left to report it on.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        patch(id, {
          state: 'failed',
          progress: 0,
          error: cause instanceof ApiError ? cause.message : fr.errors.unknown,
          // A dropped connection is worth another press. A request the server refused
          // on its merits is not: it fails identically the second time.
          retryable: !(cause instanceof ApiError && cause.isClientFault),
        })
      } finally {
        controllers.current.delete(id)
      }
    },
    [api, patch, resize, slug],
  )

  const run = useCallback(
    async (ids: readonly string[]) => {
      if (running.current || ids.length === 0) return
      running.current = true
      setSending(true)
      try {
        // One at a time, deliberately. Four parallel uploads on a saturated venue
        // Wi-Fi finish later than four in a row, and they turn every progress bar
        // into a guess rather than a measurement.
        for (const id of ids) await uploadOne(id)
      } finally {
        running.current = false
        setSending(false)
        onSettled?.()
      }
    },
    [onSettled, uploadOne],
  )

  const send = useCallback(
    (batchCaption: string | null) => {
      // One caption for the batch, kept for the retries: a guest who wrote a caption
      // and then lost the connection must not lose the caption with it.
      caption.current = batchCaption
      const ids = itemsRef.current.filter((item) => item.state === 'pending').map((item) => item.id)
      void run(ids)
    },
    [run],
  )

  const retry = useCallback(
    (id: string) => {
      patch(id, { state: 'pending', progress: 0, error: null, retryable: false })
      void run([id])
    },
    [patch, run],
  )

  useEffect(() => {
    const inFlight = controllers.current
    return () => {
      for (const controller of inFlight.values()) controller.abort()
      inFlight.clear()
      // Thirty photos selected is thirty full-resolution bitmaps pinned in memory
      // until the tab closes. 1.0 revoked none of them.
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
      itemsRef.current = []
    }
  }, [])

  return {
    items,
    sending,
    sendableCount: items.filter((item) => item.state === 'pending').length,
    add,
    remove,
    retry,
    send,
  }
}
