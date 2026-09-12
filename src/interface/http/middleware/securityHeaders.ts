import helmet from 'helmet'
import type { RequestHandler } from 'express'

/**
 * Security headers, with a strict Content-Security-Policy.
 *
 * The policy is only this tight because 2.0 removed the CDN: 1.0 loaded Bootstrap from
 * `cdn.jsdelivr.net`, which forces `style-src` and `script-src` to allow a third-party
 * origin and makes the whole policy decorative. Everything is bundled now, so the
 * policy can be `'self'` and mean it.
 *
 * Do not add a remote `<script>`, `<link>` or web font. The header will block it
 * silently in production and the failure will look like a styling bug.
 */
export const securityHeaders = (isProduction: boolean): RequestHandler =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // Vite injects its dev client and HMR runtime inline. In production the bundle
        // is served as files, so no inline script is needed at all.
        scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        // CSS Modules compile to files. `'unsafe-inline'` is needed even in production
        // for the handful of computed custom properties the wall sets on an element
        // (the Ken Burns duration, a progress width) — a nonce cannot cover a style
        // attribute, and the alternative is a stylesheet regenerated per photo.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // `data:` for the inline QR code and favicon; `blob:` for the local previews
        // the upload queue creates before sending.
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        // Same-origin API and SSE only. A guest's phone has no reason to reach
        // anywhere else from this page, and saying so is what makes an injected script
        // unable to exfiltrate a photo.
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        // No plugin, no Flash-era embedding, and nothing may frame the wall — a framed
        // display page is how a click could be hijacked on a machine left unattended.
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // A rogue service worker would be able to intercept every upload.
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },

    // The wall is on a projector and the guest surface is on a phone; neither embeds
    // anything cross-origin, so the strictest isolation costs nothing.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },

    // A join link is shared by QR code and word of mouth; leaking the full URL — which
    // contains the join code — to any third party a page happens to reference would
    // hand out access.
    referrerPolicy: { policy: 'no-referrer' },

    // HSTS only in production: setting it over plain HTTP in development pins
    // localhost to https in the browser and is genuinely awkward to undo.
    ...(isProduction
      ? { strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true } }
      : { strictTransportSecurity: false }),

    // Sniffing an upload as HTML is exactly how a stored file becomes stored XSS. Media
    // is served with an explicit content type and this header on top.
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    xPoweredBy: false,
  })

/**
 * Denies a browser the device permissions this app never uses. The camera is reached
 * through a file input with `capture`, which needs no Permissions-Policy grant, so
 * every entry here can be empty.
 */
export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    ['geolocation=()', 'microphone=()', 'payment=()', 'usb=()', 'magnetometer=()'].join(', '),
  )
  next()
}
