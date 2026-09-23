# EventSlide

**A live photo wall for your event.** Guests scan a QR code, send photos from their
phone with no account and no app, you approve them, and they appear on the projector
within seconds.

Self-hosted. The photos stay on your machine.

> **2.0 is on `main`** — this README describes it, and the `git clone` below gets it.
> The architecture and its reasoning are in [docs/](docs/).

<p align="center">
  <img src="docs/images/wall-spotlight.jpg" width="49%" alt="The wall on a projector, one photograph full-bleed with the sender's caption and the join code in the corner">
  <img src="docs/images/wall-mosaic.jpg" width="49%" alt="The same wall in its mosaic layout, several photographs at once">
</p>
<p align="center">
  <img src="docs/images/guest-upload.jpg" width="19%" alt="A guest's phone: pick a photo, add a caption, send">
  <img src="docs/images/moderation-phone.jpg" width="19%" alt="Moderation on a phone: one photograph, swipe right to publish, left to refuse">
  <img src="docs/images/moderation.jpg" width="58%" alt="The moderation console on a laptop, the queue and the keyboard shortcuts">
</p>

---

## Why

Every event photo-sharing tool asks one of two things: that your guests install an app,
or that you hand a few hundred family photographs to a company you have never heard of.

EventSlide asks for neither. It runs on one machine — a laptop, a mini PC, a Raspberry
Pi under the projector — and nothing leaves it.

## What it does

- **Guests join by scanning.** A QR code, a six-character code, a first name if they
  feel like it. No account, no download, no email.
- **Nothing reaches the screen without you.** Every photo waits in a moderation queue
  until you approve it. Two hundred people are watching that screen; that is not a
  setting to leave to chance.
- **The wall is meant to be looked at.** Full-bleed photos with a slow zoom, a mosaic
  layout, captions and the sender's name, a join code in the corner for whoever arrives
  late.
- **It survives the venue.** Uploads retry, the wall keeps playing when the network
  drops, and it runs unattended for an eight-hour evening.
- **Privacy is handled, not mentioned.** Location data and device identifiers are
  stripped from every photo on arrival — a guest's camera records the coordinates of
  wherever they are standing, and that is often somebody's home.
- **Guests are told what happens to their photos, before the first one.** Who sees it,
  whether you check it before the screen, how long it is kept and how to have it removed
  — written from your event's own settings, in the guest's language, so it cannot say
  something your configuration does not do. Read once per phone, and shown again if you
  change one of those settings mid-evening.
- **The album is yours afterwards.** One ZIP, full resolution, and an automatic purge
  when you choose one.
- **And your guests', with one link.** The morning after, make a shared gallery link on
  the event page and send it to everybody: the photographs that were on the wall, in full
  resolution and without their location data, to download one by one or as a ZIP. It
  expires when you say (a month unless you choose otherwise), it can ask for a password,
  and you can switch it off at any moment — every photo it ever showed stops loading at
  once.

And the parts that only show up on the night:

- **Photo missions give guests something to do.** You write a short list of prompts — "a
  selfie with the couple", "the worst dance move", "someone crying" — and guests see them
  as a checklist. It changes the question in their head from "should I bother uploading
  this" to "which one is left".
- **Short video clips too**, not only photographs. Fifteen seconds, transcoded on the
  box, played on the wall without sound — because a room already has music.
- **Moderate from your phone.** One photograph at a time, swipe right to publish, left
  to refuse. The person deciding is usually standing up with a drink, not sitting at a
  laptop.
- **The upload survives the venue Wi-Fi.** A photo picked with no signal is queued on
  the phone and sent when there is some, even if the guest has closed the page —
  EventSlide installs as an app if they let it, and keeps working when the network does
  not.
- **It speaks everybody's language, not only the guest's.** French, English, Spanish,
  German and Italian, across the whole interface: the guest's phone, the moderation
  console, the admin pages and the projected wall. International weddings are the normal
  case, and so is a moderator who is not the person who installed the box.

  A guest and a host each pick their own from a control in the header, and it is
  remembered. The wall is the exception and it is the interesting one: there is nobody in
  front of a projector to ask, so its language is a setting on the **event**, chosen by
  whoever created it and defaulted to the language they were reading at the time.

  What is never translated is what people write. An event's name, a caption, a guest's
  display name and a mission prompt are shown exactly as typed — so a German wall over a
  French wedding prints German labels above French prompts, which is the right way round.
  A native reader has not yet gone over the German, Spanish and Italian copy on the host
  and wall surfaces; the French is hand-written and is the source the rest is translated
  from.

