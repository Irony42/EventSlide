import { describe, expect, it } from 'vitest'

/**
 * The worker's push wiring (spec 30, lot 4), read as text: `web/sw/` belongs to no vitest project (see
 * `names.test.ts`), so this is the one executable link between the worker and the logic it calls in
 * `pushNotice.ts`. What the handlers do with the message is tested there; what is held here is that
 * the worker listens, shows a notification for every push (a push that shows none is penalised by the
 * browsers), closes the notification on a click, and only follows a path inside the host's console.
 */

const sources = import.meta.glob('../../../sw/serviceWorker.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Readonly<Record<string, string>>
const worker = sources['../../../sw/serviceWorker.ts'] ?? ''

describe('the service worker’s push handlers', () => {
  it('found the worker to read', () => {
    expect(worker.length).toBeGreaterThan(1000)
  })

  it('shows a notification for every push, reading the message with the shared parser', () => {
    expect(worker).toMatch(/addEventListener\('push'/)
    expect(worker).toMatch(/parseRsvpNotice\(/)
    expect(worker).toMatch(/showNotification\(/)
    expect(worker).toMatch(/noticeText\(/)
    // One notification per event, replaced by the next.
    expect(worker).toMatch(
      /tag:\s*notice === null \? 'eventslide-rsvp' : notificationTag\(notice\.slug\)/,
    )
  })

  it('takes a click to the Réponses page through the shared helper, after closing the notification', () => {
    expect(worker).toMatch(/addEventListener\('notificationclick'/)
    expect(worker).toMatch(/event\.notification\.close\(\)/)
    expect(worker).toMatch(/openRepliesPage\(/)
    expect(worker).toMatch(/repliesPath\(notice\.slug\)/)
    // Only a path of the host's console is followed, whatever the notification holds.
    expect(worker).toMatch(/path\.startsWith\('\/admin'\)/)
  })

  it('reads the push-only mode from its storage, not from a variable that a restart forgets', () => {
    expect(worker).toMatch(/let pushOnly: Promise<boolean> = readPushOnly\(caches\)/)
    expect(worker).toMatch(/writePushOnly\(caches, true\)/)
    expect(worker).toMatch(/writePushOnly\(caches, false\)/)
  })

  it('waits for that answer before it fetches the shell, drains the outbox or precaches', () => {
    // Install: no shell is fetched in push-only mode.
    expect(worker).toMatch(/pushOnly\s*\.then\(\(only\) =>\s*only\s*\?\s*undefined/)
    // Fetch: the network answers in push-only mode.
    expect(worker).toMatch(/pushOnly\.then\(\(only\) =>\s*only\s*\?[^]*?fetch\(event\.request\)/)
    // Sync: nothing is drained in push-only mode.
    expect(worker).toMatch(
      /sync\.waitUntil\(pushOnly\.then\(\(only\) => \(only \? undefined : drainEverything\(\)\)\)\)/,
    )
  })

  it('leaves push-only mode when the page says the queue is on again', () => {
    expect(worker).toMatch(/QUEUE_ON_MESSAGE/)
    expect(worker).toMatch(/pushOnly = Promise\.resolve\(false\)/)
    expect(worker).toMatch(/pushOnly = Promise\.resolve\(true\)/)
  })

  it('buzzes again for a second message of the same event', () => {
    expect(worker).toMatch(/renotify: true/)
  })
})
