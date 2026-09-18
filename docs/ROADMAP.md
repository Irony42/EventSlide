# Roadmap — making EventSlide the tool people actually reach for

What 2.0 ships, what should come next, and what will deliberately never be built.

Written from one question: **at a real event, what stops a photo getting from a guest's
phone onto the wall — and what makes the room look up?** Everything below is judged
against that, not against a feature checklist.

Each item carries an honest **effort** (S ≤ 2 days, M ≤ 1 week, L ≤ 3 weeks, XL beyond)
and the **risk** that makes it harder than it looks.

> **Audited against the code.** This document was written before most of the
> implementation landed, so an end-to-end pass checked every "already exists" claim and
> every item listed as future.
>
> What has since been built moves to **[§9, Done](#9-done)**, in full rather than
> summarised — a roadmap that silently drops what got built teaches nobody anything, and
> the reasoning that justified an item is the part worth re-reading when the next one
> looks similar. The numbering never changes: an item keeps the number it was argued
> under, so §9.1 is still "1.1" in every commit message and review that referred to it,
> and the gaps left in §§1–3 are the point rather than an oversight.
>
> Everything still under §§1–6 is unbuilt, and still reads as sensible — with one
> exception, left in place deliberately. **"Docker image and one-file compose" in
> [§6](#6-operations) is largely built**, and its note said otherwise for several
> releases. It stays in §6 rather than moving to §9 because the part of it that matters
> to an operator is not finished: see the paragraphs under that table.

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

_Shipped and moved to §9: [1.1](#91-offline-upload-queue), [1.2](#92-installable-pwa), [1.4](#97-short-video-clips). Considered and declined: [1.6](#96-spoken-captions)._

### 1.3 Camera-first capture (P1, effort M, risk: low)

A dedicated capture screen: viewfinder, one big shutter button, the last three shots as
thumbnails, "send" always visible. Today the flow is a system file picker, which on
Android means three taps through a gallery app.

The measure of success is taps from opening the app to a photo being sent: **five today,
two after this**.

### 1.5 Guest UI languages (P2, effort S, risk: low)

`web/src/lib/i18n/` is already a single French table with a code-to-message map. English,
Spanish, German and Italian are a mechanical addition, chosen from `Accept-Language` with
a manual override. International weddings are common and a guest who cannot read the
upload button does not upload.

## 2. The room — where the product is judged

The wall is what two hundred people look at all evening. It is also the surface with the
least engineering attention in most tools of this kind.

_Shipped and moved to §9: [2.3](#93-more-wall-layouts)._

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

_Shipped and moved to §9: [3.1](#94-moderation-on-a-phone), [3.4](#95-scheduled-open-and-close)._

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

| Item                              | P   | Effort | Note                                                                                                                                                                                                                                                 |
| --------------------------------- | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker image and one-file compose | P1  | S      | **The row was stale, not the work undone.** The image, `compose.yaml` and the README install shipped with 2.0; this note went on saying "today it is Node, a build and a `.env`" long after they did. What was genuinely missing is below the table. |
| Prometheus metrics                | P2  | S      | Upload latency, queue depth, SSE subscribers, quota headroom.                                                                                                                                                                                        |
| Raspberry Pi kiosk image          | P2  | M      | The wall's natural hardware: boot straight into the display URL in kiosk mode.                                                                                                                                                                       |
| S3 / MinIO media adapter          | P2  | M      | The `MediaStore` port exists for this. Needed by anyone running more than a handful of events.                                                                                                                                                       |
| 1.0 migration script              | P2  | S      | Reads a 1.0 SQLite file and photo directory, creates one event per `partyId`, re-ingests through the 2.0 pipeline — which is what finally strips the EXIF that 1.0 stored.                                                                           |
| Multi-event workspace             | P3  | L      | **Superseded by [§10](#10-running-a-box-for-other-people--site-administration).** This row said "a different product shape; only worth it with real demand" — the demand arrived, so it is argued properly there rather than as a line in a table.   |

**What the Docker row was actually missing was proof, and one honest gap.** The image
made seven promises that nothing checked: the distribution's `ffmpeg` with the two
encoders `probeFfmpegCapability` names, native modules that load in the runtime rather
than only in the builder, no devDependencies and neither static ffmpeg package, a first
boot against an empty volume, a readable refusal when a secret is missing, a working
healthcheck, and a non-root process. All seven are properties of the artefact, so none of
the six rings can reach them — `npm run verify` is green on a tree whose image has no
`ffmpeg` in it. `scripts/verify-image.sh` now asserts each one and CI runs it on every
push. Three real defects turned up while writing it: `compose.yaml` published on every
interface while telling Express there was one proxy in front (a guest could forge
`X-Forwarded-For` and mint a fresh rate-limit bucket per request), it inherited Docker's
10 s stop timeout against a 15 s shutdown backstop, and the README's install block set a
plain-http `PUBLIC_URL` that `NODE_ENV=production` refuses at boot — so the documented
one-command install did not start. All three are fixed.

**The gap that is left is real and is not a Docker problem.** The server never terminates
TLS and production refuses a non-localhost `http://` `PUBLIC_URL`, because the host's
session cookie is `Secure`. Together those mean **a venue with no domain name and no
certificate cannot run EventSlide**, which is precisely the Raspberry-Pi-under-the-
projector case two rows below. The refusal is correct — the alternative is a login form
that never logs in — but "self-hosted on one box in a building" and "you must have public
DNS and a certificate" are in tension, and the resolution is a product decision rather
than a packaging one. It belongs on this list as its own item before the kiosk image is
worth building.

**Retention scheduling is no longer on this list — it shipped.** It was the ugliest gap
here, because its absence was not a missing feature but a false statement: the setting
existed, the host was shown a confirmation, `purgeExpiredEvents` was written and tested,
and nothing ever called it. An event now expires on its own (hourly by default, tunable
or disabled with `RETENTION_SWEEP_INTERVAL_MINUTES`) and `npm run purge` runs the same
sweep on demand for anyone whose cron owns the schedule. See
[SECURITY.md §11](SECURITY.md#11-deployment-posture).

**Backup and restore is no longer on this list either — it shipped, and it had to ship
in the same breath as the retention sweep.** The note against it read "retention
promises are unsafe without this", which was exactly right: deleting on a schedule
without a tested restore is how a wedding album goes for good. `npm run backup` writes a
directory holding a `VACUUM INTO` snapshot of the database, the media root, and a
manifest of counts and SHA-256 checksums; it re-reads every byte it just wrote before it
reports success, because a backup command that exits 0 having written nothing useful is
the failure nobody notices until it matters. `npm run restore` verifies the whole archive
before it touches anything, refuses a target that still holds a database or any media
unless `--force` is given, and checks the restored migration ledger against the running
build so an archive that would not boot is discovered by the person doing the restore.
The round trip is proven at ring 6 by backing up a live server, destroying both halves,
restoring, and booting a second server that serves the same wall. See
[SECURITY.md §11](SECURITY.md#11-deployment-posture).

---

## 10. Running a box for other people — site administration

Everything above this point assumes the person who installed EventSlide is the person
whose wedding it is. This category assumes the opposite: **an operator runs one instance
for many clients** — a couple, a company launch, a school gala — creates the event, hands
the client the keys to their own evening, and never touches their photographs.

That is a different product shape, and the code does not have it. Today a `User` is an
account with no site-level role at all; the roles that exist (`owner`, `moderator`) belong
to an _event_, and the first account is whatever `BOOTSTRAP_OWNER_EMAIL` said. There is no
record of a client, no way to invite one, and the existing invitation flow creates an
account with a password **read out loud to the person** — which works once, in the same
room, and is exactly what will not do when the invitee is a bride you have never met.

> Numbered 10 rather than 7 on purpose. Section numbers are item numbers here (§3.2 is a
> reference people have written in commits and reviews), so a new category takes the next
> free number instead of shifting the ones that exist.

### 10.1 A site-level role, distinct from an event role (P1, effort M, risk: medium)

The foundation, and the item every other one waits on. An account needs to say what it may
do **on the box** — operate it, or merely own events on it — separately from what it may do
inside any given event. Two roles, not a permission matrix: an operator, and everyone else.

The risk is not writing the role, it is that authorization today reads "is this user the
event's owner". Every one of those checks has to keep meaning exactly what it means now
while a second, higher authority exists above it — and an operator who can accidentally
moderate a client's photographs is worse than one who cannot help at all. Ring-4 tests on
every admin route are the gate.

Migration matters here: the bootstrap account on an existing install becomes the operator,
and an install that never wanted any of this must behave exactly as it does today.

### 10.2 Clients as a record, not a convention (P1, effort M, risk: low)

An event has an `ownerId`; a client is currently the pattern of one person owning several
events, which nothing enforces and nothing can query. Make it a thing: a client has a name,
a contact, zero or more events, and a lifecycle of its own.

The reason this is worth a table rather than a label: everything else in this category
needs a noun to hang off. Ceilings are per client. An invitation is to a client's event.
Suspension is of a client. Without it each of those grows its own ad-hoc grouping.

### 10.3 Invitations that survive a box with no mail server (P1, effort M, risk: medium)

Today's flow — create the account, read the password aloud — has to be replaced by a
single-use, expiring, signed link that lets a client set their own password and lands them
on their event.

**The risk is the mail.** A self-hosted box in a photographer's office usually has no SMTP
credentials, and a product that silently requires them is a product that does not install.
So the link must be copyable from the console and work when pasted into whatever the
operator already uses to talk to their client — SMS, WhatsApp, a mail client on their own
laptop — with SMTP as the optional convenience rather than the mechanism. The HMAC token
work from the guest device token is the closest existing pattern.

Single-use and short-lived are not decoration: an invitation link is a password reset for
an account that does not exist yet.

### 10.4 The operator console (P1, effort M, risk: low)

One screen the operator actually lives in: every client, their events, what state each is
in, disk used against its ceiling, when it expires. Today the answer to "how much of this
box is that wedding using" is a SQL query.

Deliberately _not_ a second moderation console. The operator sees shapes and sizes, not
photographs — which is also what keeps this screen out of the privacy posture in
[SECURITY.md](SECURITY.md).

### 10.5 Ceilings per client (P2, effort S, risk: low)

The operator sets the maximum — byte quota, how many events, the longest retention the
client may choose — and the client works inside it. The per-event quota already exists and
is enforced on the upload path; this is the layer above it, and the honest reason for it is
that one client's 4K video habit should not fill the disk the other four weddings are on.

### 10.6 Support access, with the audit trail that makes it acceptable (P2, effort M, risk: medium)

A client will ring on the evening of their wedding and the operator will need to see what
they see. That capability is also the one most likely to become the incident: it is, by
construction, a way to look at someone's private photographs.

So it is built as the narrow version or not at all — time-boxed, announced in the client's
own interface rather than silent, and written to an append-only log the client can read.
"The operator can log in as the client" without those three is a feature that will be
regretted in public.

### 10.7 Suspension and handover (P2, effort S, risk: low)

An engagement ends: the client stops paying, or the event is over and they want their
album elsewhere. Suspension freezes an account without touching media; handover transfers
ownership of an event to another account; export-then-purge (§4.4) is the door out. The
three together are what let an operator stop a relationship without a database console.

### 10.8 An audit log of operator actions (P2, effort S, risk: low)

Who created this client, who changed that ceiling, who used support access and when. Pairs
with the moderation audit log (§5.4) and shares its storage — the moment an account can act
on data it does not own, "what happened" stops being a question the git history can answer.

### Deliberately out of scope for this category

- **Billing, invoicing and payment.** The operator's accounting lives in whatever they
  already use. A self-hosted photo wall that grows a payment processor has changed
  business, and the security surface arrives with it.
- **Public self-service signup.** An open registration form on a box at a photographer's
  office is an abuse inbox. Clients arrive by invitation, from an operator who already
  knows who they are.
- **Multi-server and high availability.** One box, one operator. The day that is wrong is
  the day this is a different product, and it should be argued then rather than designed
  for now.

---

## 11. The feel of the thing — a liquid-glass interface

Everything in this document so far is about what the product does. This category is about
what it feels like to use, which is not decoration: a guest decides in the first three
seconds whether this is a serious tool or a school project, and a host decides whether to
recommend it by how it looked on the wall in front of their friends.

The target is a **liquid-glass surface language** — translucent panes that pick up the
photograph behind them, depth from layering rather than from borders, motion that responds
to the hand — with a **wahou** on first sight and no cost to how obvious the thing is to
use. Those two are in tension, and where they conflict the guest wins: an interface that
impresses and then loses a photo is worse than the plain one it replaced.

### 11.1 A glass material, as tokens rather than as CSS sprinkled per component (P1, effort M, risk: medium)

Glass is a **material**, not an effect: a blur radius, a tint, a saturation lift, a hairline
border, an inner highlight and a shadow, which together make a pane read as a physical
sheet. Defined once in `tokens.css` as a set, applied by primitives, and refused everywhere
else — the repo already forbids a raw colour outside the tokens, and this is that rule
applied to a compound.

The reason it belongs in tokens rather than in twenty components: a glass pane whose blur
differs by four pixels from the one beside it reads as a mistake even to someone who cannot
say why. One definition is also the only way the performance budget below can be enforced
in one place.

Two properties the material has to carry from the start, because retrofitting them is what
makes redesigns fail:

- **Legibility over an unknown photograph.** A translucent pane sits on top of whatever a
  guest uploaded, which may be a white dress in full sun. The material needs a floor — a
  minimum tint opacity that guarantees the contrast the accessibility contract already
  requires, whatever is behind it. This is the same rule §2.2 states for a host's chosen
  hue, and the two interact: glass **over** a themed accent must still pass.
- **A no-blur fallback that is not ugly.** `backdrop-filter` is unavailable or disabled on
  some machines, and the budget below will switch it off on others. The fallback is an
  opaque token from the same family, not a transparent pane that becomes unreadable.

**Found while building the floor, and still open: `--surface-scrim` does not meet the bar
this product already published for it.** Measuring a translucent ground over a photograph
needed arithmetic `tokens.contrast.test.ts` did not have — every ratio it compared was
between two _declared_ colours — and pointing the new arithmetic at the existing palette
says that over a bright photograph the wall's caption scrim gives `--text-primary` 4.36:1
and `--text-secondary` 2.38:1, against `docs/DESIGN-SYSTEM.md` §8's "anything on the wall
≥ 7:1 regardless of size". Every wall caption sits on it. Raising the scrim changes what
the projector renders, so it is **a re-baseline with a human looking at every image** and
belongs with the wall work below, not in the change that defined the material. The number
is pinned by a test in the meantime, so it cannot quietly get worse.

**Closed under [11.3](#113-the-budget-that-keeps-it-usable-p1-effort-s-risk-low), at 0.83.**
The pin is gone with it: what stands in its place is not two numbers held in the direction
they were wrong in but §8's sentence swept over every ink the wall paints.

**Corrected under 11.2: one floor was one too few, and the correction is smaller than it
looks.** Deriving the tint from the worst possible backdrop and applying it everywhere held
most of this product — login, the dashboard, the create form, the settings page, the join
screen — to a number a white dress demands, on screens that never show a photograph. There
are now two floors: `0.95` over an unknown photograph, and `0.92` over our own ground, where
the backdrop is a colour this design system declares and the worst case is therefore
enumerable. Which one a surface gets is decided structurally — `app/glassBackdrop.test.ts`
walks the real import graph and refuses the translucent floor to any address that can reach
an `<img>`, a `<video>`, or a fill brighter than the backdrop that floor was derived
against.

**And the measurement is the interesting part, because it is small: three points of alpha,
5% of the backdrop against 8%.** The photograph was never what made the material opaque.
`--text-muted` clears 4.62:1 on `--surface-overlay` against a 4.5 target, so the palette has
about a tenth of a ratio point of headroom whatever is behind the pane; narrowing the
backdrop spends nearly all of it. A markedly more translucent tier needs an ink moved or a
pane's ink budget narrowed, which is a change with its own argument and nobody has made it.
The guard also found a case the obvious rule would have missed: `/admin/events/:slug` shows
no guest photograph and is on the strict floor anyway, because the join QR's plate is a
near-white `--text-primary` field.

### 11.2 Motion that answers the hand (P1, effort M, risk: medium)

The animation work is not "add transitions". It is: what does the interface do when a guest
presses a button, when a photo arrives on a moderator's queue over SSE, when the wall
changes slide, when an upload fails? Each of those is a moment where motion carries meaning
— the state changed, and here is where it came from — and everything else is where motion
is noise.

`docs/DESIGN-SYSTEM.md` §7 already has a motion scale. This extends it rather than
replacing it, and inherits its non-negotiable: **`prefers-reduced-motion` is a health
requirement, not a taste setting.** Under it, every decision must remain reachable and every
state change legible. The phone moderation console already proves this can be done — the
card stops travelling and the swipe still decides.

The specific trap, learned here: the wall now runs Ken Burns over a playing `<video>`, and
adding a blurred pane over that means the compositor is scaling, decoding and blurring at
once. Animate `transform` and `opacity` only, never layout properties, and treat
`will-change` as a scarce resource rather than a default.

**Done, and the list of what was left still is longer than the list of what moves.** Two
moments gained motion: a photo arriving on the moderation queue over SSE, where the one new
tile fades and rises and nothing else on the list does; and an upload failing, where the
row's border goes to `--danger` and the sentence saying why rises as it mounts. Two already
had their answer and were not touched: a guest pressing a button, and the wall changing
slide. What was deliberately left still, with the reason, is the table in
`docs/DESIGN-SYSTEM.md` §7 — the guest's own uploads list above all, because it scrolls
_under_ the glass composer and a thumbnail travelling behind a blurred pane is a backdrop
re-filtered every frame, on the one machine that is also encoding a photograph.

Two corrections came out of it. **§7's rule as written was broken by the design system's own
`Button`**, which has transitioned `background-color` since 2.0: the reason the rule gives
is layout, and a colour is not a layout, so the budget is now three tiers — compositor,
paint, layout — and the layout tier is empty and mechanically enforced. And
`prefers-reduced-motion` is now answered per animation out of a closed set of three answers,
with `motion.budget.test.ts` failing on any animation that gives none — which is how the
health requirement stops depending on whoever reviews the diff.

### 11.3 The budget that keeps it usable (P1, effort S, risk: low)

The item that makes the other two safe, and the one most likely to be skipped. A redesign
of this kind is judged on two machines nobody develops on:

- **A venue mini-PC driving a projector for eight hours.** The wall must hold its frame
  rate through a crossfade with a clip playing. If glass costs frames there, the wall gets
  the opaque fallback and the guest surfaces keep the blur — that is an acceptable outcome,
  decided in advance rather than discovered at a wedding.
- **A mid-range Android phone on saturated wifi, mid-upload.** Blur is GPU work competing
  with an encode and a request. The upload screen staying responsive outranks how it looks.

So this item is: a measured frame-rate floor on the wall, a first-interaction budget on the
guest surface, both asserted rather than asserted-about — and a written rule for what is
switched off first when a device cannot afford it.

The visual regression baselines will move, deliberately and all at once. That is a
re-baseline with a human looking at every image, not a `--update-snapshots` in a hurry: the
suite exists because a wall regression is invisible in a diff.

**Done, and the honest version of "asserted" turned out to be that the machine asserts it.**
A frame-rate floor taken on a CI runner is a number about the runner, so the floor ships
instead of being checked: the wall reads the interval between its own paints, judges windows
of ninety of them on how many frames a second they add up to, and gives something up when
two in a row fall under 24. That floor is the third rule that was tried — a dropped-frame
count and a delivered-frame share were both measured against real walls first, and neither
could separate a healthy wall on a loaded machine from a wall in trouble. The rule for _what_
it gives up is a list —
`design-system/budget.ts` — with one entry per cost in the order they go: **glass, then Ken
Burns, then the crossfade**, one ladder for every surface, with the room starting one rung
down because it can never afford the first. The guest's half is not a frame rate at all: an
upload screen is still between taps, so what is measured there is how long the interface
takes to answer a thumb, against Interaction to Next Paint's published 200 ms. Both feed one
reducer that needs two consecutive bad verdicts, because one is a decode.

What makes that safe enough to do automatically is that **no rung is a new rendering**. Each
lands exactly where `prefers-reduced-motion` and the capability fallbacks already land, both
of which have committed baselines. A preference and an exhausted mini-PC arrive at the same
screen for different reasons.

**And `--surface-scrim`, 11.1's open finding, is closed at 0.83** — the lowest alpha at which
every ink the wall paints clears §8's 7:1 over pure white, with 0.82 failing. `Dialog`'s
backdrop, which had borrowed the same token to dim a page it writes nothing on, moved to
`--surface-dim` and kept 0.55.

**The baselines did not move, and that was the finding rather than the relief.** All eleven
are pixel-identical, because `aPhoto` derives its colour from its label and every colour it
happened to draw came out dark — where 55% black and 83% black are the same picture. The one
suite whose job is to make a wall change visible to a human could not see this one. There is
a twelfth baseline now, of a caption over a photograph at the top of the sRGB gamut, which is
the backdrop the alpha is derived against.

### What this is not

- **Not a component rewrite.** The primitive catalogue and the token architecture are the
  reason this is affordable at all; a redesign that discards them buys a fresh set of the
  bugs they already fixed.
- **Not motion on everything.** A list that animates every row on every render is slower to
  read, and a moderator working a queue at 23:00 is reading, not admiring.
- **Not a reason to touch the guest's critical path.** Join, pick, send. If any of the three
  gets a frame slower or a tap longer, the change is wrong however good it looks.

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

1. **Offline upload queue** (§9.1, shipped) — the difference between photos arriving and
   photos being lost to a saturated access point. Everything else assumes the upload
   works.
2. **Photo missions** (§2.1) — the cheapest large increase in how much guests
   participate, and it changes the wall from a screensaver into something the room is
   part of.
3. **Shared gallery link** (§4.1) — answers the question every host is asked the next
   morning, and the reason they recommend the tool to the next person.

---

## 9. Done

What has shipped, with the change that did it. Kept in full rather than summarised: the
reasoning that justified each one is the part worth re-reading when the next item looks
similar.

### 9.1 Offline upload queue

_Shipped in [#10](https://github.com/Irony42/EventSlide/pull/10)._

A service worker plus IndexedDB: a photo selected with no usable connection is stored on
the device and sent when connectivity returns, with the Background Sync API where
available and a foreground retry everywhere else.

It was described here as "the single most valuable thing left to build", for a reason
that has not changed: venue Wi-Fi at a hundred-guest event is not "sometimes slow", it is
_saturated between 19:00 and 23:00_ — exactly the window when photos are taken. What
existed before was a retry button, which only helps a guest still looking at their phone.
The photo now arrives whether or not they are.

What landed:

- **An outbox behind a port** (`web/src/lib/offline/`). One IndexedDB adapter, one
  in-memory fallback, one shared contract suite run against both — the same arrangement
  `src/application/ports/` uses server-side. The fallback is not a test double: Firefox
  in private browsing rejects the database outright, and those guests still get a queue
  that survives a dropped connection for the length of the tab.
- **Bytes, not Blobs.** IndexedDB is specified to store a `Blob`, and WebKit has a long
  history of losing one. WebKit on a phone is the browser the largest share of guests
  actually use, so entries hold an `ArrayBuffer` and the `File` is rebuilt at send time.
- **One drain, two runtimes.** `drainOutbox` takes a store and a sender, so the page
  (through the ordinary transport) and the worker (through bare `fetch`) share one set of
  rules: one claim, one backoff, one expiry.
- **A kill switch with teeth.** `?offline=off` does not merely stop new work — it
  unregisters the worker and deletes the stored photos on the next page load. A switch
  that only stopped new installations would leave a bad build running on precisely the
  phones it was breaking.
- **Its own Playwright project**, `chromium-offline`, which cuts the network out from
  under a live page rather than stubbing a route.

Three defects the tests caught before anyone else could, all worth recording because
each is the kind that survives review:

1. `?offline=maybe` silently re-enabled a queue somebody had switched off, because an
   unrecognised value read as "not off, therefore on".
2. `claimedAt` was doing two jobs — "a drain holds this" and "this is when it last
   tried" — so releasing an entry after a failed attempt also looked like a live
   two-minute lease, and the follow-up drain armed for its two-second backoff found
   nothing to do.
3. Nothing rescheduled a drain once every remaining entry was inside its backoff:
   `online` fires once, and a photo queued offline and then reloaded back into view sat
   there reported as waiting and sent by nothing. The drain now reports when it is worth
   looking again, and the screen arms one timer from it rather than polling — a poll
   would wake a phone in somebody's pocket all evening to serve the few guests with a
   queue.

The risk named here originally — "service-worker lifecycle bugs are hard to reproduce
and easy to ship" — was real and is why the worker does exactly one job. It caches
nothing, intercepts no `fetch` and claims no navigation, so the worst a bug in it can do
is delay a photo. Precaching the app shell belongs with 1.2, and deliberately did not
come along for the ride.

### 9.2 Installable PWA

_Shipped in [#11](https://github.com/Irony42/EventSlide/pull/11)._

An install offer after a guest's first successful upload — not before, because a prompt
on arrival is friction at the worst possible moment.

What was missing turned out to be more than the prompt. The manifest existed but carried
only `favicon.svg`, and **Chromium refuses to make an app installable without a 192px and
a 512px raster icon** — silently: the manifest simply never becomes installable,
`beforeinstallprompt` never fires, and nothing anywhere says why. So the feature had
never been one line of JavaScript away; it had been impossible.

What landed:

- **Five icons**, rendered from the existing `favicon.svg` by `scripts/generateIcons.ts`:
  192 and 512 for Chromium, two maskable variants drawn inside Android's 80% safe zone
  so a launcher's crop does not cut the mark, and a 180px `apple-touch-icon` because iOS
  ignores the manifest's icons entirely and reads a `<link>`. They are committed rather
  than built — Vite copies `web/public` at the start of a build, so a fresh clone running
  `npm run dev` would otherwise have a manifest pointing at four 404s — and
  `scripts/generateIcons.test.ts` re-renders and compares pixels, so editing the mark
  without re-running `npm run build:icons` fails the build rather than shipping last
  quarter's logo to somebody's home screen.
- **The offer itself**, held back until `mine.photos` is non-empty. A guest forty seconds
  from sending their first photo is never interrupted; one who has proved the app works
  is asked once.
- **Two shapes, because the platforms genuinely differ.** Chromium gets a button that
  raises the real prompt. iOS Safari has no API at all, so it gets the one sentence that
  helps — Share, then "Sur l'écran d'accueil" — detected through `navigator.standalone`,
  a feature check rather than a user-agent string. Firefox gets nothing, which is the
  correct answer rather than a card it could not honour.
- **"No" outlives the tab.** A guest who declines at 21:00 is not asked again at
  midnight, which is exactly when the second half of an evening's photos are taken.

One thing the mark itself needed: `favicon.svg` was invalid XML. Its comment named the
accent CSS custom property the way CSS spells it, and `--` is forbidden inside an XML
comment. Every browser had accepted it; `sharp` refused it outright, which is how a file
that had been wrong since it was written came to light.

**The app shell came with it, and not by choice.** Chromium dropped the service-worker
requirement for a _menu_ install (108 on mobile, 112 on desktop), but the algorithm that
fires `beforeinstallprompt` still wants a worker with a `fetch` handler — so the offer
this item is about could not have appeared without one. The worker added in 1.1 had none,
on purpose.

It now precaches the entry bundle and answers for it **network-first**, so a deploy is
never served stale to somebody standing in front of a working access point, and it
refuses to touch anything under `/api/` at all: uploads, media, authorization and the
wall's eight-hour SSE connection take exactly the path they would with no worker
installed. Chrome's own account of relaxing that requirement is that sites gamed it with
empty pass-through handlers which hurt performance, so this one does real work or gets
out of the way entirely. An installed EventSlide now opens with no connection, which is
what an installed app is for.

### 9.3 More wall layouts

_Shipped in [#14](https://github.com/Irony42/EventSlide/pull/14), with the baseline fix it exposed in [#16](https://github.com/Irony42/EventSlide/pull/16)._

`spotlight` and `mosaic` shipped in 2.0. The layout registry was already a closed union
with a per-layout spec, and each addition was contained exactly as predicted:

| Layout      | What it is for                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `polaroid`  | Three photos as tilted prints on a dark ground. Reads as warm and handmade; the right choice for a small wedding.      |
| `filmstrip` | A slow horizontal drift. Good for a cocktail hour where nobody is watching continuously.                               |
| `collage`   | New photos compose into a growing grid that fills over the evening. The room watches it fill, which is its own reward. |
| `split`     | Two photos side by side, pairing an old upload with a new one.                                                         |

What landed, and the three decisions that were not obvious from the paragraph above:

- **The drift needed a number the wall already had.** The filmstrip is the only
  animation on the projector that runs for a whole slide, which makes it the one place
  1.0's Ken Burns defect could come back — an animation with a duration of its own
  standing next to a slide interval. `useSlideshow` now reports the interval its own
  clock is running on, and the drift is timed from that; there is no second setting left
  to fall out of step with the first. The track is also keyed on the playlist position,
  so the movement restarts at the instant the content changes rather than drifting out
  of phase with it over eight hours.
- **"Fills over the evening" became "fills over the first twelve slides."** The collage
  grows from one cell to twelve and then recycles a cell in turn. A grid that genuinely
  grew for eight hours would end the night at a photo per few hundred pixels, which is
  the point at which a face stops being a face from five metres — so the growth is the
  first minutes of the evening, and the ceiling is the renderer's `COLLAGE_CELLS`, which
  mirrors `wallLayoutSpec('collage').slotCount` and cannot be joined to it: the import
  boundary keeps the domain out of `web/`, so the number is pinned twice and the two can
  drift. **The fill is per-screen and does not synchronise.** It comes from the count of
  slides that browser has shown, so a kiosk that reloads at 23:00 drops back to one cell
  and takes twelve slides to refill. Which photo sits in which cell is derived from the
  playlist position alone, so two screens on the same index compose the same grid — but
  nothing in this build gives two screens a shared cursor in the first place: trap 7
  removed `sessionStorage`, and `useSlideshow` still adopts the newest photo on its own
  first frame. Synchronised projectors would need a cursor on the wire, which is not
  this item.
- **The polaroid needed the palette's first light ground.** `--surface-print`,
  `--text-print` and `--text-print-secondary`, for paper and for the two weights of
  pencil on it. It is the one caption in the product that is ink on a material rather
  than light over a photograph, and both inks are held to the wall's 7:1 contrast bar by
  `tokens.contrast.test.ts`. The credit was briefly `opacity: 0.75` over the mat instead,
  which measured 5.6:1 and which that test was structurally unable to see — so it now
  also refuses any `opacity` on caption text, because a ratio between two declared
  colours says nothing about a composite.
- **The wall had a corner it had never told anyone about.** The join card is the default
  state, bottom-right, and the two new layouts that centre a caption in the bottom band
  printed the guest's words under it — cut mid-word, and photographed as correct by the
  first baselines. The wall now declares the corner (`--wall-chrome-inline-end`, from the
  card's own `--wall-join-card` width) and `polaroid` and `split` lay out inside what is
  left. The card yields rather than the caption, because a caption is content and a card
  is chrome; and because the card is dismissible, the width comes back with one Escape
  rather than being a standing tax. Details and the measurements in DESIGN-SYSTEM.md §9.

Under `prefers-reduced-motion`, the polaroid's landing and the filmstrip's drift are
declined outright in JavaScript; the collage's cell arrival ends at the cell's resting
state, so the `base.css` collapse lands exactly where the animation would have. `L` walks
all six layouts and wraps — 2.0's two first, so the first press still lands on the mosaic.

### 9.4 Moderation on a phone

_Shipped in [#13](https://github.com/Irony42/EventSlide/pull/13); the card was taller than the phone it was held on until [#17](https://github.com/Irony42/EventSlide/pull/17)._

The host is not at the laptop. They are at a table, standing, holding a phone. The
moderation console is built for a keyboard, and no amount of responsive CSS makes a
dense grid workable one-handed.

A separate mobile surface: one photo at a time, swipe right to publish and left to
refuse, undo always reachable. Reuses every use case; it is a view, not a feature.

What landed, at `/admin/events/:slug/moderation/mobile`, reached from the event page:

- **No server code at all.** No endpoint, no use case, no migration. The screen is a
  second view over `useModerationQueue` — same fetch, same SSE channel, same decisions —
  which is what the entry meant by "a view, not a feature", and it is worth saying twice
  because a mobile surface is exactly the kind of thing that grows its own API.
- **The gesture is arithmetic, not a library.** `web/src/features/moderation/swipe/`
  holds a pure reading of a drag — how far commits, when the direction is announced,
  what taking it back means — tested without a DOM; `hooks/useSwipeDecision.ts` feeds it
  pointer events. There is no CDN and no new runtime dependency on a host's phone.
- **Every decision is also a button.** A swipe-only console is unusable with a screen
  reader and unusable one-handed by somebody with limited mobility, so the gesture is a
  shortcut over the same two controls, and the e2e measures their touch targets on a
  real phone viewport.

**Where it does not match the entry above, and why.** "Undo always reachable" is not
literally deliverable on this surface without server work the entry forbids. A photo
awaiting a decision has no status any verb puts it back into — `pending` is not a
moderation outcome — so `useModerationQueue` offered nothing after a decision on a fresh
photo, and a persistent "annuler" would have been a permanently disabled button. What
shipped instead is one opt-in option, `useModerationQueue(slug, { undoOfPublish: 'hide' })`,
passed by the phone console and by nothing else:

- **A publication can be taken back**, with `hide`. The photo leaves the wall, which is
  what the host meant, and lands in "Retirées" rather than back in the queue — so the
  console says "retirée de l'écran" rather than claiming a decision was cancelled.
- **A refusal cannot**, here or anywhere. The only verb that would reverse it is
  `publish`, on a photo the host has just turned down, which would put it on a screen in
  front of the room with nobody's approval behind it. `src/domain/moderation/
moderationDecision.ts` refuses the same inference, and this agrees with it.

The desktop console keeps the old behaviour exactly, and a regression test pins it: with
no options, publishing a pending photo still offers no undo. Restoring a photo to
`pending` — a true undo, and the only one that would satisfy the entry as written —
needs the server to record where a decision came from, which is a use case and a
migration, so it belongs in its own roadmap item rather than in this one.

### 9.5 Scheduled open and close

_Shipped in [#15](https://github.com/Irony42/EventSlide/pull/15)._

An event goes live at 18:00 and closes at 02:00 without anyone remembering. Two fields on
the aggregate, a migration, and a sweeper that applies them — the small item on this list,
and the one that most often decides whether a host has to stand at a laptop at midnight.

The thing it taught was not about scheduling. Its visual job was red on `main` before it
began, because the polaroid wall tilts each print by a hash of its photo id and every
seeded run produced fresh ids: the baseline was comparing forty-seven thousand pixels of
nothing. Deterministic ids under `E2E_HOOKS` fixed it, and this point's green visual run
is what proved it.

### 9.6 Spoken captions — **Considered and declined**

_Recorded in [#12](https://github.com/Irony42/EventSlide/pull/12). Not built, and this is the reasoning, kept so it is not rediscovered._

The Web Speech API for the caption field. Typing on a phone in a dark room with a drink
in hand is the reason most photos arrive without a caption, and captions are what make
the wall feel like the room rather than a screensaver. The problem is real and the entry
below is kept so nobody proposes it a third time without knowing what it costs.

It was built, and it worked. It is not being shipped, for one reason: **`SpeechRecognition`
is not an on-device API in the browsers that have it.** Chrome streams the captured audio
to Google's recognition service and Safari to Apple's, over their own connections. No
header and no setting this application controls keeps that audio local, or in the EU, or
out of a third party's logs.

That is irreconcilable with the posture the rest of this product is built on. There is no
CDN here; the fonts are self-hosted **specifically** to deny Google a log of every guest's
IP address ([SECURITY.md §8](SECURITY.md)); EXIF is stripped on ingest so a guest's phone
does not hand over the venue's GPS coordinates. A guest at somebody else's wedding did not
choose this software and often does not know it exists, which raises the bar rather than
lowering it. Shipping a button that sends their voice — and the conversation of everyone
standing near them — to Google would undo in one feature what several others exist to
protect.

The implementation answered every objection it could. It told the guest where the audio
was going before they pressed rather than after, it kept typing unchanged and always
available, and the operator could switch it off in one line. None of that changes what
happens when a guest does press it.

What would change the decision: an on-device recognition engine the browser exposes
without a network round trip. Chrome has shipped on-device speech in other surfaces and
the Web Speech API may follow. Until then the honest answer is that this product cannot
offer dictation without breaking a promise it makes everywhere else, and a caption typed
with one thumb is a smaller loss than that.

The two things the attempt did turn up are worth keeping either way:

- `Permissions-Policy` sends `microphone=()`, and an **empty allowlist disables a feature
  for the document itself**, not only for embedded frames. Anything reaching for the
  microphone or the camera here will hit that first, with `service-not-allowed` and no
  prompt, and no clue as to why.
- A single `SpeechRecognition` object reused across sessions delivers a dead session's
  `aborted`/`end` pair to the next session's handlers. Whoever tries this next: build one
  per session and detach its handlers before aborting.

---

### 9.7 Short video clips

_Shipped in [#18](https://github.com/Irony42/EventSlide/pull/18) (server) and
[#19](https://github.com/Irony42/EventSlide/pull/19) (guest, moderation and wall)._

The most-requested thing at weddings and the hardest item on this list. 5–15 seconds,
transcoded to a web-friendly H.264/AAC, muted on the wall with a duration cap and its own
quota line.

The risk named here was real and is where the work went. `ffmpeg` is a large native
dependency, transcoding is CPU-bound in a way image resizing is not, and a single 4K clip
can outweigh a hundred photos — so it needed a job queue and backpressure, the first
thing in this document to change the architecture rather than extend it.

What landed:

- A `ClipJob` aggregate **separate from `Photo`**, so a clip still encoding has no
  `photos` row at all and "reaches the wall half-encoded" is unrepresentable rather than
  filtered out downstream. A finished clip becomes a facet on `Photo`.
- **Reserve, then write.** The row is inserted before a byte is on disk, deciding queue
  depth, quota and source uniqueness in one transaction. A refusal costs nothing, the
  quota counts what is actually on the disk, and deleting is safe because the row is the
  proof of ownership.
- One in-process worker at concurrency 1 with a lease; ffmpeg as the system binary, input
  demuxer pinned, metadata and chapters dropped, output capped in duration, pixels and
  bytes.
- Backpressure is `429` with `Retry-After`, never `413`, and the guest surface
  **honours** the delay rather than displaying it — the bytes are written before the queue
  is consulted, so an early retry costs the guest their upload twice.
- Clips are deliberately **not** queued in the offline outbox. A phone holding 80 MB it
  cannot send is a phone that never sends anything else either.
- On the wall, only `spotlight` and `split` play; the other four show the poster. That
  rule lives in the domain with a client mirror and a contract test that fails naming the
  layout when they drift — `collage` would ask a venue mini-PC for twelve simultaneous
  decodes.
- A media reconciliation sweep that three comments in the tree already assumed existed.

**What it cost, and the part worth carrying forward.** Seven adversarial review rounds ran
against the two halves. Every one started from a green `npm run verify` and every one
found something the suite had passed over: two guests sending the same video destroyed it;
a clip refused because the album was full could never be sent again even after the host
made room; a crash stranded a reservation for a whole evening; an `unlink` throwing on a
read-only mount wedged a row in `running` for the life of the process; the wall swapped a
clip for its poster at the start of every crossfade.

They share one shape. **Every defect that survived lived in a rule stated only in a
comment** — prose asserting an invariant, with no test that failed when it broke. The
file-descriptor leak is the cleanest example: `mediaRoutes` opened a byte stream merely to
learn an object's size, and a comment calling that stream "cheap" is what made it look
safe to six consecutive reviews. A `<video>` seeking would have climbed to `EMFILE` and
taken the wall down mid-event. It was found by an external reviewer who looked at the read
path while everyone else was looking at writes.
