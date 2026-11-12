import { lazy, startTransition, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  moderationViewFor,
  onPhone,
  rememberModerationView,
  rememberedModerationView,
  type ModerationView,
} from '../../lib/moderationView'

/**
 * Each screen is its own chunk: the two share their hooks and nothing else, and a host who only
 * ever opens one of them should not be downloading the other's grid, lightbox and keyboard layer
 * over a venue's Wi-Fi. The router's `Suspense` shows the wait.
 */
const ModerationPage = lazy(async () => ({
  default: (await import('./ModerationPage')).ModerationPage,
}))
const MobileModerationPage = lazy(async () => ({
  default: (await import('./MobileModerationPage')).MobileModerationPage,
}))

/**
 * `/admin/events/:slug/moderation`: the one address of an event's queue, for the host and the
 * moderator, whatever they hold.
 *
 * The phone's screen and the laptop's are two views over the same queue, the same endpoints and
 * the same stream (`MobileModerationPage` says why they are not one view made narrower). Which
 * one opens is `lib/moderationView.ts`'s answer: the choice remembered on this device, otherwise
 * the device's shape. Each screen carries the button to the other, and pressing it is a choice
 * this device then remembers.
 */
export function ModerationRoute() {
  const [view, setView] = useState<ModerationView>(() =>
    moderationViewFor(rememberedModerationView(), onPhone()),
  )
  const switched = useRef(false)

  const switchTo = (next: ModerationView) => {
    rememberModerationView(next)
    switched.current = true
    // A transition, because the other screen is a chunk that may not be loaded yet: the screen
    // in hand stays up until the new one can replace it, instead of the router's fallback hiding
    // it — and the focus below then lands on a heading that is on screen.
    startTransition(() => {
      setView(next)
    })
  }

  // The button that was pressed has gone with the screen it was on: the keyboard and the screen
  // reader are taken to the new screen's heading rather than left on the document's body. Only
  // after a switch: on arrival the focus is the browser's, like on every other page.
  useEffect(() => {
    if (!switched.current) return
    // Each screen has exactly one `h1`, its title, and the app's header has none.
    const heading = document.querySelector('h1')
    if (heading === null) return
    heading.tabIndex = -1
    heading.focus()
  }, [view])

  return view === 'phone' ? (
    <MobileModerationPage onSwitchView={() => switchTo('desktop')} />
  ) : (
    <ModerationPage onSwitchView={() => switchTo('phone')} />
  )
}

/**
 * `/admin/events/:slug/moderation/mobile`, the phone's address before there was one address.
 * Bookmarks, the home-screen shortcut of a host's phone and older invitation mails still lead
 * here. The address named the phone's screen, so following it is that choice: it is remembered,
 * and the queue opens at its one address, with its query (`?vue=messages`) intact.
 */
export function PhoneModerationRedirect() {
  const { search } = useLocation()
  rememberModerationView('phone')
  return <Navigate to={{ pathname: '..', search }} relative="path" replace />
}
