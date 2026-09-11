# Roadmap — making EventSlide the tool people actually reach for

What 2.0 ships, what should come next, and what will deliberately never be built.

Written from one question: **at a real event, what stops a photo getting from a guest's
phone onto the wall — and what makes the room look up?** Everything below is judged
against that, not against a feature checklist.

Each item carries an honest **effort** (S ≤ 2 days, M ≤ 1 week, L ≤ 3 weeks, XL beyond)
and the **risk** that makes it harder than it looks.

> **Audited against the code.** This document was written before most of the
> implementation landed, so an end-to-end pass checked every "already exists" claim and
> every item listed as future. Three had shipped and are marked **Shipped** below rather
> than quietly deleted — a roadmap that silently drops what got built teaches nobody
> anything. Everything else still reads as future, and still reads as sensible.

---

## 0. What 2.0 already fixes

Not roadmap, but the baseline the rest builds on.

|                | 1.0                                                                                                                                                                    | 2.0                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Guest access   | A link with the event name in a query parameter — which the QR page and the upload page spelled differently, so **every guest silently uploaded to the default event** | `/join/:code`, resolved server-side, with a typo-tolerant code |
| Guest identity | None. The upload endpoint was public and any string created a directory                                                                                                | An event-scoped signed device token                            |
| Moderation     | Accept/reject by clicking a `div`                                                                                                                                      | A keyboard-driven console with bulk actions and undo           |
| Orientation    | Mobile portraits projected sideways                                                                                                                                    | EXIF rotation baked in on ingest                               |
| Privacy        | GPS coordinates of the venue stored and shipped in the ZIP                                                                                                             | All metadata stripped on ingest                                |
| Abuse          | No rate limit, no quota, MIME type trusted from the client                                                                                                             | Per-IP limits, per-event byte quota, magic-byte identification |
| Sessions       | In-memory, lost on restart                                                                                                                                             | SQLite-backed, regenerated on login                            |
| Tests          | Zero, with a CI job that passed anyway                                                                                                                                 | Six rings, gates at 100% on the domain                         |

---

## 1. Guest friction — the highest-leverage work there is

If a guest gives up, nothing else in this document matters. At a wedding the median
guest spends **under a minute** in the app, once, on a phone with two bars of a
saturated access point.

### 1.1 Offline upload queue (P1, effort M, risk: medium)

**The single most valuable thing left to build.** A service worker plus IndexedDB: a
photo selected with no usable connection is stored locally and sent when connectivity
returns, with the Background Sync API where available and a foreground retry everywhere
else.

Venue Wi-Fi at a hundred-guest event is not "sometimes slow", it is _saturated between
19:00 and 23:00_ — exactly the window when photos are taken. Today a failed upload
offers a retry button; that only helps a guest still looking at their phone. This makes
the photo arrive whether or not they are.

Risk: service-worker lifecycle bugs are hard to reproduce and easy to ship. It needs its
own Playwright project with the network throttled and offline, and a kill switch.

### 1.2 Installable PWA (P1, effort S, risk: low)

The manifest exists. Add an install prompt after a successful first upload — not before,
because a prompt on arrival is friction at the worst moment. A guest who installs can
reopen the gallery at midnight without hunting for the QR code, which is when the second
half of an evening's photos get taken.

### 1.3 Camera-first capture (P1, effort M, risk: low)

A dedicated capture screen: viewfinder, one big shutter button, the last three shots as
thumbnails, "send" always visible. Today the flow is a system file picker, which on
Android means three taps through a gallery app.

The measure of success is taps from opening the app to a photo being sent: **five today,
two after this**.

### 1.4 Short video clips (P1, effort L, risk: high)

The most-requested thing at weddings and the hardest item on this list. 5–15 seconds,
transcoded to a web-friendly H.264/AAC, muted on the wall by default with a duration cap
and its own quota line.

Risk, and it is real: `ffmpeg` is a large native dependency, transcoding is CPU-bound in
a way image resizing is not, and a single 4K clip can outweigh a hundred photos. It needs
a job queue and backpressure, which is genuine new infrastructure — the first thing in
this document that changes the architecture rather than extending it.

### 1.5 Guest UI languages (P2, effort S, risk: low)

`web/src/lib/i18n/` is already a single French table with a code-to-message map. English,
Spanish, German and Italian are a mechanical addition, chosen from `Accept-Language` with
a manual override. International weddings are common and a guest who cannot read the
upload button does not upload.

### 1.6 Spoken captions (P3, effort S, risk: low)

The Web Speech API for the caption field. Typing on a phone in a dark room with a drink
in hand is the reason most photos arrive without a caption, and captions are what make
the wall feel like the room rather than a screensaver.

---

## 2. The room — where the product is judged

The wall is what two hundred people look at all evening. It is also the surface with the
least engineering attention in most tools of this kind.

### 2.1 Photo missions (P1, effort M, risk: low)

**The highest-engagement feature in this document per hour of work.** The host defines a
short list of prompts — "a selfie with the couple", "the worst dance move", "someone
crying" — and guests see them as a checklist. The wall celebrates completions.

