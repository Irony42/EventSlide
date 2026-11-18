import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import { ApiError, RETRY_AFTER_DETAIL, isAbortError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  currentSaveEnvironment,
  saveHelpFor,
  saveStrategy,
  type SaveHelp,
} from '../../../lib/saveStrategy'

/**
 * One guest's tap on "Enregistrer" under a photograph: the request, and what to do with the
 * file that comes back (spec 24).
 *
 * View-state only. Whether a photograph may be saved is the server's decision and is made
 * again at every request: the host's switch, the guest's access, the photograph being on the
 * wall. This hook sends the tap, shows the answer, and hands every refusal that is not about
 * this one photograph to the page (`onRefused`), which owns the buttons of all of them.
 *
 * **One state per button: `idle | busy | ready | failed`.** `ready` is the second tap's: iOS
 * refuses `share()` when too long has passed since the finger touched the screen, which a
 * megabyte over venue Wi-Fi easily takes. The photograph is already here by then, so the
 * button says "Appuyez pour l'enregistrer" and the next tap opens the sheet **without asking the
 * server again**. A download that was lost to a stale gesture would cost the guest the photo and
 * the room a second megabyte.
 *
 * **What it never says.** A closed share sheet is not "saved": the browser does not tell the page
 * what the guest chose, so the button simply becomes "Enregistrer" again. A guest who dismisses
 * the sheet gets no message at all (an `AbortError` is a decision, not a fault). "Photo
 * téléchargée" is said only for a real download, where the browser did write the file.
 *
 * **It never asks twice on its own.** A `429` or `503` (the server's limits, with their
 * `Retry-After`) disables the button for that long and says so; a room of phones retrying
 * together is what those limits are there to stop.
 */

export type SavePhase = 'idle' | 'busy' | 'ready' | 'failed'

/**
 * What a save refusal means for the whole feed rather than for one photograph: the host switched
 * saving off, the guest's access was withdrawn, the guest's access expired, the photograph is
 * gone, or the evening is no longer served.
 */
export type SaveRefusal = 'disabled' | 'revoked' | 'expired' | 'gone' | 'unavailable'

/** What went wrong, as a fact: the sentence is composed at render, in the language then on screen. */
type Failure =
  | { readonly kind: 'network' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'mediaMissing' }
  | { readonly kind: 'other'; readonly cause: unknown }

/** How long the server asks a phone to wait when it does not say (`STREAM_RETRY_AFTER_SECONDS`). */
const DEFAULT_RETRY_AFTER_SECONDS = 30

/** How long a created object address is kept: the download manager reads it after the click. */
const OBJECT_URL_LIFETIME_MS = 60_000

export interface PhotoSaveState {
  readonly phase: SavePhase
  /** The button cannot be pressed: working, or waiting out the server's `Retry-After`, or the photograph is gone. */
  readonly disabled: boolean
  /** A sentence in the guest's language about a failure of this photograph; `null` when nothing failed. */
  readonly error: string | null
  /** Said once after a real download. */
  readonly downloaded: boolean
  /** The one help line, when this tap was the device's first. */
  readonly help: SaveHelp
  readonly press: () => void
}

export interface PhotoSaveOptions {
  readonly slug: string
  readonly photoId: string
  /** A refusal the page must act on: it removes the buttons, says why, or reads the feed again. */
  readonly onRefused: (reason: SaveRefusal) => void
  /**
   * Asked on a tap that is about to open the share sheet or start a download on an Apple
   * device: `true` the first time on this device (the page remembers), so the help is shown
   * once and not on every photograph.
   */
  readonly claimHelp: () => boolean
}

const refusalOf = (cause: unknown): SaveRefusal | null => {
  if (!(cause instanceof ApiError)) return null
  if (cause.status === 401) return 'expired'
  if (cause.status === 403 && cause.code === 'guest.revoked') return 'revoked'
  if (cause.status === 403 && cause.code === 'save.disabled') return 'disabled'
  if (cause.status === 404 && cause.code === 'event.notFound') return 'unavailable'
  if (cause.status === 404 && cause.code === 'photo.notFound') return 'gone'
  return null
}

const failureOf = (cause: unknown): Failure => {
  if (cause instanceof ApiError) {
    if (cause.isNetwork) return { kind: 'network' }
    if (cause.status === 429 || cause.status === 503) return { kind: 'busy' }
    if (cause.status === 404 && cause.code === 'photo.notFound') return { kind: 'gone' }
    if (cause.status === 404 && cause.code === 'event.notFound') return { kind: 'unavailable' }
    if (cause.status === 404 && cause.code === 'photo.mediaMissing') return { kind: 'mediaMissing' }
  }
  return { kind: 'other', cause }
}

