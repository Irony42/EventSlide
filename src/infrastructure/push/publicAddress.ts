import { isIP } from 'node:net'

/**
 * Whether an address the box is about to connect to is a **public** one (spec 30, lot 4, the SSRF
 * guard of Web Push). The host name was already judged against the allowlist; this judges what the
 * name *resolves to*, so a name that points inside the box's network (DNS rebinding, a hostile
 * resolver, a mistaken record) is refused at the connection and never reaches an internal service.
 *
 * Refused: loopback, private (RFC 1918), shared (100.64/10), link-local (169.254/16, fe80::/10, which
 * is where cloud metadata services live), unique-local (fc00::/7), multicast, reserved, the
 * documentation and benchmarking ranges, the unspecified address, and an IPv4 address written as
 * IPv6 (`::ffff:a.b.c.d`, NAT64) when the embedded IPv4 is itself refused. Anything that is not an IP
 * address at all is refused.
 */

const ipv4Parts = (address: string): readonly number[] | null => {
  const parts = address.split('.').map((part) => Number(part))
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null
}

const publicV4 = (address: string): boolean => {
  const parts = ipv4Parts(address)
  if (parts === null) return false
  const [a, b, c] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return a < 224
}

/** The 16 bytes of an IPv6 address, or `null` when it is not one. */
const ipv6Bytes = (address: string): readonly number[] | null => {
  const text = address.toLowerCase().split('%')[0] as string
  // A dotted IPv4 tail (`::ffff:1.2.3.4`) is two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/u.exec(text)
  let body = text
  if (tail !== null) {
    const v4 = ipv4Parts(tail[1] as string)
    if (v4 === null) return null
    const [a, b, c, d] = v4 as [number, number, number, number]
    body =
      text.slice(0, text.length - (tail[1] as string).length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = body.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): string[] => (part === '' ? [] : part.split(':'))
  const head = toGroups(halves[0] as string)
  const rest = halves.length === 2 ? toGroups(halves[1] as string) : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...rest]
  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null
    const value = parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes
}

const publicV6 = (address: string): boolean => {
  const bytes = ipv6Bytes(address)
  if (bytes === null) return false
  const [b0, b1] = bytes as [number, number]
  // :: and ::1.
  if (bytes.slice(0, 15).every((b) => b === 0) && (bytes[15] === 0 || bytes[15] === 1)) return false
  // ::ffff:a.b.c.d (mapped) and 64:ff9b::/96 (NAT64) carry an IPv4 address: judge that one.
  const mapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  const nat64 =
    b0 === 0x00 &&
    b1 === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  if (mapped || nat64) return publicV4(bytes.slice(12).join('.'))
  if ((b0 & 0xfe) === 0xfc) return false // fc00::/7 unique local
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return false // fe80::/10 link-local
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return false // fec0::/10 site-local (deprecated)
  if (b0 === 0xff) return false // multicast
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false // documentation
  if (b0 === 0x3f && (b1 & 0xf0) === 0xf0) return false // 3fff::/20 documentation
  // Only global unicast, 2000::/3, is a public address.
  return (b0 & 0xe0) === 0x20
}

export const isPublicAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) return publicV4(address)
  if (family === 6) return publicV6(address)
  return false
}