It changes the guest's relationship to the app: instead of "should I bother uploading
this", there is something to do. It reliably multiplies photo volume at events that use
it, and mechanically it is a table, a checklist screen and a wall overlay.

### 2.2 Per-event theming (P1, effort S, risk: low)

The token architecture makes this nearly free: a host picks an accent hue, a font pairing
and a frame style, stored in event settings and applied as a `:root` override. A wedding
in dusty pink and a corporate launch in the company's blue should not look like the same
product, and today they do.

Constraint: contrast is validated server-side against the token contract, so a host
cannot choose a palette that makes captions unreadable at ten metres.

### 2.3 More wall layouts (P2, effort M, risk: low)

`spotlight` and `mosaic` ship in 2.0. The layout registry is already a closed union with
a per-layout spec, so each addition is contained:

| Layout      | What it is for                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `polaroid`  | Three photos as tilted prints on a dark ground. Reads as warm and handmade; the right choice for a small wedding.      |
| `filmstrip` | A slow horizontal drift. Good for a cocktail hour where nobody is watching continuously.                               |
| `collage`   | New photos compose into a growing grid that fills over the evening. The room watches it fill, which is its own reward. |
| `split`     | Two photos side by side, pairing an old upload with a new one.                                                         |

### 2.4 Guestbook messages (P2, effort S, risk: low)

Text wishes from guests, moderated in the same queue, shown between photos in a typeset
card. Costs one table and one wall component, and it captures the thing people most
regret not having afterwards. Reuses the entire moderation path.

### 2.5 Highlights reel (P2, effort M, risk: low)

At the end of the night, a two-minute sequence of the most-reacted photos, slower and
tighter than the ambient loop. Also the natural artefact to hand the host afterwards.
Reaction tallies and `topPhotos` already exist.

### 2.6 Print station (P3, effort M, risk: medium)

A connected dye-sublimation printer; a guest taps "print" on their own photo and collects
it from a table. The physical object is the thing people keep, and it is what
photobooth rental companies charge three hundred euros an evening for.

Risk: printer drivers are a support burden. Scope it to CUPS on Linux and a documented
list of two or three known-good models rather than "printers" in general.

### 2.7 Photobooth mode (P3, effort M, risk: low)

A tablet on a stand: countdown, four frames, strip composed server-side, straight to the
wall and optionally to the printer. A different capture surface over the same pipeline.

### 2.8 Schedule overlays (P3, effort S, risk: low)

"Cake at 22:00", "Speeches at 21:00" — a timed card the host schedules in advance. The
wall is the only screen everyone is already looking at, so it is the right place to
announce something, and hosts currently do it by shouting.

---

## 3. Host control

### 3.1 Moderation on a phone (P1, effort M, risk: low)

The host is not at the laptop. They are at a table, standing, holding a phone. The
moderation console is built for a keyboard, and no amount of responsive CSS makes a
dense grid workable one-handed.

A separate mobile surface: one photo at a time, swipe right to publish and left to
refuse, undo always reachable. Reuses every use case; it is a view, not a feature.

### 3.2 Pre-sorted moderation queue (P2, effort L, risk: medium)

Not auto-rejection — **ranking**. A local model (ONNX Runtime, on the box, no network)
scores each photo for likely-unwanted content, blur and near-duplication, and the queue
surfaces the doubtful ones first while an eighty-photo burst of good shots can be
approved in one gesture.

Constraints that are not negotiable: nothing is ever rejected automatically, the score is
advisory and visible, and no photo leaves the machine. A cloud moderation API would be
easier and is refused for exactly that reason.

### 3.3 Live moderator presence (P2, effort S, risk: low)

Two moderators working the same queue currently double-review and race each other. The
SSE channel already exists; broadcasting "someone is looking at this one" is a small
addition to it.

### 3.4 Scheduled open and close (P2, effort S, risk: low)

An event goes live at 18:00 and closes at 02:00 without anyone remembering. `startsAt`
already exists on the aggregate; this is a job plus two fields.

### 3.5 Event templates (P3, effort S, risk: low)

Wedding, birthday, conference and party presets: moderation mode, retention, layout,
theme, mission list. A host creating their first event should not have to have opinions
about seven settings, and the defaults for a corporate launch are genuinely different
from a family party's.

---

## 4. After the event

The evening ends and the photos are worth more than they were during it. This is the part
most tools abandon.

### 4.1 Shared gallery link (P1, effort M, risk: medium)

A link the host sends afterwards: the published album, optionally password-protected,
with an expiry, where guests download full-resolution originals — including the ones they
took themselves.

Risk: it is the product's first genuinely public read surface, so it needs signed
short-lived media URLs rather than the per-request authorization the app uses internally,
plus its own rate limiting and a `noindex` policy. Worth doing carefully; the "can you
send me the photos" message is the single most common thing a host gets the next day.

### 4.2 Guest recap (P2, effort S, risk: low)

