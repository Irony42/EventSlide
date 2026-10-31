# Licence, in detail

GNU Affero General Public License, version 3 only — **AGPL-3.0-only**, no "or later"
clause. The full text is in [LICENSE](../LICENSE), unmodified from the Free Software
Foundation, and `package.json` declares the same `AGPL-3.0-only`, so the declaration
and the grant agree. [NOTICE](../NOTICE) carries the copyright line and names the main
third-party components that stay under their own licences.

The AGPL adds one obligation to the GPL, its section 13: if you modify EventSlide and
let other people interact with your modified version over a network, you must offer
those users the Corresponding Source of your version. Running an unmodified copy
triggers nothing beyond what the GPL already asked, and handing a copy to someone
else still means passing on the licence and the source, exactly as before.

EventSlide makes the offer for you: every guest and host screen carries a "Code source
(AGPL-3.0)" link, and `GET /api/about` publishes the same address. Unset, it points at the
upstream tag of the running version, which is the source of exactly that build **only when
you run an unmodified copy of that tagged release**. For anything else — a modified build, a
fork, a commit no tag names — set `SOURCE_CODE_URL` to where your source is published
([`.env.example`](../.env.example) says how). You can change where the link points; there is no
setting that hides it.

An instance that asks for support can set `DONATION_URL` and `BUDGET_URL`, empty by default, and a donation unlocks nothing: same service for everyone.

An instance run for other people can name its operator and link its legal pages with `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL`, `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_NOTICE_URL`, `SUPPORT_URL` and `REPORT_URL`, all empty by default: a self-hosted box that sets none of them looks and behaves exactly as before. Setting `LEGAL_TERMS_VERSION` beside `LEGAL_TERMS_URL` makes accepting an invitation also accept the terms, with a recorded version.

Dependencies are held to the same standard. `scripts/licenseAudit.test.ts` reads
`package-lock.json` and fails the build on any licence outside a short permissive
allow-list (MIT, ISC, BSD, Apache-2.0, 0BSD, MIT-0, BlueOak-1.0.0) unless a named,
argued exception covers that package: today sharp's LGPL libvips in production, and a few
development tools that never reach the image. The web build writes the notices the
bundled libraries ask for to `/third-party-licenses.txt`, which `/about` links.

**Everything published before this change remains under GPL-3.0, permanently** — a
licence grant cannot be revoked after the fact. `v3.0.0` is the first release under the AGPL;
`v2.1.0` is the last release under the GPL-3.0, and the tag `gpl-final` is on the last GPL-3.0
commit. [.github/gpl-boundary](../.github/gpl-boundary)
names the last commit that carries the GPL text, and the `licenseHistory` CI job
checks that every commit after it on the first-parent line of `main` carries the AGPL one.
[docs/LICENSING-FAQ.md](LICENSING-FAQ.md) answers what this asks of someone who runs,
changes or forks it.

In short: run it, read it, change it, and pass it on — and if you let others use a
modified version over a network, ship them its source under the same licence.
