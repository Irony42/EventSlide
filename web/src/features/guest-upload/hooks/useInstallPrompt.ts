import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isInstalled,
  needsManualInstructions,
  rememberDismissal,
  wasDismissed,
} from '../../../lib/pwa/install'
import type { BeforeInstallPromptEvent } from '../../../lib/pwa/install'

/**
 * Whether to offer the guest a home-screen icon, and how.
 *
 * The offer is deliberately not made on arrival. A guest who has just scanned a QR code
 * is forty seconds from sending a photo, and a permission-shaped dialog in front of that
 * is friction at the worst possible moment — it is how a guest ends up sending nothing.
 * So the caller passes `eligible`, and the upload screen turns it on only after a photo
 * has actually arrived. By then the app has proved it is worth keeping.
 *
 * `beforeinstallprompt` has one property that shapes everything here: the browser fires
 * it when *it* is ready, which may be before this screen mounts, and it can only be
 * answered once. So the event is captured as early as the hook exists and kept, rather
 * than listened for at the moment the guest presses anything.
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
   * arrived. Capturing the event still happens regardless; only the offer waits.
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
  const captured = useRef<BeforeInstallPromptEvent | null>(null)
  const [available, setAvailable] = useState(false)
  const [settled, setSettled] = useState(() => isInstalled() || wasDismissed())

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Without this the browser shows its own mini-infobar, which is the arrival-time
      // interruption this whole design exists to avoid.
      event.preventDefault()
      captured.current = event as BeforeInstallPromptEvent
      setAvailable(true)
    }

    const onInstalled = () => {
      captured.current = null
      setAvailable(false)
      setSettled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    // Fires when the app is installed by any route, including the browser's own menu.
    // Without it the card sits there offering something already done.
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    const event = captured.current
    if (event === null) return
    // Spent on use, whatever the answer: a `BeforeInstallPromptEvent` may be prompted
    // once, and a second call throws. Cleared first so a double-tap cannot reach it.
    captured.current = null
    setAvailable(false)

    try {
      await event.prompt()
      const { outcome } = await event.userChoice
      // "Not now" is remembered the same way an explicit dismissal is. A guest who
      // refused the browser's own dialog has answered the question.
      if (outcome === 'dismissed') rememberDismissal()
      setSettled(true)
    } catch {
      // A prompt raised outside a user gesture, or one the browser withdrew. Nothing to
      // tell the guest: they did not ask for this, and the photo is what they came for.
      setSettled(true)
    }
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
