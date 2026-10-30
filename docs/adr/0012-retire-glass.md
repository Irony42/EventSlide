# ADR 0012 — Retire the liquid-glass material

## Status

Accepted.

## Date

2026-10-30

## Context

3.0 to 3.2 drew the pinned panes (the guest's upload composer, the host's moderation toolbar, the
shared gallery's download bar) as translucent "liquid glass": a tint, a backdrop blur, a saturation
lift, a hairline and a highlight, declared as `--glass-*` tokens and read by one stylesheet. The
host could turn it off per event ("Matière des panneaux": Verre dépoli / Surface unie).

The legibility rules (DESIGN-SYSTEM §8) force the tint to stay at 80 to 95 % opacity: a pane must be
readable over the whitest photograph a guest can send. At that opacity the glass cannot be seen.
Measured, the pixel difference between glass and the opaque surface is under 1.5 % on the guest
screens (V0 to V4) and 0 % on the console pages. The host setting therefore did nothing a host could
see, and confused the hosts who tried it.

An experiment on branch `exp/glass-visible` (W1) made the glass visible, at a 6 to 12 % difference. It
needed the card frames removed so that something could show through, and it looked wrong: saturated
accent buttons over blurred colour read as a rendering fault, not as depth.

## Decision

1. **The glass material is retired.** Every pane paints `--surface-raised`, opaque, on every surface
   and every machine, which is what the opaque tier already rendered. A `sheet` class keeps the
   colour, the hairline (`--pane-border`) and the shadow (`--pane-shadow`) in one place.
2. **The per-event `material` setting goes**: the domain theme loses the field, the settings page
   loses the control and its copy in the five languages, and the API stops emitting it.
3. **Stored `material` keys are ignored, not migrated.** The theme column is opaque JSON. The reader
   ignores the key whatever it holds (no corruption error), and the writer no longer writes it.
4. **The API accepts and ignores `material`** on `PATCH /api/events/:slug/settings`, as it does the
   photograph's `groundUrl`, so a tab left open across the deploy is not answered 400. It is never
   forwarded to the domain.
5. **The wall's budget ladder loses its first rung**: `SHED_ORDER` is `ken-burns`, `crossfade`, and
   the wall starts at level 0 (it used to start at level 1, having already given up glass), so its
   motion behaviour is unchanged. The guest and host interaction budget existed only to shed glass
   and is removed.

## Consequences

### Positive

- One fewer host setting and one fewer thing to explain. A host who had chosen "plain" sees nothing
  change; one who had chosen "glass" loses a blur that was not visible.
- No migration, and the downgrade path is harmless: an older build reads the rows as it always did.
- The `--glass-*` tokens, the `data-glass` tiers, the backdrop table (`glassBackdrop.ts`), the
  reduced-transparency fallback and their tests are deleted. A test now fails the build on any
  `backdrop-filter` in a stylesheet.

### Negative

- The ladder loses a rung, and with it the guest/host measurement. If a decorative effect on those
  surfaces is ever reintroduced, a budget for it will have to be too.
- A material that was a differentiator in 3.0 is gone; the product's panes are plainer by name, if
  not to the eye.

### Neutral

- Old clients keep working: an old tab sending `material` is accepted and ignored, and a stored
  guest session holding it is read as if the key were absent.
- Visual baselines of the guest and host pages are expected to move by no more than the measured
  1.5 %, the invisible blur being the only difference.

## Alternatives considered

- **Keep the glass and fix its visibility** (thin tints, photographs under the panes): tried in W1,
  rejected for the reasons above.
- **Keep the setting and make "glass" mean opaque**: a control that does nothing is the problem.
- **Migrate stored themes to drop the key**: churn across every album for no reader.

## Related

- ADR 0010 (ambiances) and ADR 0011 (Sur mesure), which derived glass tints; roadmap 11.1 to 11.5;
  DESIGN-SYSTEM §13.
