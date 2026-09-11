# EventSlide

**A live photo wall for your event.** Guests scan a QR code, send photos from their
phone with no account and no app, you approve them, and they appear on the projector
within seconds.

Self-hosted. The photos stay on your machine.

> **2.0 is in progress on the `deuxpointzero` branch.** 1.0 is on `main`. This README
> describes 2.0; the architecture and its reasoning are in [docs/](docs/).

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

```bash
git clone https://github.com/Irony42/EventSlide.git
cd EventSlide

# Two secrets, and the address your guests' phones will reach.
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
node -e "console.log('GUEST_TOKEN_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
echo "PUBLIC_URL=http://192.168.1.20:4300" >> .env
echo "BOOTSTRAP_OWNER_EMAIL=you@example.com" >> .env
echo "BOOTSTRAP_OWNER_PASSWORD=choose-a-long-passphrase" >> .env

docker compose up -d
```

Then open `PUBLIC_URL/login`.

**`PUBLIC_URL` must be an address a phone on the venue Wi-Fi can actually reach** — the
machine's LAN address or a domain, never `localhost`. It is what the QR code encodes,
and a QR code pointing at `localhost` is the most common way a setup fails on the night.
Test it by scanning your own QR code from your phone before the guests arrive.

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
  album is purged that many days after the event closes — export it first.

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

GPL-3.0, as declared in `package.json` — but the full licence text is **not yet in the
repository**. Until a `LICENSE` file lands, the declaration is a statement of intent
rather than a grant anyone can rely on, so add it before distributing this:

```bash
curl -o LICENSE https://www.gnu.org/licenses/gpl-3.0.txt
```

The repository has never carried the licence text itself. Add it before any release:

```bash
curl -o LICENSE https://www.gnu.org/licenses/gpl-3.0.txt
```