- **It looks like the evening it is running.** The host picks an accent colour, a font
  pairing and a frame style; the wall and the guest screens follow. Contrast is checked
  against the accessibility contract server-side, so a hue that would make captions
  unreadable at ten metres is refused rather than rendered.
- **Translucent surfaces that give way before the wall does.** The interface uses a
  glass material over photographs — and it is measured: if the machine driving the
  projector cannot hold its frame rate, the blur is given up before the animation, and
  the animation before the crossfade. A host who prefers the plainer surface turns it
  off per event.

## Install

You need Docker, and an HTTPS address for the box. Both are explained below the box.

```bash
git clone https://github.com/Irony42/EventSlide.git
cd EventSlide

# Two secrets, and the address your guests' phones will reach.
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
node -e "console.log('GUEST_TOKEN_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
echo "PUBLIC_URL=https://photos.example.com" >> .env
echo "BOOTSTRAP_OWNER_EMAIL=you@example.com" >> .env
echo "BOOTSTRAP_OWNER_PASSWORD=choose-a-long-passphrase" >> .env

docker compose up            # the first time, and read what it says
docker compose up -d         # once it has booted cleanly
```

Then open `PUBLIC_URL/login`.

**Run it in the foreground the first time.** A missing or malformed variable makes the
server print every problem at once and exit rather than start — which is what you want,
and what you will not see if the first run is detached, because the container restarts
on its own and the list scrolls away. Once it boots, `-d` is the right way to leave it.

**`PUBLIC_URL` must be an https address a phone on the venue Wi-Fi can actually reach**,
never `localhost`. It is what the QR code encodes, and a QR code pointing at `localhost`
is the most common way a setup fails on the night. Test it by scanning your own QR code
from your phone before the guests arrive.

**https is not optional, and this is the one part of the install that is not one
command.** EventSlide speaks plain HTTP and never terminates TLS itself, so something in
front of it does — Caddy, nginx or Traefik, whichever you already run. The reason is not
ceremony: a host's login cookie is marked `Secure`, so a browser will not send it back
over plain http, and a server that let you configure that would hand you a login form
that never logs in. Rather than fail there, it refuses at boot and says so. `compose.yaml`
binds the port to `127.0.0.1` for the proxy to reach and sets `TRUST_PROXY_HOPS=1` to
match; if your proxy is a container on the same Docker network, delete the `ports:` block
and point it at `eventslide:4300`.

With Caddy, the whole proxy is one line in a `Caddyfile` next to the compose file:

```
photos.example.com {
  reverse_proxy 127.0.0.1:4300
}
```

**A venue with no domain name is the case this does not cover.** A box on a LAN with no
DNS and no certificate cannot serve https that a guest's phone will trust, and EventSlide
will not run over plain http in production. Today the answer is a real domain pointed at
the machine — which works over the venue's Wi-Fi as long as the phones have any route to
it — or a `--network host` proxy with a certificate you already own. If you need a purely
offline wall, say so on the issue tracker; the constraint is deliberate but it is not
free, and it is written down as an open question rather than as a solved problem.

<details>
<summary>Without Docker</summary>

Node 24 or later.

```bash
npm install

# The same two secrets and the same address as the Docker box above. `npm start` reads
# this `.env` if it is there; it never overrides a variable your shell or your service
# manager already set, so a systemd unit can own them instead.
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
node -e "console.log('GUEST_TOKEN_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
echo "PUBLIC_URL=https://photos.example.com" >> .env

npm run db:migrate
npm run build
npm start
```

**There is no weak default to fall back on, and that is deliberate.** `NODE_ENV` is
`production` unless something says otherwise, so a server started without those two
secrets prints both and exits instead of signing cookies with something it made up.
`.env.example` documents every other variable and is worth reading; copying it verbatim
stops the boot, because the secrets in it are placeholders and the server knows them by
sight.

To look around before there is a real event, `npm run db:seed:demo` creates one with
a handful of photos in each moderation state, so the admin console and the wall both
have something to show.

</details>

## Photo missions

<img src="docs/images/missions-checklist.jpg" width="300" align="right" alt="A guest's checklist: four prompts, the first one ticked and marked Done">
<img src="docs/images/wall-missions.jpg" width="300" align="right" alt="The same four prompts on the wall: a standing panel in the corner, one answered and ticked with a guest count">

