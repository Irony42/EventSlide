import { useCallback, useEffect, useRef, useState } from 'react'
import type { WallResponse } from '../../../lib/api/dto'
import { createWallSoundPlayer, type WallSoundPlayer } from '../../../lib/wallSoundPlayer'
import { detectArrivals, type WallSnapshot } from '../arrivals'
import { INITIAL_SOUND_GATE, decideRing, type SoundGate } from '../soundGate'

export interface WallSound {
  /** The host's switch (server). The only thing that can make this screen ring. */
  readonly enabled: boolean
  /** The browser lets this page play: a gesture has happened and `resume()` worked. */
  readonly active: boolean
  /** Fed with every successful read of the wall, changed or not. Stable. */
  readonly observe: (response: WallResponse) => void
  /** From a gesture (the icon, the `S` key): this screen carries the speakers. Never throws. */
  readonly activate: () => void
}

/** The only per-browser state of the whole wall: "this screen carries the speakers" (rule 6). */
export const wallSoundFlagKey = (slug: string): string => `eventslide.wallSound.${slug}`

const readFlag = (slug: string): boolean => {
  try {
    return window.localStorage.getItem(wallSoundFlagKey(slug)) === '1'
  } catch {
    return false
  }
}

const writeFlag = (slug: string): void => {
  try {
    window.localStorage.setItem(wallSoundFlagKey(slug), '1')
  } catch {
    // The page works without it: the screen is merely presented as muted after a reload.
  }
}

/**
 * Wires the pure gate to the wall's reads (spec 12). One `AudioContext` for the whole evening,
 * created by a gesture; the previous read in a ref (never a growing set); no timer of its own.
 *
 * A wall that reloaded has no gesture yet: it tries `resume()` (a kiosk browser may allow it),
 * says nothing if it fails, and stays muted until the first click or key. It does not loop.
 */
export const useWallSound = (slug: string, makePlayer = createWallSoundPlayer): WallSound => {
  const player = useRef<WallSoundPlayer | null>(null)
  const snapshot = useRef<WallSnapshot | null>(null)
  const gate = useRef<SoundGate>(INITIAL_SOUND_GATE)
  const [sound, setSound] = useState<WallResponse['sound'] | undefined>(undefined)
  const soundRef = useRef(sound)
  const [active, setActive] = useState(false)

  const current = useCallback((): WallSoundPlayer => {
    player.current ??= makePlayer()
    return player.current
  }, [makePlayer])

  const enabled = sound?.enabled === true
  const tone = sound?.tone ?? 'chime'
  const volume = sound?.volume ?? 0

  const tryResume = useCallback(async () => {
    setActive(await current().activate())
  }, [current])

  const activate = useCallback(() => {
    writeFlag(slug)
    void tryResume().then(async () => {
      const latest = soundRef.current
      if (latest === undefined || !latest.enabled || latest.volume === 0) return
      const active = current()
      await active.load(latest.tone)
      // The test sound of the activation: the browser is now allowed, and the room hears it.
      active.play(latest.tone, latest.volume)
    })
  }, [slug, tryResume, current])

  const observe = useCallback((response: WallResponse) => {
    soundRef.current = response.sound
    setSound((previous) =>
      previous?.enabled === response.sound?.enabled &&
      previous?.tone === response.sound?.tone &&
      previous?.volume === response.sound?.volume
        ? previous
        : response.sound,
    )
    const taken: WallSnapshot = {
      items: response.items.map((item) => ({ id: item.id, kind: item.kind })),
      total: response.souvenirCount ?? null,
      at: Date.now(),
    }
    // The reference moves on every read, so a switch turned on later never rings for what
    // was already there; the verdict is the one spec 11 uses.
    const arrivals = detectArrivals(snapshot.current, taken)
    snapshot.current = taken

    const live = response.sound
    if (live?.enabled !== true || live.volume === 0) return
    const decision = decideRing(gate.current, arrivals, taken.at)
    if (!decision.ring || player.current === null || !player.current.running()) return
    gate.current = decision.gate
    // A tone whose fetch failed is asked for again at every chime (the player caches only a
    // success): this chime may stay silent, the next one will not.
    void player.current.load(live.tone)
    player.current.play(live.tone, live.volume)
  }, [])

  // Decode while idle, not at the first photo: no hitch in the middle of a slide. Volume 0 loads nothing.
  useEffect(() => {
    if (!enabled || volume === 0 || !active) return
    void current().load(tone)
  }, [enabled, volume, tone, active, current])

  // A screen that was activated before (flag) tries to resume at load and at every gesture.
  useEffect(() => {
    if (!enabled || active || !readFlag(slug)) return
    void tryResume()
    const onGesture = () => void tryResume()
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [enabled, active, slug, tryResume])

  useEffect(
    () => () => {
      player.current?.close()
      player.current = null
    },
    [],
  )

  return { enabled, active, observe, activate }
}
