import { describe, expect, it } from 'vitest'
import { vapidKeysMatch } from '../src/infrastructure/push/webPushCrypto'
import { run } from './generateVapidKeys'

describe('npm run push:keys', () => {
  const lines = (): { code: number; out: string[] } => {
    const out: string[] = []
    const code = run((line) => void out.push(line))
    return { code, out }
  }
  const value = (out: readonly string[], name: string): string =>
    out.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''

  it('prints the three variables, a pair that goes together, and exits 0', () => {
    const { code, out } = lines()

    expect(code).toBe(0)
    expect(value(out, 'VAPID_PUBLIC_KEY')).toMatch(/^[\w-]{87}$/u)
    expect(value(out, 'VAPID_PRIVATE_KEY')).toMatch(/^[\w-]{43}$/u)
    expect(value(out, 'VAPID_SUBJECT')).toMatch(/^mailto:/u)
    expect(vapidKeysMatch(value(out, 'VAPID_PUBLIC_KEY'), value(out, 'VAPID_PRIVATE_KEY'))).toBe(
      true,
    )
  })

  it('makes a new pair every time, and says the private key is a credential', () => {
    const first = lines().out
    const second = lines().out

    expect(value(first, 'VAPID_PRIVATE_KEY')).not.toBe(value(second, 'VAPID_PRIVATE_KEY'))
    expect(first.join('\n')).toMatch(/credential/u)
  })
})