The device token already identifies a guest, so "your twelve photos from the night, and
the eight you appear in" is a page, not a mail merge. Delivered as a link the host
forwards; **no email infrastructure**, which keeps SMTP out of a self-hosted deployment.

### 4.3 Photo book export (P3, effort L, risk: medium)

A print-ready PDF with a sensible layout, bleed and page order. Genuinely valuable and
genuinely fiddly — colour profiles, DPI and a layout engine that handles mixed
orientations without looking automatic.

### 4.4 Export-then-purge (P2, effort S, risk: low)

Retention already purges. The missing half is one action that writes the archive
somewhere the host chooses, verifies it, and _then_ deletes — so honouring a retention
promise does not mean losing the album.

---

## 5. Security, privacy and trust

Nothing here is optional for a product that holds photographs of other people's
families. 2.0 covers the controls in [SECURITY.md](SECURITY.md); these are the gaps.

### 5.1 Consent notice on join (P1, effort S, risk: low)

One screen, before the first upload: what happens to a photo, who sees it, how long it is
kept, and how to have it removed. Sourced from the event's actual retention setting, so
it cannot promise something the configuration contradicts.

This is both a GDPR obligation and a trust affordance. A guest who understands where a
photo goes uploads more, not less.

### 5.2 Guest self-service erasure (P2, effort S, risk: low)

"Delete everything I sent" from the guest's own page, independent of the moderation grace
window. Article 17 in practice, and the cascade already makes it a single operation.

### 5.3 TOTP for host accounts (P2, effort M, risk: low)

A host account controls every photo of an event. A password and a rate limit are thin for
that, and the accounts are long-lived.

### 5.4 Moderation audit log (P2, effort S, risk: low)

Who published what, and when. The `PhotoReview` on the entity already records the last
decision; an append-only log answers "who put that on the screen" after the fact, which
matters most in exactly the situation where it is asked.

### 5.5 Encryption at rest (P3, effort M, risk: medium)

Age-encrypted media with a key held outside the media root, for hosts whose venue
machine is not physically secure. The `MediaStore` port makes it an adapter.

---

## 6. Operations

A self-hosted product lives or dies on whether one person can run it.

| Item                              | P   | Effort | Note                                                                                                                                                                                  |
| --------------------------------- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker image and one-file compose | P1  | S      | `docker compose up` should be the whole install. Today it is Node, a build and a `.env`.                                                                                              |
| Backup and restore command        | P1  | S      | One command producing a verifiable archive of the database and the media, and one restoring it. Retention promises are unsafe without this.                                           |
| Prometheus metrics                | P2  | S      | Upload latency, queue depth, SSE subscribers, quota headroom.                                                                                                                         |
| Raspberry Pi kiosk image          | P2  | M      | The wall's natural hardware: boot straight into the display URL in kiosk mode.                                                                                                        |
| S3 / MinIO media adapter          | P2  | M      | The `MediaStore` port exists for this. Needed by anyone running more than a handful of events.                                                                                        |
| 1.0 migration script              | P2  | S      | Reads a 1.0 SQLite file and photo directory, creates one event per `partyId`, re-ingests through the 2.0 pipeline — which is what finally strips the EXIF that 1.0 stored.            |
| Multi-event workspace             | P3  | L      | A photographer running five weddings a month needs cross-event search, shared moderators and per-event billing boundaries. A different product shape; only worth it with real demand. |

---

## 7. Deliberate non-goals

Saying no is what keeps the rest coherent.

| Not building                        | Why                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A hosted SaaS with billing**      | The whole proposition is that the photos stay on the host's machine. A hosted tier would compete with the reason to choose this.                              |
| **Native mobile apps**              | The guest surface must work in the browser that opened the QR code. An app store download is a hard stop at the moment a guest is deciding whether to bother. |
| **Cloud AI moderation**             | Sending guests' photographs to a third party to be scored contradicts the privacy posture. On-device only (§3.2).                                             |
| **Face recognition by default**     | Biometric processing of people who never agreed to it. Opt-in, per event, on-device, off unless a host deliberately turns it on — or not at all.              |
| **Social features between guests**  | Comments, follows, direct messages. This is a photo wall for one evening, not a network. Reactions are the ceiling.                                           |
| **Music on the wall**               | Licensing is a minefield and the room already has music.                                                                                                      |
| **A public write API or webhooks**  | Every additional public write surface is another thing to rate-limit and authorize. Not without a concrete integration asking for it.                         |
| **GraphQL**                         | Thirty endpoints and one client. It would add a schema layer and remove nothing.                                                                              |
| **Infinite retention as a default** | Keeping photographs of other people's families forever, by default, is not a neutral choice.                                                                  |

---

## 8. If only three things get built

1. **Offline upload queue** (§1.1) — the difference between photos arriving and photos
   being lost to a saturated access point. Everything else assumes the upload works.
2. **Photo missions** (§2.1) — the cheapest large increase in how much guests
   participate, and it changes the wall from a screensaver into something the room is
   part of.
3. **Shared gallery link** (§4.1) — answers the question every host is asked the next
   morning, and the reason they recommend the tool to the next person.
