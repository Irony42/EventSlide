import { useEffect } from 'react'

/**
 * Re-read the server's answer when the host comes back to the tab.
 *
 * `useLoader` is a one-shot read: it fetches when the page mounts and then never again
 * unless something asks it to. That is right for every admin screen whose data only
 * changes when the host themselves changes it — and wrong for the one screen whose data
 * a background job rewrites.
 *
 * The failure it closes: the host opens the settings page at 17:50 with an opening armed
 * for 18:00. At 18:00 the sweep opens the event and spends the instant. The form still
 * shows 18:00, because nothing told it otherwise. At 20:30 the host adjusts the closing
 * time and saves — and sends back an opening two and a half hours in the past. With the
 * past-instant guard in `Event.reschedule` that is now a refusal rather than a silent
 * re-arming, but a refusal on a form showing values the server no longer holds is still
 * a screen lying to its reader.
 *
 * Both events are listened for, because they answer different questions:
 * `visibilitychange` covers a background tab being returned to, `focus` covers a window
 * that was behind another one on the same screen — a host with the console and the
 * projector's window side by side never fires the first.
 *
 * It is deliberately **not** in `useLoader`: every other admin read would then refetch on
 * every tab switch for no benefit, and the moderation queue already has an SSE stream
 * doing this properly.
 */
export const useRevalidateWhenVisible = (revalidate: () => void): void => {
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') revalidate()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [revalidate])
}
