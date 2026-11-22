import { useEffect, useRef, useState } from 'react'
import { readPrintPhoto, writePrintPhoto } from '../print/printPhoto'
import {
  readInvitePreferences,
  writeInvitePreferences,
  type InvitePreferences,
} from './tabs/invitePreferences'

/** A slider moves a hundred times a second: the screen follows at once, the storage once it rests. */
const SLIDER_REST_MS = 300

export interface InviteLook {
  readonly preferences: InvitePreferences
  /** Takes the choice at once and keeps it on this device. */
  readonly update: (next: InvitePreferences) => void
  /** Takes the choice at once and keeps it once it has rested (a slider). */
  readonly updateSoft: (next: InvitePreferences) => void
  readonly photoUrl: string | null
  readonly photoKept: boolean
  readonly choosePhoto: (url: string | null) => void
}

/**
 * What the host chose for the card and the image on this device (design, colour, photograph and
 * the options of each format), held **above** the formats: the look is set once, on the left, and
 * every format wears it. Nothing here leaves the device.
 */
export const useInviteLook = (slug: string): InviteLook => {
  const [preferences, setPreferences] = useState<InvitePreferences>(() =>
    readInvitePreferences(slug),
  )
  const [photoUrl, setPhotoUrl] = useState<string | null>(() => readPrintPhoto(slug))
  const [photoKept, setPhotoKept] = useState(true)
  const pending = useRef<InvitePreferences | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const flush = () => {
    window.clearTimeout(timer.current)
    if (pending.current === null) return
    writeInvitePreferences(slug, pending.current)
    pending.current = null
  }
  // Leaving the page writes what the slider last said.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (pending.current !== null) writeInvitePreferences(slug, pending.current)
    },
    [slug],
  )

  const update = (next: InvitePreferences) => {
    setPreferences(next)
    pending.current = next
    flush()
  }
  const updateSoft = (next: InvitePreferences) => {
    setPreferences(next)
    pending.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SLIDER_REST_MS)
  }
  const choosePhoto = (url: string | null) => {
    setPhotoUrl(url)
    setPhotoKept(writePrintPhoto(slug, url))
  }

  return { preferences, update, updateSoft, photoUrl, photoKept, choosePhoto }
}
