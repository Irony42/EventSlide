/**
 * Where a guest types the code: the join link's host, without scheme or path.
 *
 * A phone that cannot read the QR needs to know **where** to type the six characters, and
 * the only address the server vouches for is the one inside `joinUrl` (built from
 * `PUBLIC_URL`). The port stays when there is one, because a venue box on
 * `mini-pc.local:4300` is not reachable without it.
 *
 * `null` for anything that does not parse, so the line is left out rather than printed wrong.
 */
export const joinHost = (joinUrl: string): string | null => {
  try {
    const { host } = new URL(joinUrl)
    return host === '' ? null : host
  } catch {
    return null
  }
}