The cheapest way to get more photographs is to stop asking guests to decide what is worth
sending. Write four or five prompts on the event page and they become a checklist on every
guest's phone.

A guest taps a prompt before sending, which is one tap and no extra screen. The wall shows
the list with what has been answered so far, in a corner, standing still — it is a
scoreboard for the room, not a thing that flashes every time somebody uploads.

Two details that matter more than they look:

- **A mission is answered when a _published_ photograph names it**, not when a guest tags
  one. So a photograph you refuse in moderation never counted, and nothing has to be
  un-counted. The same holds for one a guest deletes, or one a retention sweep purges.
- **A prompt can be per guest or once for the evening.** "A selfie with the couple" is
  something everybody can do; "the first dance" happens once. You choose per prompt, and
  the default is per guest.

Prompts are content, not interface: you write them in the language of your evening and
they are shown exactly as typed. There is no leaderboard and no per-guest score — a guest
sees their own checklist and nothing about anybody else's.

<br clear="right">

## On the night

1. **Create the event** in `/admin` — a name is enough.
   Add photo missions here too, if you want them.
2. **Print the QR code** from the event page and put it on the tables.
3. **Open the wall** on the projector: the display page, fullscreen. It needs no
   keyboard after that.
4. **Keep the moderation queue open** on your laptop or phone. New photos arrive by
   themselves; `J`/`K` to move, `P` to publish, `R` to refuse, `Z` to undo.
5. **Afterwards**, download the album from the event page.

Two settings worth a thought before you start:

- **Moderation.** Approving every photo yourself is the default, and the right choice for
  anything with colleagues or extended family in the room. Publishing automatically is
  for a small party among close friends, and the app will warn you when you choose it.
