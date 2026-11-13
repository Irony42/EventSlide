import { useEffect, useState } from 'react'
import { createReadScheduler, type ReadScheduler } from './readScheduler'

/**
 * A `ReadScheduler` that lives as long as the component and is cancelled with it.
 *
 * `start` is handed over after each render rather than being a dependency, so a new function
 * identity does not rebuild the scheduler (which would forget the stale mark and the read in
 * flight). The returned object is stable.
 */
export const useReadScheduler = (
  start: () => Promise<unknown> | void,
  options: { readonly debounceMs?: number; readonly tracksSettlement?: boolean } = {},
): ReadScheduler => {
  const { debounceMs, tracksSettlement } = options
  const [scheduler] = useState(() => createReadScheduler({ start, debounceMs, tracksSettlement }))
  useEffect(() => {
    scheduler.retarget(start)
  }, [scheduler, start])
  useEffect(() => () => scheduler.cancel(), [scheduler])
  return scheduler
}
