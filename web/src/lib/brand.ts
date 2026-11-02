/**
 * Where the host's logo may be loaded from (spec 03). The DTO comes from our own server, but the
 * invariant of this client is that it trusts no path it is handed (`isVenueGroundUrl` is the same
 * rule for the venue photograph): a logo is rendered in an `<img src>` only if it is exactly the
 * shape the server mints, `/api/events/<slug>/logo/<64 hex>`.
 */
const EVENT_LOGO_PATH = /^\/api\/events\/[a-z0-9-]{2,64}\/logo\/[0-9a-f]{64}$/

export const isEventLogoUrl = (value: unknown): value is string =>
  typeof value === 'string' && EVENT_LOGO_PATH.test(value)
