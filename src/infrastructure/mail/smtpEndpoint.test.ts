import { describe, expect, it } from 'vitest'
import type { Result } from '../../domain/shared/result'
import { isLoopbackHost, parseMailbox, parseSmtpUrl } from './smtpEndpoint'

const TAB = String.fromCodePoint(0x09)
const LF = String.fromCodePoint(0x0a)

const valueOf = <T>(result: Result<T, string>): T => {
  if (!result.ok) throw new Error(`expected a value, got: ${result.error}`)
  return result.value
}

const reasonOf = <T>(result: Result<T, string>): string | null => (result.ok ? null : result.error)

describe('parseSmtpUrl', () => {
  it('reads an smtp URL as a STARTTLS endpoint on the submission port', () => {
    expect(valueOf(parseSmtpUrl('smtp://mail.example.com'))).toEqual({
      host: 'mail.example.com',
      port: 587,
      implicitTls: false,
      credentials: null,
    })
  })

  it('reads an smtps URL as implicit TLS on port 465', () => {
    expect(valueOf(parseSmtpUrl('smtps://mail.example.com'))).toMatchObject({
      port: 465,
      implicitTls: true,
    })
  })

  it('keeps an explicit port, and accepts the one a local relay uses', () => {
    expect(valueOf(parseSmtpUrl('smtp://localhost:1025')).port).toBe(1025)
    expect(valueOf(parseSmtpUrl('smtp://mail.example.com:25')).port).toBe(25)
  })

  it('reads the credentials out of the URL', () => {
    const endpoint = valueOf(parseSmtpUrl('smtps://camille:s3cret@mail.example.com:465'))

    expect(endpoint.credentials).toEqual({ username: 'camille', password: 's3cret' })
  })

  it('percent-decodes the credentials, so a password may hold any character once encoded', () => {
    const endpoint = valueOf(parseSmtpUrl('smtps://ca%40mille:p%40ss%2Fw%3Ard@mail.example.com'))

    expect(endpoint.credentials).toEqual({ username: 'ca@mille', password: 'p@ss/w:rd' })
  })

  it('tolerates a bare at sign in the password, which the URL parser encodes itself', () => {
    const endpoint = valueOf(parseSmtpUrl('smtps://camille:p@ss@mail.example.com'))

    expect(endpoint.credentials).toEqual({ username: 'camille', password: 'p@ss' })
    expect(endpoint.host).toBe('mail.example.com')
  })

  it('lower-cases the host and strips the brackets of an IPv6 literal, which is what a socket wants', () => {
    expect(valueOf(parseSmtpUrl('smtp://Mail.Example.COM')).host).toBe('mail.example.com')
    expect(valueOf(parseSmtpUrl('smtp://[::1]:1025')).host).toBe('::1')
  })

  it('ignores the whitespace a quoted value brings along', () => {
    expect(valueOf(parseSmtpUrl('  smtp://mail.example.com  ')).host).toBe('mail.example.com')
  })

  it('accepts a single trailing slash, which says nothing', () => {
    expect(parseSmtpUrl('smtp://mail.example.com/').ok).toBe(true)
  })

  it.each([
    ['another scheme', 'https://mail.example.com'],
    ['no scheme', 'mail.example.com:587'],
    ['a scheme that looks close', 'smtp:mail.example.com'],
  ])('refuses %s', (_name, value) => {
    expect(parseSmtpUrl(value).ok).toBe(false)
  })

  it('names the scheme rule when the scheme is wrong', () => {
    expect(reasonOf(parseSmtpUrl('imap://mail.example.com'))).toBe(
      'must start with smtp:// or smtps://',
    )
  })

  it('refuses a URL with no host', () => {
    expect(reasonOf(parseSmtpUrl('smtp://'))).toBe('has no host')
    expect(reasonOf(parseSmtpUrl('smtp://:587'))).not.toBeNull()
  })

  it.each([
    ['a path', 'smtp://mail.example.com/queue'],
    ['a query string', 'smtp://mail.example.com?tls.rejectUnauthorized=false'],
    ['a fragment', 'smtp://mail.example.com#x'],
  ])(
    'refuses %s, because nothing here could mean it and a query string is where an unreviewed option hides',
    (_name, value) => {
      expect(reasonOf(parseSmtpUrl(value))).toBe(
        'must not have a path, a query string or a fragment',
      )
    },
  )

  it.each(['smtp://mail.example.com:0', 'smtp://mail.example.com:65536'])(
    'refuses the port in %s',
    (value) => {
      expect(parseSmtpUrl(value).ok).toBe(false)
    },
  )

  it('accepts the highest port there is', () => {
    expect(valueOf(parseSmtpUrl('smtp://mail.example.com:65535')).port).toBe(65_535)
  })

  it.each([
    ['a user with no password', 'smtps://camille@mail.example.com'],
    ['a user with an empty password', 'smtps://camille:@mail.example.com'],
    ['a password with no user', 'smtps://:s3cret@mail.example.com'],
  ])('refuses %s: a login is a pair', (_name, value) => {
    expect(reasonOf(parseSmtpUrl(value))).toBe(
      'must give a user and a password together, or neither',
    )
  })

  it('refuses credentials that are not validly percent-encoded', () => {
    expect(reasonOf(parseSmtpUrl('smtps://camille:100%zz@mail.example.com'))).toBe(
      'has credentials that are not validly percent-encoded',
    )
  })

  it.each([
    ['a tab in the middle', `smtp://mail.${TAB}example.com`],
    ['a line feed in the middle', `smtp://mail.${LF}example.com`],
    ['a space in the middle', 'smtp://mail .example.com'],
  ])('refuses %s, because the URL parser would silently delete it', (_name, value) => {
    expect(parseSmtpUrl(value).ok).toBe(false)
  })

  it('never repeats the value it refused, because a refused URL may still carry a real password', () => {
    // The boot prints its problems to a terminal, and that output is kept. A message that
    // quoted the input would leave the credentials in it.
    const refused = [
      'smtps://camille:HUNTER2-canary@mail.example.com/queue',
      'imaps://camille:HUNTER2-canary@mail.example.com',
      'smtps://camille:HUNTER2-canary@mail.example.com:99999',
      'smtps://camille:HUNTER2-canary@mail.example.com?x=1',
      'smtps://camille:HUNTER2-canary@mail .example.com',
      'smtps://:HUNTER2-canary@mail.example.com',
      'smtps://camille:HUNTER2%zz-canary@mail.example.com',
    ]

    for (const value of refused) {
      const reason = reasonOf(parseSmtpUrl(value))
      expect(reason, value).not.toBeNull()
      expect(reason).not.toContain('HUNTER2')
      expect(reason).not.toContain('camille')
      expect(reason).not.toContain('mail.example.com')
    }
  })
})

