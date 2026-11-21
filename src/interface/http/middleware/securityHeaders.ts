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
        // CSS Modules compile to files, so nothing inline is needed in production. The few
        // computed values the wall sets on an element (the Ken Burns duration, a progress
        // width, a tilt) are React `style={{}}` props, which React applies through the CSSOM
        // (`style.setProperty`): `style-src` does not govern that, only a `<style>` element
        // and an HTML `style=""` attribute, and nothing here emits either. This line used to say
        // `'unsafe-inline'` was "needed even in production"; it was not, and it is what OWASP
        // ZAP rule 10055 reports. Vite's dev server injects CSS as `<style>` elements, so
        // development keeps it, as it does for `script-src`.
        styleSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
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
    //
    // `require-corp` rather than `credentialless`: the page loads no cross-origin resource at
    // all (every image, poster and clip is a same-origin `/api` URL, a `blob:` preview or a
    // `data:` QR code, and a same-origin load is never refused), so the stricter value is free
    // and the looser one would only be a way of saying a remote image is welcome. Adding a
    // cross-origin image, font or frame now fails loudly in the console, which is the point; the
    // CSP above already forbids it. docs/SECURITY.md lists what was checked.
    crossOriginEmbedderPolicy: { policy: 'require-corp' },
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
 * The first path segments of the pages that never carry a guest, and an API that is never a page:
 * the host's console, the sign-in, the shared gallery, the mailed-link pages, and `/api`.
 */
const NEVER_GUEST_PAGES: ReadonlySet<string> = new Set([
  'admin',
  'login',
  'g',
  'invite',
  'password',
  'api',
])

/**
 * Whether a document at this path may ask for the microphone (spec 25, section 9).
 *
 * **The list is inverted: it names what is closed, and everything else is open.** A document keeps
 * the policy of the URL it was loaded from, whatever page it navigates to afterwards, so a list of
 * the guest pages that may record leaves the microphone blocked, with the guest unable to do
 * anything about it, wherever a guest *enters*: `/` (which the client redirects to `/join`),
 * `/e/<slug>` (which it redirects to the upload page), and the offline fallback of the service
 * worker, which answers a failed navigation with the cached `/` and **the headers stored for
 * `/`**, which is the bad-Wi-Fi scenario a voice message exists to serve. So the pages that are
 * closed are the ones that never carry a guest: `/admin/**`, `/login`, `/g/**`, `/invite/**`, `/i/**` (a guest invitation),
 * `/password/**`, the wall (`/e/<slug>/display`), and `/api`.
 *
 * The guard against widening is not this list but a static test: nothing outside
 * `web/src/features/guest-upload/` may call the browser's microphone request.
 *
 * Express matches these routes without regard to case, so the comparison does too; the path is
 * decoded and its empty and `.` segments dropped, so `/%61dmin` and `//admin` are the console. A
 * path that cannot be decoded is closed: it is not a page a guest was sent to.
 */
export const microphoneOpenOn = (path: string): boolean => {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  const segments = decoded
    .toLowerCase()
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
  const [first, , third] = segments
  if (first !== undefined && NEVER_GUEST_PAGES.has(first)) return false
  // The projected wall, and anything below it.
  return !(first === 'e' && third === 'display')
}

/**
 * Denies a browser the device permissions this app never uses. The camera is reached
 * through a file input with `capture`, which needs no Permissions-Policy grant. The microphone
 * is the exception (voice messages in the guestbook, spec 25): granted to the page's own origin on
 * the guest's pages, see {@link microphoneOpenOn}, and denied everywhere else.
 */
export const permissionsPolicy: RequestHandler = (req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    [
      'geolocation=()',
      microphoneOpenOn(req.path) ? 'microphone=(self)' : 'microphone=()',
      'payment=()',
      'usb=()',
      'magnetometer=()',
    ].join(', '),
  )
  next()
}
