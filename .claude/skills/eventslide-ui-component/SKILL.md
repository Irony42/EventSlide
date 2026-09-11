---
name: eventslide-ui-component
description: Recipe for building React UI in web/src — design tokens, the primitive components, feature folder structure, view-state hooks, accessibility requirements, and Testing Library tests. Use when adding or changing any screen, component, or style, including the guest upload flow, the moderation console, and the projected display wall.
---

# Building UI in EventSlide

Three surfaces with genuinely different constraints. Know which one you are in.

| Surface   | Viewport                 | Environment                         | Priority                             |
| --------- | ------------------------ | ----------------------------------- | ------------------------------------ |
| **Guest** | 360–430 px, one thumb    | congested venue Wi-Fi, 4G, sunlight | speed, thumb reach, forgiving errors |
| **Host**  | laptop, mouse + keyboard | quick glances during an event       | density, keyboard shortcuts, undo    |
| **Room**  | 1080p–4K, 3–10 m away    | unattended for hours, no input      | beauty, legibility, zero jank        |

A control that is comfortable on a laptop is often unusable at arm's length on a
phone. Design for the surface, not for the average.

## Tokens: the only place raw values exist

```css
/* web/src/design-system/tokens.css — excerpt */
:root {
  /* Ink & surface — dark by default; the room is dark and phones are held in it */
  --surface-base: oklch(16% 0.02 265);
  --surface-raised: oklch(21% 0.025 265);
  --surface-overlay: oklch(26% 0.03 265);
  --border-subtle: oklch(30% 0.02 265);
  --text-primary: oklch(97% 0.005 265);
  --text-secondary: oklch(78% 0.015 265);
  --text-muted: oklch(62% 0.02 265);

  /* Accent — one hue, used sparingly, reserved for the primary action */
  --accent: oklch(72% 0.17 305);
  --accent-strong: oklch(64% 0.19 305);
  --accent-contrast: oklch(18% 0.02 305);

  /* Semantic */
  --success: oklch(76% 0.16 155);
  --danger: oklch(68% 0.19 22);
  --warning: oklch(82% 0.15 85);

  /* Space — 4 px base, no in-between values */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-8: 3rem;
  --space-10: 4rem;

  /* Type — fluid, so the projector and the phone both read well */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: clamp(1.125rem, 0.4vw + 1rem, 1.25rem);
  --text-xl: clamp(1.5rem, 1vw + 1.2rem, 2rem);
  --text-display: clamp(2rem, 3vw + 1rem, 4rem);

  --radius-sm: 0.375rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.25rem;
  --radius-full: 999px;

  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.3);
  --shadow-md: 0 8px 24px -8px oklch(0% 0 0 / 0.45);
  --shadow-lg: 0 24px 60px -12px oklch(0% 0 0 / 0.55);

  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast: 140ms;
  --duration-base: 240ms;
  --duration-slow: 520ms;

  /* Thumb targets. 44 px is the floor, not the aspiration. */
  --touch-min: 2.75rem;
}
```

Rules:

- **Never write a raw colour, radius, shadow, spacing, or font size in a component.**
  `color: #38bdf8` fails review. `color: var(--accent)` is the only form.
- No inline `style={{ … }}` for anything static. Inline style is for a computed
  value only (a progress width, a grid position, a transform).
- Add a token when a genuinely new _role_ appears, not a new shade. If two tokens
  would always be the same colour, you need one token.
- `oklch` throughout: perceptually uniform lightness, so `--text-secondary` has the
  same apparent contrast against every surface.

## Primitives before features

`web/src/design-system/components/` holds `Button`, `IconButton`, `Field`, `TextInput`,
`Textarea`, `Card`, `Dialog`, `Toast`, `Spinner`, `EmptyState`, `Badge`, `Progress`,
`VisuallyHidden`, `Stack`, `Grid`.

Check for a primitive first. A fourth bespoke button is how a design system dies.

```tsx
// web/src/design-system/components/Button.tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant
  readonly size?: Size
  readonly loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      className={`${styles.button} ${styles[variant]} ${styles[size]}`}
      // aria-busy keeps the accessible name; a spinner-only button announces nothing.
      aria-busy={loading || undefined}
      disabled={disabled ?? loading}
    >
      {loading && <Spinner aria-hidden />}
      {children}
    </button>
  )
})
```

- CSS Modules, colocated. No global class names except the token and reset layers.
- `forwardRef` on anything focusable — dialogs and toasts need to move focus to it.
- Never remove the focus ring. `:focus-visible` is styled, never `outline: none`.

## Feature folders

```
web/src/features/guest-upload/
  GuestUploadPage.tsx        composition, no logic
  components/
    CameraTile.tsx
    UploadQueue.tsx
    PhotoPreviewStrip.tsx
  hooks/
    useUploadQueue.ts        view-state: queue, retry, progress
    useUploadQueue.test.ts
  GuestUploadPage.test.tsx
```

- A feature never imports from another feature. Shared code moves to
  `web/src/design-system/` or `web/src/lib/`.