describe('isLoopbackHost', () => {
  it.each(['localhost', 'mail.localhost', '127.0.0.1', '127.1.2.3', '::1'])(
    'treats %s as this machine',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true)
    },
  )

  it.each([
    'mail.example.com',
    '10.0.0.5',
    '192.168.1.10',
    '0.0.0.0',
    '128.0.0.1',
    'localhost.example.com',
    'notlocalhost',
    '::2',
    '127.0.0.1.example.com',
  ])('does not treat %s as this machine', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('parseMailbox', () => {
  it('reads a bare address', () => {
    expect(valueOf(parseMailbox('no-reply@example.org'))).toEqual({
      name: null,
      address: 'no-reply@example.org',
    })
  })

  it('reads a display name and an address in angle brackets', () => {
    expect(valueOf(parseMailbox('EventSlide <no-reply@example.org>'))).toEqual({
      name: 'EventSlide',
      address: 'no-reply@example.org',
    })
  })

  it('reads a quoted display name, and keeps the spaces and the comma inside it', () => {
    expect(valueOf(parseMailbox('"Studio Dupont, Paris" <no-reply@example.org>')).name).toBe(
      'Studio Dupont, Paris',
    )
  })

  it('ignores surrounding whitespace', () => {
    expect(valueOf(parseMailbox('  EventSlide  <no-reply@example.org>  ')).address).toBe(
      'no-reply@example.org',
    )
  })

  it('keeps the address exactly as it was written, apart from the trim', () => {
    expect(valueOf(parseMailbox('No-Reply@Example.org')).address).toBe('No-Reply@Example.org')
  })

  it.each([
    ['two addresses', 'a@example.org, b@example.com'],
    ['two addresses in angle brackets', 'A <a@example.org> <b@example.com>'],
    ['nothing after the name but a bracket', 'EventSlide <no-reply@example.org'],
    ['text after the closing bracket', 'EventSlide <no-reply@example.org> extra'],
    ['an empty display name', ' <no-reply@example.org>'],
    ['an empty address', 'EventSlide <>'],
    ['an address with a space', 'EventSlide <no reply@example.org>'],
    ['an address with no domain', 'EventSlide <no-reply>'],
    ['a quote in the display name', 'Event"Slide <no-reply@example.org>'],
    ['a backslash in the display name', 'Event\\Slide <no-reply@example.org>'],
    ['an angle bracket in the display name', 'Event>Slide <no-reply@example.org>'],
    ['no address at all', 'EventSlide'],
    ['an empty value', ''],
    ['a line break', `EventSlide <no-reply@example.org>${LF}Bcc: x@example.net`],
  ])('refuses %s', (_name, value) => {
    expect(parseMailbox(value).ok).toBe(false)
  })

  it('refuses a display name longer than a header should carry, and accepts one at the limit', () => {
    expect(parseMailbox(`${'n'.repeat(100)} <no-reply@example.org>`).ok).toBe(true)
    expect(parseMailbox(`${'n'.repeat(101)} <no-reply@example.org>`).ok).toBe(false)
  })
})
