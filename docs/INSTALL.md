# Installing EventSlide

The full install: Docker, the https proxy, and running without Docker. The README has the three-command version.

You need Docker, and an https address your guests' phones can reach. The commands come
first; what the https part asks of you is explained after them.

```bash
git clone https://github.com/Irony42/EventSlide.git
cd EventSlide

# Two secrets, and the address your guests' phones will reach.
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
node -e "console.log('GUEST_TOKEN_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
echo "PUBLIC_URL=https://photos.example.com" >> .env
# Your own account, created on the first boot. The password is generated too, because
# one typed into a README is one everybody who read it could sign in with first.
echo "BOOTSTRAP_OWNER_EMAIL=you@example.com" >> .env
node -e "console.log('BOOTSTRAP_OWNER_PASSWORD='+require('crypto').randomBytes(18).toString('base64url'))" >> .env

docker compose up            # the first time, and read what it says
docker compose up -d         # once it has booted cleanly
```

The first `up` pulls the published image, `ghcr.io/irony42/eventslide` at the version you
checked out, for `linux/amd64` and `linux/arm64`. It is signed and scanned when it is released,
and [docs/IMAGE-SOURCES.md](IMAGE-SOURCES.md) says what is in it, where the source of
each part is, and how to check the signature. Nothing is built on your machine. To build it
from the checkout instead (a modified copy, an unreleased commit):

```bash
docker compose -f compose.yaml -f compose.build.yaml up --build
```

Once the https proxy described below is in front of it, open `PUBLIC_URL/login` and sign
in with that email and the generated password (`grep BOOTSTRAP_OWNER .env` shows it). The
first sign-in asks you to choose your own before it shows you anything else.

**Run it in the foreground the first time.** A missing or malformed variable makes the
server print every problem at once and exit rather than start — which is what you want,
and what you will not see if the first run is detached, because the container restarts
on its own and the list scrolls away. Once it boots, `-d` is the right way to leave it.

**The two `BOOTSTRAP_OWNER_` lines are how the first account is made.** There is no
default admin and no setup page: the server creates that owner on its first boot, against
an empty database, and creates nothing from them once any account exists. It still checks
them at every boot, so once you have signed in and chosen your own password, delete both
or keep both — one without the other is refused. A password of your own choosing is held
to the same rule as every account's, at least 12 characters and not an obvious one, and a
weak one is refused at boot like any other bad variable. The email is only checked when
the account is made: a malformed one creates nothing, and the log says so.

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

Whichever proxy it is has to tell the server that the request arrived over https
(`X-Forwarded-Proto`) and who sent it (`X-Forwarded-For`). Caddy and Traefik do without
being asked; nginx needs `proxy_set_header X-Forwarded-Proto $scheme;` and
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Without the first the
login cookie is never sent, and without the second every guest shares the proxy's address
in the rate limiter.

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

# The same secrets, address and first owner as the Docker install above. `npm start`
# reads this `.env` if it is there; it never overrides a variable your shell or your
# service manager already set, so a systemd unit can own them instead.
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
node -e "console.log('GUEST_TOKEN_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" >> .env
echo "PUBLIC_URL=https://photos.example.com" >> .env
echo "BOOTSTRAP_OWNER_EMAIL=you@example.com" >> .env
node -e "console.log('BOOTSTRAP_OWNER_PASSWORD='+require('crypto').randomBytes(18).toString('base64url'))" >> .env
# The one line `compose.yaml` writes for you: there is one proxy in front of the server.
echo "TRUST_PROXY_HOPS=1" >> .env

npm run db:migrate
npm run build
npm start
```

**The login needs `TRUST_PROXY_HOPS=1` behind your https proxy.** Without it the server
does not take the proxy's word (the `X-Forwarded-Proto` above) that the request arrived
over https, so it never sends the `Secure` login cookie: the sign-in form accepts your
password and you are still signed out. It also means the server believes the address the
proxy forwards, and `npm start` listens on port 4300 on every interface — so firewall that
port and let only the proxy reach it, or anybody on the network can claim an address of
their choosing and walk past the per-address rate limits.

**There is no weak default to fall back on, and that is deliberate.** `NODE_ENV` is
`production` unless something says otherwise, so a server started without those two
secrets prints both and exits instead of signing cookies with something it made up.
`.env.example` walks through most of the others — upload limits, quotas, video clips,
the two sweeps, the shared gallery's rate limits — and is worth reading; copying it
verbatim stops the boot, because the secrets in it are placeholders and the server knows
them by sight.

To look around before there is a real event, give the demo a scratch database and run
the development server on it, with `npm start` stopped — both use port 4300.
`npm run db:seed:demo` refuses a database that already holds an account, which yours
does from its first boot:

```bash
# An event with six photos on the wall and two awaiting moderation, and its login.
DATABASE_PATH=./data/demo.sqlite MEDIA_ROOT=./data/demo-media npm run db:seed:demo
# Then sign in at http://localhost:5173/login with what the seed printed.
DATABASE_PATH=./data/demo.sqlite MEDIA_ROOT=./data/demo-media npm run dev
```

Set per command rather than exported, so a later `npm start` in the same shell still
opens your real database; under `data/`, so git ignores it. The demo login asks for a new
password first, like any first sign-in.

</details>