- Hooks hold **view-state**: what is loading, what is selected, what to retry. They do
  not hold business rules. "Is this photo publishable" is a server decision.
- The page component composes; it does not fetch, transform, and render all at once.

## Data and transport

`web/src/lib/api/` holds typed functions, one per endpoint, and is the **only** place
`fetch` appears.

```ts
// web/src/lib/api/photos.ts
export const listPhotos = (slug: string, query: ListPhotosQuery) =>
  http.get<PhotoDto[]>(`/api/events/${slug}/photos`, query)
```

- `web/src/lib/http.ts` handles JSON, errors (mapping `error.code` → French copy via
  `web/src/lib/i18n/`), credentials, and the CSRF header.
- Components receive data through a hook, never call `http` directly — that is what
  makes them testable with a fake transport.
- SSE lives in `web/src/lib/realtime/useEventStream.ts`: one connection per page,
  auto-reconnect with backoff, and it emits **invalidation signals** rather than data.
  Push payloads are a trust and consistency problem; a signal that triggers a refetch
  is not.

## Accessibility, concretely

- **Semantic element first.** A clickable `<div>` is a bug: 1.0 shipped one in the
  moderation grid and it was invisible to keyboard and screen-reader users.
- Every interactive element: reachable by <kbd>Tab</kbd>, activated by
  <kbd>Enter</kbd>/<kbd>Space</kbd>, with a visible `:focus-visible` ring.
- Touch targets ≥ `var(--touch-min)` (44 px) on guest surfaces. Sunlight, one thumb,
  a drink in the other hand.
- Every `<img>` has meaningful `alt`, or `alt=""` when decorative. A guest photo's alt
  is its caption and author, or "Photo envoyée par Léa" as a fallback.
- Live regions: upload progress and moderation counts use `aria-live="polite"`; errors
  use `role="alert"`.
- **Respect `prefers-reduced-motion`.** Ken Burns, crossfades, and confetti are all
  disabled under it. This is a health requirement, not a preference.
- Forms: `<label for>` always. Placeholder is never a label.
- Colour is never the only signal. The moderation grid pairs its green/red border with
  an icon and text, so it works for a red-green colourblind host under stage lighting.

## The projected surface is special

- Assume **no input device**. Everything must work unattended.
- Assume overscan: keep meaningful content inside a 4% safe-area inset.
- Type is read from 3–10 m: captions at `--text-xl` minimum.
- Photos are `object-fit: contain` on black — never crop a guest's photo in the primary
  layout. Cropping is opt-in per layout (mosaic).
- Preload the next slide before transitioning, or the crossfade shows a blank frame.
- Never mount a component that grows without bound. An 8-hour run leaks nothing:
  playlist windows are capped and image elements are recycled.
- Derive the Ken Burns duration from the slide interval. If the animation is longer
  than the slide, the image visibly snaps back — the 1.0 bug.

## Tests

```tsx
// web/src/features/guest-upload/GuestUploadPage.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { renderWithProviders, fakeTransport } from '../../testing/renderWithProviders'

describe('GuestUploadPage', () => {
  it('uploads the selected photos and reports each one as sent', async () => {
    const transport = fakeTransport()
    renderWithProviders(<GuestUploadPage slug="mariage" />, { transport })

    await userEvent.upload(
      screen.getByLabelText(/Ajouter des photos/),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'confettis.jpg', {
        type: 'image/jpeg',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done'),
    )
  })

  it('offers a retry when the network drops mid-upload, without losing the file', async () => {
    const transport = fakeTransport({
      uploadPhotos: () => Promise.reject(new Error('offline')),
    })
    renderWithProviders(<GuestUploadPage slug="mariage" />, { transport })

    await userEvent.upload(screen.getByLabelText(/Ajouter des photos/), aJpegFile())
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/connexion/i)
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeEnabled()
  })
})
```

- **Query the way a user finds things**: `getByRole`, `getByLabelText`,
  `getByText`. `getByTestId` only for things with no accessible identity.
- Assert on **rendered output**, never on internal state or a spy on a child.
- `userEvent`, not `fireEvent` — it models real interaction, including focus.
- Inject a fake transport; never mock `global.fetch`.
- Every screen has a test for **loading, empty, error, and populated**. The empty and
  error states are the ones users actually hit at an event, and 1.0 shipped neither.

## Checklist

- [ ] Named the surface: guest, host, or room.
- [ ] Reused a primitive, or added one to the design system.
- [ ] Zero raw colour/spacing/radius/shadow/font-size values; `var(--…)` only.
- [ ] Semantic elements; keyboard-operable; visible focus ring; 44 px targets on guest surfaces.
- [ ] `alt` on every image; live regions for async status; `prefers-reduced-motion` respected.
- [ ] Colour never the sole signal.
- [ ] French copy from `web/src/lib/i18n/`, accents correct.
- [ ] Data via a hook and typed API client; no `fetch` in a component.
- [ ] Tests for loading, empty, error, populated — via roles and labels.
