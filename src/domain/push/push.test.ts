import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../shared/ids'
import {
  DEFAULT_PUSH_HOSTS,
  PUSH_ENDPOINT_MAX_CHARS,
  parsePushEndpoint,
  parsePushHosts,
  pushHostAllowed,
} from './pushEndpoint'
import {
  PUSH_MIN_INTERVAL_MS,
  PUSH_PAYLOAD_MAX_BYTES,
  noticePayload,
  pushBatchWait,
  rsvpNotice,
} from './pushNotice'
import {
  MAX_PUSH_FAILURES,
  MAX_PUSH_SENDS_PER_MESSAGE,
  PushSubscription,
  parsePushKeys,
  selectForDelivery,
} from './pushSubscription'

const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('which hosts may be called', () => {
  it('allows the four push services of the browsers, and a wildcard needs a label in front', () => {
    expect(pushHostAllowed('fcm.googleapis.com', DEFAULT_PUSH_HOSTS)).toBe(true)
    expect(pushHostAllowed('updates.push.services.mozilla.com', DEFAULT_PUSH_HOSTS)).toBe(true)
    expect(pushHostAllowed('db5p.notify.windows.com', DEFAULT_PUSH_HOSTS)).toBe(true)
    expect(pushHostAllowed('web.push.apple.com', DEFAULT_PUSH_HOSTS)).toBe(true)
    expect(pushHostAllowed('push.services.mozilla.com', DEFAULT_PUSH_HOSTS)).toBe(false)
    expect(pushHostAllowed('notify.windows.com', DEFAULT_PUSH_HOSTS)).toBe(false)
  })

  it('does not take a name that merely ends or starts like an allowed one', () => {
    for (const host of [
      'evilfcm.googleapis.com',
      'fcm.googleapis.com.evil.test',
      'xpush.services.mozilla.com',
      'web.push.apple.com.evil.test',
      'evil.test',
    ]) {
      expect(pushHostAllowed(host, DEFAULT_PUSH_HOSTS)).toBe(false)
    }
  })

  it('reads the operator’s list, and refuses an IP address, a bad name or nothing', () => {
    expect(parsePushHosts(' Push.Example.org , *.push.example.net ')).toEqual([
      'push.example.org',
      '*.push.example.net',
    ])
    for (const bad of [
      '',
      ' , ',
      '10.0.0.1',
      '*.10.0.1',
      'localhost',
      'a b.test',
      'https://x.test',
      '*',
      '*.',
    ]) {
      expect(parsePushHosts(bad)).toBeNull()
    }
  })
})

describe('an endpoint a browser sent', () => {
  const judge = (raw: unknown) => parsePushEndpoint(raw, DEFAULT_PUSH_HOSTS)

  it('is taken when it is an https address of an allowed push service, host lower-cased', () => {
    expect(judge('https://FCM.googleapis.com/fcm/send/abc?x=1')).toEqual({
      ok: true,
      value: 'https://fcm.googleapis.com/fcm/send/abc?x=1',
    })
    expect(judge('https://web.push.apple.com')).toEqual({
      ok: true,
      value: 'https://web.push.apple.com',
    })
  })

  it.each([
    ['not text', 4],
    ['empty', ''],
    ['http', 'http://fcm.googleapis.com/x'],
    ['another scheme', 'file:///etc/passwd'],
    ['credentials', 'https://user:pw@fcm.googleapis.com/x'],
    ['a port', 'https://fcm.googleapis.com:8443/x'],
    ['a fragment', 'https://fcm.googleapis.com/x#a'],
    ['a space', 'https://fcm.googleapis.com/x y'],
    ['no host', 'https:///x'],
    ['a non-ASCII host', 'https://fcm.googlеapis.com/x'],
    ['an IPv6 literal', 'https://[::1]/x'],
    ['too long', 'https://fcm.googleapis.com/' + 'a'.repeat(PUSH_ENDPOINT_MAX_CHARS)],
  ])('refuses %s as push.endpointInvalid', (_name, raw) => {
    expect(code(judge(raw))).toBe('push.endpointInvalid')
  })

  it.each([
    ['an IPv4 address', 'https://127.0.0.1/x'],
    ['a private address', 'https://10.0.0.8/x'],
    ['localhost', 'https://localhost/x'],
    ['an internal name', 'https://metadata.google.internal/x'],
    ['a host that only looks allowed', 'https://fcm.googleapis.com.evil.test/x'],
    ['a trailing dot', 'https://fcm.googleapis.com./x'],
    ['a double dot', 'https://a..notify.windows.com/x'],
  ])('refuses %s as push.endpointNotAllowed', (_name, raw) => {
    expect(code(judge(raw))).toBe('push.endpointNotAllowed')
  })

  it('judges by the list it is given: a narrowed list refuses what it allowed', () => {
    expect(parsePushEndpoint('https://fcm.googleapis.com/x', ['web.push.apple.com']).ok).toBe(false)
    expect(parsePushEndpoint('https://push.example.org/x', ['push.example.org']).ok).toBe(true)
  })
})

