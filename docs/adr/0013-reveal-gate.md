# ADR 0013 — The reveal gate: a gate on the event, not a state of a photograph

## Status

Accepted. Decided in spec 23 (disposable camera) and built by its first pull request.

## Date

2026-11-17

## Context

A "disposable camera" evening hides the guests' photographs from the other guests and from the room until the host
reveals them (an hour, or a button), then shows everything at once. The product already has a gate in front of every
photograph, moderation: only a `published` photograph reaches a public screen, and that is the promise the product
makes to a host ("nothing appears in front of two hundred people without a decision"). The new feature had to fit
beside it without becoming a second product.

Four designs were weighed.

1. **A new photo status** (`sealed`, `developing`). It touches every transition of the machine, every DTO, every filter and
   the moderation queue, and the console would have to explain a state that is not a decision.
2. **"Reveal" is "publish everything"**: hold every photograph as `pending` and approve them all at the hour. It confuses
   the calendar with the decision, needs a sweeper and a mark ("held by the reveal") so as not to approve what the host
   never reviewed, and removes the manual mode.
3. **A column on `photos`, or a table.** A migration, and a reprocessing of every row, for a fact that is a function of
   the clock.
4. **A gate on the event, asked by every public reader.** Chosen.

## Decision

1. **The reveal is a gate on the event, in front of the per-photograph moderation gate.** A photograph is visible to the
   public if and only if it is `published` **and** the evening is revealed. `isRevealed(reveal, now)` is
   `!enabled || (at !== null && at <= now)`, with the server's clock (the hour is inclusive), and
   `visibleStatuses(reveal, now)` is the list of statuses a public reader may ask for: none before, `published` after. No
   status, no transition, no column was added, and moderation is unchanged. The host and the moderators are not public
   readers: they see every photograph as it arrives, and that period is the review the mode exists to give.
2. **One door, not eight.** Every public reader (the wall, which is also the guests' feed, the media route for a viewer
   who is not a moderator, the podium, the reactions, the shared gallery: open, grid, bytes, archive) asks
   `visibleStatuses` instead of holding a constant. `src/main/publicReaders.guard.test.ts` fails on a use case that reads
   photographs by their visibility without asking it, unless it is listed with the reason it is a host's reader. The one
   exception that stays is the guest's own list: it shows their photographs always (see 5).
3. **No sweeper, no scheduled task.** "Revealed" is read, never written at the hour. A restart at 22:59 changes nothing at
   23:00. "Révéler maintenant" writes an hour that is now (`at = now`), not a state: it is the same field.
4. **The mode is a group of the settings JSON, with no migration.** `reveal: { enabled, at, film }` is merged key by key like
   `wall` (a save that names `film` cannot forget the hour). An absent key reads as off, which is a read and not a
   rewrite; a present key that is not the stored shape refuses the read of the event (unlike the wall's display
   preferences): a gate that read "off" when it could not be read would publish an evening its host meant to hold back.
5. **The secret is against the others, not against oneself.** A guest's own photographs stay in their list before and after
   the reveal, with their real `status` (a refused photograph is still shown as declined), and `awaitsReveal` marks the
   published ones that are still waiting so that the phone draws them undeveloped. A guest who removes that filter sees
   their own photograph: it is theirs, and that is not a flaw. What is protected is what the others can read.
6. **One way.** Once the hour has gone by it cannot be moved to the future or cleared (`eventSettings.revealDone`): a
   photograph the room has seen is not hidden again, and promising more would be dishonest. The host can switch the mode
   off. An hour the host names must be in the future (`eventSettings.revealInPast`); "Révéler maintenant" is not a
   choice of hour and never meets that rule.
7. **The gate is on the bytes and the metadata, not on the identifiers.** The public signals carry no photograph identifier
   at all today (a frame is only its type), and the media route answers an identifier of another's photograph as it
   answers an unknown one. The gallery opens a valid link before the hour with an empty grid and invents no error code.
8. **One presenter, one shape.** The wall, the phone and the gallery carry the block `revealView(event, now)` builds, with
   `serverNowMs` so that two projectors with different clocks switch together. The film look is **an on-screen filter**,
   never a re-encode: the originals, the variants and the downloads stay clean.

## Consequences

### Positive

- No migration, no sweeper, no new state, no operator switch: the mode is one more setting.
- The guarantee is testable by a guard that names the readers, and by leak tests that carry another event's identifiers
  before and after the hour.
- Moderation and the reveal combine: the manual mode keeps its meaning, and the console is the review period.

### Negative

- Every new public reader of photographs has to ask the gate; the guard test is what makes forgetting it a red test and
  not a leak, and it only knows a reader by the visibility predicates it names.
- During an evening in which the mode is on, an older web bundle shows an empty feed without explanation
  (docs/UPGRADING.md).
- Photograph signals (`photo.uploaded`, `photo.moderated`) still reach the public stream before the hour, as a type with no
  data: a screen re-reads the wall and gets none. They say that something happened, not what.
- Aggregates that count published photographs (the mission and challenge counters of the wall) are not gated: they carry
  no photograph, no identifier and no author.

### Neutral

- The film look is a display filter measured in a later pull request; this one carries only its flag.

## Alternatives considered

- A new photo status, "reveal is publish", a column or table on photos: the first three designs of the Context, rejected there.
- A second capture surface, a sweeper, a server-side film render, two hours, an album mode, an operator switch and a paid
  tier: rejected in spec 23 section 10.

## Related

- Spec 23 (disposable camera); ROADMAP 2.11; docs/API.md (the reveal blocks, POST /events/:slug/reveal); docs/SECURITY.md section 26.
