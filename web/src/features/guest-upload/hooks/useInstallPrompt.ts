import { useCallback, useEffect, useState } from 'react'
import {
  hasCapturedPrompt,
  isInstalled,
  needsManualInstructions,
  onInstallStateChange,
  raiseInstallPrompt,
  rememberDismissal,
  wasDismissed,
  wasInstalledThisSession,
} from '../../../lib/pwa/install'

/**
 * Whether to offer the guest a home-screen icon, and how.
 *
 * The offer is deliberately not made on arrival. A guest who has just scanned a QR code
 * is forty seconds from sending a photo, and a permission-shaped dialog in front of that
 * is friction at the worst possible moment — it is how a guest ends up sending nothing.
 * So the caller passes `eligible`, and the upload screen turns it on only once a photo
 * has actually arrived. By then the app has proved it is worth keeping.
 *
 * The `beforeinstallprompt` event itself is **not** captured here, and that is the whole
 * reason `web/src/lib/pwa/install.ts` exists: the event fires once per document load,
 * and a guest's journey from `/join/:code` to `/e/:slug/upload` is a single document, so
 * by the time this screen mounts the event has already come and gone. The capture starts
 * at the composition root; this hook only subscribes to the result.
 */

export type InstallOffer =
  /** Nothing to offer: already installed, dismissed, unsupported, or not yet earned. */
  | { readonly kind: 'none' }
  /** Chromium: there is a real prompt to raise. */
  | { readonly kind: 'prompt' }
  /** iOS: no API, so the only thing to offer is the sentence explaining how. */
  | { readonly kind: 'instructions' }

export interface UseInstallPromptOptions {
  /**
   * Whether the guest has earned the offer yet — in practice, whether a photo has
   * arrived.
   */
  readonly eligible: boolean
}

export interface InstallPrompt {
  readonly offer: InstallOffer
  /** Raises the browser's prompt. Must be called from a user gesture, or it is ignored. */
  readonly install: () => Promise<void>
  /** "Not now", remembered across visits. */
  readonly dismiss: () => void
}

export const useInstallPrompt = ({ eligible }: UseInstallPromptOptions): InstallPrompt => {
  const [available, setAvailable] = useState(hasCapturedPrompt)
  const [settled, setSettled] = useState(() => isInstalled() || wasDismissed())

  useEffect(() => {
    const sync = () => {
      setAvailable(hasCapturedPrompt())
      if (wasInstalledThisSession()) setSettled(true)
    }
    // Read once on mount as well as on change: the event may have been captured before
    // this screen existed, which is the ordinary case rather than the exception.
    sync()
    return onInstallStateChange(sync)
  }, [])

  const install = useCallback(async () => {
    const outcome = await raiseInstallPrompt()
    // "Not now" is remembered the same way an explicit dismissal is: a guest who refused
    // the browser's own dialog has answered the question. `null` — nothing to raise, or
    // a prompt the browser refused — is not worth a word to a guest who did not ask for
    // this and came here to send a photo.
    if (outcome === 'dismissed') rememberDismissal()
    setSettled(true)
  }, [])

  const dismiss = useCallback(() => {
    rememberDismissal()
    setSettled(true)
  }, [])

  const offer = ((): InstallOffer => {
    if (settled || !eligible) return { kind: 'none' }
    if (available) return { kind: 'prompt' }
    // No captured event and an iOS browser: the instructions are the whole feature
    // there. Anywhere else, an absent event means the browser is not offering, and
    // inventing a card it cannot honour would be worse than silence.
    if (needsManualInstructions()) return { kind: 'instructions' }
    return { kind: 'none' }
  })()

  return { offer, install, dismiss }
}
