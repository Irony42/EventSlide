import { useCallback, useState } from 'react'
import type { Shots } from '../roll'
import { heldPoses, keepFirst, posesLeft } from '../roll'
import type { UploadItem } from './useUploadQueue'

export interface RollInput {
  /** The roll as the server last counted it, `null` with no cap. */
  readonly shots: Shots | null
  readonly items: readonly UploadItem[]
  /** Photographs the outbox keeps for the network. */
  readonly outboxWaiting: number
  readonly add: (files: readonly File[], missionId: string | null) => void
}

export interface Roll {
  /** Poses left by this phone's count, `null` with no cap. */
  readonly left: number | null
  readonly max: number | null
  /** No pose used or owed yet. */
  readonly fresh: boolean
  /** The roll is used up: nothing more can be chosen. `false` with no cap. */
  readonly empty: boolean
  /**
   * How many of the last pick were kept when it was cut to the poses left, or `null` when nothing
   * was set aside. Said by the screen while the batch is still waiting to be sent.
   */
  readonly keptNote: number | null
  /** Adds what the roll allows, the first photographs in the picker's order, and notes the rest. */
  readonly pick: (files: readonly File[], missionId: string | null) => void
}

/**
 * The roll of a disposable-camera evening on the guest's phone (spec 23): view-state over the
 * server's count. The rule is the server's (`event.photoLimitReached` stays the backstop); this is
 * what stops a guest on bad Wi-Fi queuing thirty photos to find three refused at reconnection.
 */
export const useRoll = ({ shots, items, outboxWaiting, add }: RollInput): Roll => {
  const held = heldPoses(items, outboxWaiting)
  const left = posesLeft(shots, held)
  const [keptNote, setKeptNote] = useState<number | null>(null)

  const pick = useCallback(
    (files: readonly File[], missionId: string | null) => {
      const { kept, dropped } = keepFirst(files, left)
      setKeptNote(dropped > 0 ? kept.length : null)
      if (kept.length > 0) add(kept, missionId)
    },
    [left, add],
  )

  return {
    left,
    max: shots === null ? null : shots.max,
    fresh: shots !== null && shots.taken === 0 && held === 0,
    empty: left === 0,
    keptNote,
    pick,
  }
}
