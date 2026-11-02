import { useEffect, useRef, useState } from 'react'
import type { WallGuestbookDto, WallGuestbookMessageDto } from '../../../lib/api/dto'

export interface WallGuestbook {
  /** The card on screen now, or `null`. While it is up the slideshow holds still. */
  readonly message: WallGuestbookMessageDto | null
}

/**
 * When the room reads a guestbook message (spec 01).
 *
 * It counts photograph changes (`generation`, which only rises when the wall changes photo) and,
 * every `everyNth` of them, puts the next message up for its `displayMs`. Both numbers are the
 * **server's**, received in `/wall`: the browser has no opinion on the rhythm. Messages go round
 * in order and start again at the first, so a long evening shows every message more than once
 * rather than the last one forever. A message taken off the wall mid-evening shrinks the list
 * under the cursor, which wraps rather than skipping.
 *
 * Nothing at all when there is no guestbook on the response: a wall that does not use the feature
 * is exactly the wall it was.
 */
export const useWallGuestbook = (
  guestbook: WallGuestbookDto | undefined,
  generation: number,
): WallGuestbook => {
  const [message, setMessage] = useState<WallGuestbookMessageDto | null>(null)
  const seen = useRef(generation)
  const cursor = useRef(0)
  const latest = useRef(guestbook)

  useEffect(() => {
    latest.current = guestbook
  }, [guestbook])

  useEffect(() => {
    if (generation === seen.current) return
    seen.current = generation

    const book = latest.current
    if (book === undefined || book.messages.length === 0 || book.everyNth <= 0) return
    if (generation % book.everyNth !== 0) return

    const next = book.messages[cursor.current % book.messages.length]
    cursor.current += 1
    if (next === undefined) return
    setMessage(next)
  }, [generation])

  const showing = message?.id ?? null
  const displayMs = message?.displayMs ?? 0
  useEffect(() => {
    if (showing === null) return
    const timer = window.setTimeout(() => setMessage(null), displayMs)
    return () => window.clearTimeout(timer)
  }, [showing, displayMs])

  // A message that left the response (taken off, or the switch turned off) goes with it.
  const stillThere = message !== null && guestbook?.messages.some((m) => m.id === message.id)
  return { message: stillThere === true ? message : null }
}
