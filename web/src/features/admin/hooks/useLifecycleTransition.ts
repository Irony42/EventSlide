import { useCallback, useState } from 'react'
import { useToast } from '../../../design-system/components/useToast'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventDto, EventStatus } from '../../../lib/api/dto'
import { confirmationFor, transitionNotice } from '../eventLifecycle'
import { useStatusChange } from './useEventActions'

/** One press on a lifecycle button: which event, from where, to where. */
export interface TransitionRequest {
  readonly slug: string
  readonly eventName: string
  readonly from: EventStatus
  readonly to: EventStatus
}

/**
 * Changing an event's status the way both pages do it: ask first where the move cannot be
 * taken back, say what changed in a toast of its own, and hand the server's answer to the page.
 *
 * Shared by the event page and the dashboard because the two had grown the same
 * unconfirmed, same-toast code side by side (revue UX 30/10, HOT-4, HOT-13, NAV-1): the rule
 * of which moves ask (`confirmationFor`) and what each says (`transitionNotice`) is one
 * table in `eventLifecycle.ts`, and this is the only place that applies it.
 */
export const useLifecycleTransition = (onChanged: (event: EventDto) => void) => {
  const t = useTranslations()
  const toast = useToast()
  const statusChange = useStatusChange()
  const { run: runChange } = statusChange
  const [asking, setAsking] = useState<TransitionRequest | null>(null)

  const perform = useCallback(
    (request: TransitionRequest) => {
      void runChange(`${request.slug}:${request.to}`, request.slug, request.to).then((result) => {
        setAsking(null)
        if (!result.ok) {
          toast.show(result.message, { tone: 'danger' })
          return
        }
        // The answer is the whole event, so the screen updates from what the server
        // decided rather than from what the client hoped.
        toast.show(transitionNotice(request.from, request.to, t), { tone: 'success' })
        onChanged(result.value)
      })
    },
    [runChange, toast, t, onChanged],
  )

  const request = useCallback(
    (next: TransitionRequest) => {
      if (confirmationFor(next.from, next.to) === null) perform(next)
      else setAsking(next)
    },
    [perform],
  )

  return {
    request,
    asking,
    confirm: () => {
      if (asking !== null) perform(asking)
    },
    cancel: () => setAsking(null),
    busy: statusChange.busy,
    /** `slug:status` of the move in flight, to put a spinner on the one button pressed. */
    pending: statusChange.pending,
  }
}
