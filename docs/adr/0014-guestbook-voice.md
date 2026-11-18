# ADR 0014 — Voice messages are a line of the guestbook, heard only by the host

## Status

Accepted.

## Date

2026-11-18

## Context

Competitors sell an audio guestbook (Wedibox, Picbook, Scene, Fotify, GuestCam), and a wedding is the evening
where a voice is worth keeping for ten years. The guestbook of spec 01 already has what one needs: statuses,
moderation, a per-guest ceiling, an erasure, an export. What a voice adds is not a feature but a kind of data:
the recording of a person who has no account, who often does not know the software exists, and who says it in a
room full of other people (their voices are in the recording and accepted nothing). The decisions below are the
ones a later reader would otherwise reopen.

Spec 25 carries the whole argument; this record keeps the few choices whose reasons are not visible in the code.

## Decision

1. **A voice is a line of the existing guestbook, not a second product.** It is a `GuestbookEntry` that carries a
   `voice`, with the same four statuses, the same moderation (the event's mode), the same ceilings (3 per guest,
   counted with the written messages), the same window and the same erasure. One side table (`guestbook_voices`,
   migration 032) holds what is true only of a recording: its processing state, its digests and sizes, its measured
   duration. Nothing existing was altered, so the migration is the safest kind on an event in progress.
2. **Nothing is heard by the room, and nothing is announced to it.** The wall never plays a voice and never shows a
   card for one. The two signals a voice raises (`voice.queued`, `guestbook.voice`) are in
   `MODERATION_ONLY_SIGNALS`, so **the server** takes them off the public channel: the wall re-reads its playlist
   on every public signal, so a wall that merely "ignored" them would re-read for nothing.
3. **Only the host and the moderators listen, once the secret is lifted, through one route.** It re-checks the role,
   the secret, the `ready` state, the operator's takedown and the event on every request and answers one single `404`
   for everything unknown or out of scope. The `voice` variant is outside `SERVED_VARIANTS`, so the photograph's media
   route cannot serve it. The author has no player after sending: they listened before.
4. **One stored format, always re-encoded.** AAC mono in MP4, never a copy of what the phone sent: the container is
   identified by its bytes, probed, and re-encoded with the metadata and side streams dropped, and the duration kept is
   measured on the output. Nothing the client says about its recording is believed.
5. **The secret (`sealed`) is the host's choice over their own listening.** It lifts by itself when the event is no
   longer live (derived from the status, so no closing path has to know), or at the owner's "open now", which is
   **one-way** and **the owner's alone**: a moderator delegated to a DJ or a witness must not spoil the surprise. It is not
   part of the wedding template, which only turns the switch on.
6. **A voice has a removal rule of its own.** The photograph can only be taken back while it is pending or refused,
   because pulling something off a screen is the host's call. A voice is never on a screen, so its author may take it
   back inside the grace window whatever its status, and a failed one without condition. The privacy notice says it in
   a clause of its own (`voiceRemovalSeconds`), not by reference to the photograph's.
7. **The microphone is opened by path, with the list inverted.** `Permissions-Policy: microphone=(self)` everywhere
   except the pages that never carry a guest (`/admin`, `/login`, `/g`, `/invite`, `/password`, the wall, `/api`).
   A document keeps the policy of the URL it was loaded from, and the service worker answers an offline navigation with the
   cached `/`, so a list of the guest pages that may record would block it where a guest can least fix it. The guard
   against the open list growing is a static test: no call for the microphone outside
   `web/src/features/guest-upload/`.
8. **No transcription, no recognition, no voice print, no byte off the box.** ROADMAP §9.6 refused the cloud; the local
   kind does not exist reliably in a browser. A host who cannot listen has the guest's optional caption.
9. **The notice is derived from the configuration, as every other.** A `voice` clause, present in the revision only when
   true (after the guestbook and the save switch, before the operator), with its secret and its removal sub-clauses. It
   reads the host's switch and the guestbook, never the box's capability: an audio encoder is a fact about the box, not
   a promise to a guest.

## Consequences

### Positive

- One guestbook, one console tab, one erasure, one export: no parallel surface to keep consistent.
- The room is untouched. Nothing in the wall's code, signals or playlist knows a voice exists.
- A box without ffmpeg serves its photos as before: the button is not offered, `/ready` does not change.
- The privacy argument is mechanical: every sentence of the notice follows a setting, in every combination.

### Negative

- A wedding with 200 guests and the default (voice on, manual moderation) makes up to 200 decisions that nobody
  has to listen to before taking, and a host who does not take them loses them at the purge. The console gets a "keep
  the N pending" action and the purge band a guard for exactly this; they ship with the later pull requests of the spec.
- Turning voice on during the evening makes every guest read the notice again before their next photograph
  (the notice's revision moves). The setting's help text says to turn it on before; limiting the re-read to the voice
  button would change the acknowledgement mechanism of the whole notice and is out of scope.
- Reopening a closed event that was never opened by hand re-seals it: the secret is derived from the status, not recorded.
- No microphone over plain `http://`: a browser rule that no server setting can lift.

### Neutral

- The secret is one-way once opened, and the same instant is read by the console, the route and the archive.
- With the disposable-camera mode (spec 23), one moment may open both the photographs and the voices; that is a
  clause in `isVoiceOpen` guarded by the reveal's own switch (spec 25 PR 8). It is derived, so `revealEvent` writes nothing, and
  it adds no reader: only the host and moderators listen. The "Appareil jetable" template turns the voices on and keeps them secret.

## Alternatives considered

- **A separate voice guestbook** (own table, own console, own ceilings): a second product for a one-line difference.
- **Voices on the wall** (a card, a player, a silent "Camille left a message"): a sound nobody decided, in front of
  two hundred people, on a machine nobody watches. A silent card is held back as a question for later.
- **Transcription**, in a cloud or locally: refused by ROADMAP §9.6; the caption is the answer for now.
- **Keeping what the phone sent**: it carries the metadata of a phone and a file no player reads everywhere.
- **One `microphone=(self)` on every document**: simpler, and acceptable since nothing else calls the microphone; kept as the
  fallback if the table of closed paths becomes a burden. The inverted list plus the static test says the same thing
  and keeps the console and the wall shut by header as well.
- **A list of the guest pages that may record**: blocks the microphone on `/`, on `/e/<slug>` and on the offline
  fallback, with a guest who can do nothing about it.
- **Putting a voice in the offline photo queue**: an older service worker would read it as a photograph and destroy it.

## Related

- Spec 25 (`livre-or-audio`); spec 01 (the guestbook), spec 15 (its moderation), spec 22 (the verified archive).
- ADR 0007 (the hosted instance's operator and its "remove without viewing" levers), `docs/SECURITY.md` §9 ("Voice messages
  in the guestbook"), `docs/API.md` (the routes, the settings, the notice).
- ADR 0013 is the reveal gate of the disposable-camera mode (spec 23): `docs/adr/0013-reveal-gate.md`.