- **Retention.** Nothing is deleted unless you ask — and your guests are told so. If you
  set a retention period, the album is purged that many days after the event closes —
  export it first, and take a [backup](#backups). The server checks every hour and
  deletes what is due, so the promise the setting makes to your guests is kept without
  you remembering.
  `docker compose exec eventslide node dist/ops/scripts/purge.js --dry-run` lists what
  the next sweep would remove, and the same command without `--dry-run` does it now —
  `npm run purge:dry-run` and `npm run purge` from a source checkout. Both are safe with
  the server running. `RETENTION_SWEEP_INTERVAL_MINUTES=off` hands the schedule to your
  own cron; with Docker it goes in the `environment:` block of `compose.yaml`, since the
  container sees only the variables listed there.
- **Opening and closing on their own.** The settings page takes an opening time and a
  closing time; leave either empty and you do that one yourself. The times are read on
  your own computer's clock, so 18:00 means 18:00 where the party is. If the server was
  off at 18:00 the event still opens at the next check — a missed window is honoured,
  not skipped — and closing an event stops uploads without deleting anything. A time you
  have already passed is refused when you set it, so check the date before you save "close
  at 02:00" at half past nine. `SCHEDULE_SWEEP_INTERVAL_MINUTES=off` stops the server
  applying schedules; it does not stop you setting them, so they pile up while it is off
  and the first check after you turn it back on applies them all at once — clear them
  first if any event has one.

## Backups

Take one before the event and one the morning after. The server stays up while you do,
and the step people skip is the one that matters: getting the archive off the box.

With Docker, from the directory holding `compose.yaml`:

```bash
# 1. Take it. It prints the name, e.g. /data/backups/eventslide-2026-09-12T08-00-00Z
docker compose exec eventslide node dist/ops/scripts/backup.js

# 2. Take it off the volume, check the copy, and only then delete it there. Until it is
#    off the machine it is on the same disk as the photographs, and the command says so.
A=eventslide-2026-09-12T08-00-00Z
docker compose cp "eventslide:/data/backups/$A" . &&
  docker compose run --rm -v "$PWD/$A:/restore:ro" eventslide \
    node dist/ops/scripts/backup.js --verify /restore &&
  docker compose exec eventslide rm -r "/data/backups/$A"
```

The archive is a directory holding a consistent snapshot of the database, every photo,
and a manifest of counts and checksums. `backup` re-reads everything it just wrote
before it says OK, so an archive that exits 0 is one you have a reason to trust.

It lands on the data volume because that is the only writable place in the container
that survives a restart — which is also why it cannot stay there, since a copy on the
same disk as the album survives everything except that disk failing. `docker compose cp`
brings it to the host, and it is a backup once a copy is on another machine or on a
drive you can unplug. Each archive is as large as the album and sits on the volume the
uploads fill, so delete it there once the copy has verified; the command refuses to
start one that would not fit, rather than fill the disk the wall is writing to. To
write it straight to a mounted drive instead, hand the command one; the directory must
be writable by uid 1000, the image's user:

```bash
docker compose run --rm -v /mnt/usb/backups:/backups eventslide \
  node dist/ops/scripts/backup.js --to /backups/before-the-party
```

To restore, **stop the server first.** A restore replaces the database file, and doing
that underneath the running server leaves the wall serving neither the old evening nor
the restored one — so never restore with `exec`. `run --rm` starts a one-off container
on the same volume while the service is stopped:

```bash
docker compose stop eventslide
A=eventslide-2026-09-12T08-00-00Z   # the copy you brought back
docker compose run --rm -v "$PWD/$A:/restore:ro" eventslide \
  node dist/ops/scripts/restore.js /restore --dry-run  # rehearse: verify, show the plan
docker compose run --rm -v "$PWD/$A:/restore:ro" eventslide \
  node dist/ops/scripts/restore.js /restore --force    # overwrites what is there now
docker compose start eventslide
```

`restore` verifies the whole archive before it touches anything, refuses to overwrite an
installation unless you say `--force`, and prints exactly what `--force` is about to
destroy. It runs as the image's own user, so the server can read everything it writes,
and the media directory keeps its `0700`. That user, uid 1000, also has to be able to
read the archive: a copy made by `docker compose cp` is readable, and one you have
locked down since needs `sudo chown -R 1000 "$A"` first. An archive still on the volume
needs no mount; pass its `/data/backups/...` path instead. To re-check an archive
without restoring it, `node dist/ops/scripts/backup.js --verify <archive>` runs the
same way and is safe with the server up.

There is no migration step. The server applies pending migrations when it starts,
before it answers a request, and `restore` brings the database it wrote up to the
running version itself.

From a source checkout the same commands are npm scripts, and an archive goes to
`./backups` unless `--to` says otherwise, or `BACKUP_DIR` is set in the command's own
environment (`npm run` does not read `.env`):

```bash
npm run backup                           # -> ./backups/eventslide-<timestamp>/
npm run backup -- --to /mnt/usb/mariage  # or somewhere that is not this machine
npm run backup:verify -- <archive>       # re-check one later

npm run restore -- <archive> --dry-run   # rehearse: verify, print the plan
npm run restore -- <archive> --force     # with the server stopped
```

Keep your `.env` with the archive — the secrets are not in it, restoring photos with new
ones signs every host out, and on a replacement box `docker compose` will not run a
single command, `stop` and `run` included, until the three variables `compose.yaml`
requires are back. Details, and what the checks do and do not catch, are in
[docs/SECURITY.md §11](docs/SECURITY.md#11-deployment-posture).

## For contributors

The interesting parts are documented rather than left to be inferred:

|                                                |                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)                         | The rules, the layer boundaries, and the traps this codebase has already fallen into |
| [AGENTS.md](AGENTS.md)                         | The same, for any AI coding agent                                                    |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | Layers, a guest upload traced file by file, the ports, the schema                    |
| [docs/TESTING.md](docs/TESTING.md)             | Six test rings and which one a given test belongs in                                 |
| [docs/SECURITY.md](docs/SECURITY.md)           | The threat model, written around who is actually in the room                         |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) | Tokens, primitives, and the accessibility contract                                   |
| [docs/API.md](docs/API.md)                     | The HTTP contract                                                                    |
| [docs/ROADMAP.md](docs/ROADMAP.md)             | What comes next, and what will never be built                                        |
| [docs/adr/](docs/adr/)                         | Why the architecture is the way it is, including the alternatives that lost          |

```bash
npm run dev            # API on :4300, web on :5173
npm run verify         # lint + typecheck + coverage + build — the gate
npm run verify:full    # the above plus the Playwright journeys
```

`npm run lint` enforces the architecture, not just the formatting: a file in
`src/domain` that imports Express fails the build. `src/domain` and
`src/application` are held at 100% branch coverage.

## Licence

GNU General Public License v3.0. The full text is in [LICENSE](LICENSE), and
`package.json` declares the same `GPL-3.0`, so the declaration and the grant now agree —
for a self-hosted product whose whole argument is that the operator owns their own
machine and their guests' photos, that is not administrative tidying.

In short: run it, read it, change it, and pass it on — and if you distribute a modified
version, ship the source under the same licence.