const retryAfterSecondsOf = (cause: unknown): number => {
  const wait = cause instanceof ApiError ? cause.details[RETRY_AFTER_DETAIL] : undefined
  return typeof wait === 'number' && wait > 0 ? wait : DEFAULT_RETRY_AFTER_SECONDS
}

/** The browser's own download of a file held in memory, as a link would have started it. */
const downloadFile = (file: File): void => {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS)
}

const errorNamed = (cause: unknown, name: string): boolean =>
  cause instanceof DOMException && cause.name === name

export const usePhotoSave = ({
  slug,
  photoId,
  onRefused,
  claimHelp,
}: PhotoSaveOptions): PhotoSaveState => {
  const t = useTranslations()
  const api = useApi()
  const [phase, setPhase] = useState<SavePhase>('idle')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [cooling, setCooling] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [help, setHelp] = useState<SaveHelp>(null)

  /** The photograph, once it has arrived and until it has been handed over. */
  const held = useRef<File | null>(null)
  const working = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      controller.current?.abort()
      if (cooldown.current !== null) clearTimeout(cooldown.current)
    }
  }, [])

  /** Opens the sheet with the photograph in hand. Nothing is said about how it ended. */
  const share = useCallback(async (file: File): Promise<void> => {
    try {
      await navigator.share({ files: [file] })
      held.current = null
      if (mounted.current) setPhase('idle')
    } catch (cause) {
      if (!mounted.current) return
      // A guest who closed the sheet decided something. Not a failure, and not "saved" either.
      if (isAbortError(cause)) {
        held.current = null
        setPhase('idle')
        return
      }
      // The tap that started the request is too old for the system to honour: keep the
      // photograph, and let the next tap, which is a fresh gesture, open the sheet.
      if (errorNamed(cause, 'NotAllowedError')) {
        held.current = file
        setPhase('ready')
        return
      }
      // The sheet cannot take this file after all: a download still gets it to the phone.
      held.current = null
      downloadFile(file)
      setDownloaded(true)
      setPhase('idle')
    }
  }, [])

  const press = useCallback((): void => {
    if (working.current || cooling) return

    // The second tap: the photograph is in memory, the gesture is fresh, no request.
    const waiting = held.current
    if (waiting !== null && phase === 'ready') {
      working.current = true
      void share(waiting).finally(() => {
        working.current = false
      })
      return
    }

    const env = currentSaveEnvironment()
    const strategy = saveStrategy(env)
    const helpKind = saveHelpFor(env, strategy)
    setHelp(helpKind !== null && claimHelp() ? helpKind : null)
    setFailure(null)
    setDownloaded(false)
    setPhase('busy')
    working.current = true
    const request = new AbortController()
    controller.current = request

    void (async () => {
      try {
        const saved = await api.savePhoto(slug, photoId, request.signal)
        if (!mounted.current) return
        const file = new File([saved.blob], saved.fileName ?? `${slug}-${photoId}.jpg`, {
          type: saved.blob.type === '' ? 'image/jpeg' : saved.blob.type,
        })
        if (strategy === 'share') {
          await share(file)
        } else {
          downloadFile(file)
          setDownloaded(true)
          setPhase('idle')
        }
      } catch (cause) {
        if (!mounted.current || isAbortError(cause)) return
        const refusal = refusalOf(cause)
        const fact = failureOf(cause)
        setFailure(fact)
        setPhase('failed')
        if (fact.kind === 'busy') {
          setCooling(true)
          cooldown.current = setTimeout(
            () => {
              cooldown.current = null
              if (mounted.current) setCooling(false)
            },
            retryAfterSecondsOf(cause) * 1000,
          )
        }
        if (refusal !== null) onRefused(refusal)
      } finally {
        working.current = false
      }
    })()
  }, [api, slug, photoId, phase, cooling, share, claimHelp, onRefused])

  const error = useMemo<string | null>(() => {
    if (failure === null) return null
    switch (failure.kind) {
      case 'network':
        return t.feed.saveNetworkFailed
      case 'busy':
        return t.feed.saveBusy
      case 'gone':
        return t.feed.saveGone
      case 'unavailable':
        return t.feed.unavailable
      case 'mediaMissing':
        return t.feed.saveMediaMissing
      case 'other':
        return messageForError(failure.cause, t)
    }
  }, [failure, t])

  return {
    phase,
    // A photograph that is gone or an evening that is not served has nothing left to save.
    disabled:
      phase === 'busy' ||
      cooling ||
      (phase === 'failed' && (failure?.kind === 'gone' || failure?.kind === 'unavailable')),
    error,
    downloaded,
    help,
    press,
  }
}