describe('the keys of a subscription', () => {
  const p256dh = 'B' + 'A'.repeat(86)
  const auth = 'A'.repeat(22)

  it('takes a 65-byte uncompressed point and a 16-byte secret, by shape', () => {
    expect(parsePushKeys({ p256dh, auth })).toEqual({ ok: true, value: { p256dh, auth } })
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['a point of the wrong length', { p256dh: 'B' + 'A'.repeat(85), auth }],
    ['a point not marked uncompressed', { p256dh: 'C' + 'A'.repeat(86), auth }],
    ['a secret of the wrong length', { p256dh, auth: 'A'.repeat(21) }],
    ['characters outside base64url', { p256dh: 'B' + '+'.repeat(86), auth }],
    ['padding', { p256dh, auth: auth + '==' }],
    ['no secret', { p256dh }],
  ])('refuses %s as push.keysInvalid', (_name, raw) => {
    expect(code(parsePushKeys(raw))).toBe('push.keysInvalid')
  })

  it('holds a subscription as it was given', () => {
    const at = new Date('2026-11-23T10:00:00.000Z')
    const subscription = PushSubscription.create({
      id: 's-1',
      userId: asUserId('u-1'),
      eventId: asEventId('e-1'),
      endpoint: 'https://fcm.googleapis.com/x',
      p256dh,
      auth,
      createdAt: at,
    })

    expect([
      subscription.id,
      subscription.userId,
      subscription.eventId,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      subscription.createdAt,
    ]).toEqual(['s-1', 'u-1', 'e-1', 'https://fcm.googleapis.com/x', p256dh, auth, at])
  })
})

describe('which browsers a message goes to', () => {
  const make = (id: string, user: string, at: number) =>
    PushSubscription.create({
      id,
      userId: asUserId(user),
      eventId: asEventId('e-1'),
      endpoint: `https://fcm.googleapis.com/${id}`,
      p256dh: 'B' + 'A'.repeat(86),
      auth: 'A'.repeat(22),
      createdAt: new Date(at),
    })
  const ids = (list: readonly PushSubscription[]) => list.map((s) => s.id)

  it('keeps its bounds: five failures in a row, fifty browsers a message', () => {
    expect([MAX_PUSH_FAILURES, MAX_PUSH_SENDS_PER_MESSAGE]).toEqual([5, 50])
  })

  it('takes everything under the cap, one account after the other, newest browser first', () => {
    const all = [make('a1', 'a', 1), make('a2', 'a', 2), make('b1', 'b', 3)]

    expect(ids(selectForDelivery(all, 10))).toEqual(['a2', 'b1', 'a1'])
  })

  it('goes round the accounts and stops at the cap, even in the middle of a round', () => {
    const all = [
      make('a1', 'a', 1),
      make('a2', 'a', 2),
      make('a3', 'a', 3),
      make('b1', 'b', 4),
      make('b2', 'b', 5),
      make('c1', 'c', 6),
    ]

    expect(ids(selectForDelivery(all, 4))).toEqual(['a3', 'b2', 'c1', 'a2'])
    expect(ids(selectForDelivery(all, 2))).toEqual(['a3', 'b2'])
    expect(selectForDelivery(all, 0)).toEqual([])
    expect(selectForDelivery([], 5)).toEqual([])
  })
})

describe('what a push says', () => {
  it('is the type, the event’s address and how many, and nothing a guest wrote', () => {
    const payload = noticePayload(rsvpNotice('fete-de-lea', 3))

    expect(JSON.parse(payload)).toEqual({ v: 1, type: 'rsvp.new', slug: 'fete-de-lea', count: 3 })
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual(['count', 'slug', 'type', 'v'])
  })

  it('stays far under what one record takes', () => {
    expect(noticePayload(rsvpNotice('a'.repeat(80), 1000)).length).toBeLessThan(
      PUSH_PAYLOAD_MAX_BYTES,
    )
  })

  it('waits for the rest of five minutes after a message, and not at all before the first', () => {
    const t0 = 1_000_000

    expect(PUSH_MIN_INTERVAL_MS).toBe(300_000)
    expect(pushBatchWait(null, t0)).toBe(0)
    expect(pushBatchWait(t0, t0)).toBe(300_000)
    expect(pushBatchWait(t0, t0 + 120_000)).toBe(180_000)
    expect(pushBatchWait(t0, t0 + 300_000)).toBe(0)
    expect(pushBatchWait(t0, t0 + 900_000)).toBe(0)
  })
})
