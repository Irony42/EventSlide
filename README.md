# EventSlide

**A live photo wall for your event.** Guests scan a QR code, send photos from their
phone with no account and no app, you approve them, and they appear on the projector
within seconds.

Self-hosted. The photos stay on your machine.

> **2.0 is on `main`** — this README describes it, and the `git clone` below gets it.
> The architecture and its reasoning are in [docs/](docs/).

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
- **The album is yours afterwards.** One ZIP, full resolution, and an automatic purge
  when you choose one.

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

Node 22.12 or later.

```bash
npm install
cp .env.example .env      # then edit it
npm run db:migrate
npm run build
npm start
```

To look around before there is a real event, `npm run db:seed:demo` creates one with
a handful of photos in each moderation state, so the admin console and the wall both
have something to show.

</details>

## On the night

1. **Create the event** in `/admin` — a name is enough.
2. **Print the QR code** from the event page and put it on the tables.
3. **Open the wall** on the projector: the display page, fullscreen. It needs no
   keyboard after that.
4. **Keep the moderation queue open** on your laptop or phone. New photos arrive by
   themselves; `J`/`K` to move, `P` to publish, `R` to refuse, `Z` to undo.
5. **Afterwards**, download the album from the event page.

Two settings worth a thought before you start:

- **Moderation.** `Valider chaque photo` is the default and the right choice for
  anything with colleagues or extended family in the room. `Publier automatiquement`
  is for a small party among close friends, and the app will warn you.
- **Retention.** Nothing is deleted unless you ask. If you set a retention period, the
  album is purged that many days after the event closes — export it first. The server
  checks every hour and deletes what is due, so the promise the setting makes to your
  guests is kept without you remembering. `npm run purge:dry-run` lists what the next
  sweep would remove, `npm run purge` does it now, and
  `RETENTION_SWEEP_INTERVAL_MINUTES=off` hands the schedule to your own cron.
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

Take one before the event and one the morning after. It is two commands, the server can
stay up, and the second one is the half that matters.

```bash
npm run backup                           # -> ./backups/eventslide-<timestamp>/
npm run backup -- --to /mnt/usb/mariage  # or somewhere that is not this machine

npm run restore -- <archive> --dry-run   # rehearse: verify, print the plan, write nothing
npm run restore -- <archive> --force     # --force is required to overwrite anything
```

The archive is a directory holding a consistent snapshot of the database, every photo,
and a manifest of counts and checksums. `backup` re-reads everything it just wrote before
it says OK, so an archive that exits 0 is one you have a reason to trust;
`npm run backup:verify -- <archive>` re-checks an older one. `restore` verifies the whole
archive before it touches anything and refuses to overwrite an installation that is still
there unless you say `--force`, which tells you exactly what it is about to destroy.

Copy the archive somewhere else, and keep your `.env` with it — the secrets are not in
the archive, and restoring photos with new ones signs every host out. Details, and what
the checks do and do not catch, are in
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
