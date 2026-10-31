/**
 * Where a guest types the code: the join link's host and path prefix, without scheme or the
 * `/join/CODE` tail.
 *
 * A phone that cannot read the QR needs to know **where** to type the six characters, and
 * the only address the server vouches for is the one inside `joinUrl` (built from
 * `PUBLIC_URL`). The port stays when there is one, because a venue box on
 * `mini-pc.local:4300` is not reachable without it. So does a path prefix: `PUBLIC_URL` may
 * carry one (`https://example.org/photos`, behind a reverse proxy that mounts the app under
 * a path), and the host alone would send the guest to a different site. The link ends in
 * `/join/<code>`, which is dropped; whatever precedes it is the prefix, printed without a
 * trailing slash.
 *
 * `null` for anything that does not parse, so the line is left out rather than printed wrong.
 */
export const joinHost = (joinUrl: string): string | null => {
  try {
    const { host, pathname } = new URL(joinUrl)
    if (host === '') return null
    const segments = pathname.split('/').filter((segment) => segment !== '')
    // The last two segments are `join` and the code; everything before is the prefix.
    const prefix = segments.length >= 2 && segments.at(-2) === 'join' ? segments.slice(0, -2) : []
    return prefix.length === 0 ? host : `${host}/${prefix.join('/')}`
  } catch {
    return null
  }
}
