# Running an event

The parts of EventSlide that matter on the day and after it: photo missions, the shared gallery, the night itself, retention and backups.

## Photo missions

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

## Photo book

The **Photo book** panel on the event page makes a PDF of the published album: a cover, one or
four photographs a page, first names and captions if the host wants them, and a closing page.
It is made in the background, one at a time and behind video transcodes, so a wedding that sends
videos all evening delays it (at most `BOOK_MAX_WAIT_MINUTES`). A render takes about 250 MB of
memory for 300 photographs, and a few seconds of one core.

- **Where it lives.** `MEDIA_ROOT/.books/<event>.pdf`, outside the event's folder: the hourly
  backup never holds it and the event's disk quota never counts it. After a restore, a book whose
  file is gone turns `stale` and the host makes it again.
- **How long.** `BOOK_TTL_DAYS` (7), never past the album's purge date; the sweep deletes the
  expired ones and any file no row names. `BOOK_MAX_TOTAL_BYTES` caps the box's total.
- **Who.** Any moderator of the event, like the album ZIP; the client can be switched off
  (`booksAllowed`), and an event gets three books a day (`BOOK_MAX_PER_EVENT_PER_DAY`).
  `BOOK_ENABLED=false` (restart needed) turns the function off for the box.
- **The printer version.** A host may ask for a second pair of files for a printing service: the interior
  (216 mm, bleed, trim and bleed boxes) and the cover, at 300 dpi. `BOOK_PRINT_ENABLED=false` stops offering it;
  `BOOK_PRINT_MAX_BYTES` (700 MiB, the two files together) drops it, keeping the screen book, when it would be larger.
  The files live beside the book and follow its expiry. `BOOK_MAX_MESSAGES` (60) caps the guest-book messages in a book.
- **Privacy.** A photograph removed afterwards, by anyone, retires the book at once: the file is
  deleted and the host is told to make it again. The same goes for a guest-book message printed in a book: erased by its guest, hidden or refused by the host, or taken down by the operator, it retires the book. A copy already downloaded is out of reach.

## Shared gallery

The morning after, the same question arrives from everybody, one at a time: can you send
me the photos. The **Shared album** panel on the event page answers it with one link.

Choose how long it stays open — 7, 30 or 90 days — and, if you want one, a password of at
least 12 characters to send separately. The address is shown once, when you make it: the
server keeps only a fingerprint of it, so copy it then. Making a new link switches the
old one off, and so does **Switch off the link**. Only the event's owners see the panel;
a moderator can publish to the wall, not to the internet.

Whoever opens the link needs no account. They type the password if there is one and get
the album as a grid; each photograph opens larger with **Download the original**, and
**Download everything (.zip)** takes the lot.

What the link hands out, and what it does not:

- **Full resolution, without location data.** The originals as the box stored them, which
  means already stripped of coordinates and device details on arrival. A video comes as
  the box transcoded it, not as the phone filmed it.
- **Only what was on the wall.** Pending, refused and hidden photographs are not in it,
  and one you take off the wall after sending the link is gone from it at the next page
  load.
- **Switching it off is immediate.** Nothing it has not already shown loads any more, in
  a tab already open either, and a ZIP halfway through downloading is cut off rather than
  finished — so nobody is left holding an archive that looks complete and is not.

## Before an album is deleted

The retention purge deletes an album on the date promised to its guests, and **never waits for anything**: not for an
archive, not for a download. What the box does so that nobody loses an album without having been told:

- **The host sees the date.** The event's page in the console carries `purge.at` (the earliest of the host's own retention,
  the client's ceilings and an offboarding's date), and nothing when the album is kept until a person deletes it.
- **The owners are written to three times: 14, 3 and 1 day before** (constants, not settings), by the same function the
  timer and `npm run purge` both run after the purge. **It needs a mail relay (`SMTP_URL`): without one nothing is sent and nothing
  is noted**, so an operator who configures SMTP later does not find a threshold skipped; the console's date is then the
  only warning. A message carries the album's name, the day and the address of its page, and no photograph. Each threshold is
  noted **before** the message is sent (a lost message rather than two), an album whose date shows up late (a 7-day retention, an
  offboarding with 2 days) gets the most urgent threshold that applies, once, and an album you hold (`purge_held_at`) or that has
  no date is never written about. The recipients are the event's owners, never moderators; the language is the client's, or the
  event's wall language.
- **The purge says what it left behind.** Each purged album is logged with `archive=…` (`served`, `sealed`, `incomplete`, `stale` or
  `none`), and one that left without an archive sent in full is a **`warn`** with its id, in the timer's log and in the lines of
  `npm run purge`. The word is what the box held: an archive a host asked for and downloaded in full is `served`, one never sent
  is `sealed`, one with files missing from the disk is `incomplete`, one withdrawn because the album changed is `stale`, and an album
  nobody asked an archive of is `none` (a host who downloaded the ZIP directly is invisible to it).
- **The host can ask the box to prepare a verified archive** (`POST /api/events/:slug/export`; the page for it is a later change of
  the same work, the routes are in [API.md](API.md#the-verified-archive-spec-22)). It is a ZIP of the album with a `MANIFEST.sha256`
  that the host checks at home with `sha256sum -c`, written by a worker **one at a time, behind the video transcodes**, read back from
  the disk before it is offered, and kept in `<MEDIA_ROOT>/.exports/`, **outside the event's folder, the quota and the backups**.
  It is a second copy of the album on the same disk, so **budget the disk**: an archive of a 6 GB album doubles the album's footprint
  while it is written. The box refuses early rather than fill the disk (`409 export.noRoom` against `MIN_FREE_DISK_BYTES`,
  `EXPORT_MAX_BYTES` for one archive, `EXPORT_MAX_TOTAL_BYTES` for all of them, default 12 GB), and abandons a write if a wedding fills
  the disk meanwhile. It lives until the first of `EXPORT_TTL_DAYS` (7), 48 hours after the host downloaded it in full, and the album's
  deletion date, and **never outlives the album**; a guest who erases themselves, a photograph removed, a reopening or your takedown
  deletes it at once. `EXPORT_ENABLED=false` (restart) turns the preparation off and leaves the direct download. If your off-box backup
  copies the volume whole with its hidden folders, exclude `.exports`: a purged archive must not survive in the repository.
- **You can copy the albums that are about to go, outside the box, before the purge.** `npm run export -- --due-within 14 --to /mnt/nas/albums`
  (in the image, `node dist/ops/scripts/export.js …`) is the step to run from cron ahead of `npm run purge`: for each album whose deletion
  date falls within the next 14 days (one already due included; one you hold, or with no date, never), it writes the **same verified
  archive** the host's button makes (same four checks) to `<dir>/<slug>-<deletion date>/album.zip` with `MANIFEST.sha256` beside it, prints
  files, size, SHA-256 and how many files were missing, and **exits 1 if any album failed**, so cron mails you. `--event <slug>` takes one
  album, whatever its date once the evening is over; `--dry-run` lists and writes nothing, not even the folder. The folder is named by the
  deletion date, so a nightly run rewrites one folder per album instead of piling up copies (and rewrites it whole: budget the disk and the
  time for a 6 GB album each night, or narrow the window). `--to` is refused inside, around or on `DATABASE_PATH` or `MEDIA_ROOT`. The
  database is opened read-only: **a copy on your disk is not an archive sent to the host**, nothing is marked, and `archive=` in the purge
  log does not change. The box's `EXPORT_MAX_*` ceilings do not apply (they protect the box's disk); the free room where you write does,
  against `MIN_FREE_DISK_BYTES`. What you write outside the box is yours to look after: the notice your guests read no longer covers it.
- **During an offboarding the client's members can export** (`album.zip`), for the whole grace period. A client suspended for an abuse
  cannot, and an event you took down never can: cut an abuse by taking the event down.

## On the night

1. **Create the event** in `/admin` — a name is enough.
   Add photo missions here too, if you want them.
2. **Print the QR code** from the event page and put it on the tables.
3. **Open it to guests** when the evening starts, with **Open to guests** on the event
   page, or give it an opening time in its settings. Until then it is a draft: the QR
   code lets nobody in and there is no wall to show.
4. **Open the wall** on the projector: the display page, fullscreen. It needs no
   keyboard after that.
   If you turned on the [wall sound](#a-sound-for-each-new-photo), click the speaker icon on the
   wall (or press `S`) once: browsers refuse to play a sound on a page nobody has touched.
5. **Keep the moderation queue open** on your laptop or phone. New photos arrive by
   themselves; `J`/`K` to move, `P` to publish, `R` to refuse, `Z` to undo.
6. **The morning after**, make the [shared gallery](#shared-gallery) link on the event
   page and send it to your guests. Your own copy of the album, with the photos you took
   off the wall, is **Download the album** on the same page.

Three settings worth a thought before you start:

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
  own cron; with Docker it goes in your `.env`, which `compose.yaml` passes to the
  container. The purge command does the whole sweep, not only the purge: it also ends the
  offboarding of clients whose albums are gone and prunes the audit log of a box run for
  other people (`SITE_ADMIN=on`), so a cron running it loses nothing the timer did.
  A purge that is cut after an album's row was deleted (a restart, a full disk) is not listed
  again, since its row is gone: its files are collected by the media reconciliation once they are
  15 minutes old. The purge command runs that reconciliation on every run, even with nothing due,
  so on a box with the timer off (or a `MEDIA_ROOT` too shared to sweep: the command then says it
  does not reconcile either) run it again after a failure and the bytes go too.
  `--dry-run` also works on a database whose event-name index the server has not yet filled
  since an upgrade (it never writes).
  `--dry-run` opens the database read-only, and a `DATABASE_PATH` that does not exist is
  refused rather than created. Each album it lists ends with `archive=…`, the word the real run will
  log (see [Before an album is deleted](#before-an-album-is-deleted)): an album listed `archive=none`
  or `archive=sealed` would go without the host having taken an archive of it.
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

## Guests saving photographs

A guest can keep a photograph from the feed on their own phone, one at a time (the host's
**Les invités peuvent enregistrer les photos de la soirée** setting). What the box serves is the
`display` rendition, about 2560 px at most and **never the original**. **No variable to set**:
the limits are constants, and the box keeps nothing of who saved what.

**Bandwidth at the end of the evening is the cost to watch.** Everybody wants their photographs at
the same moment, from one Wi-Fi. Three bounds protect the machine (they are listed in
[SECURITY.md](SECURITY.md#5-rate-limits-and-quotas) and in API.md): 40 saves a minute per guest, 600 a
minute per client address and event, and **two saves open at once per guest with 64 for the whole box**.
A refusal answers `429` or `503` with `Retry-After: 30`, and the guest's phone says so and does not retry
by itself.

**What was measured, and what was not.** Measured on 17/11/2026, on a developer PC (loopback, one Node
process, the demo album's three published photographs, 183 KB on average because the demo album is
synthetic and **not representative of a phone's photographs**): 64 saves open at once were all served, at
about 155 to 175 MB/s in a burst of 70 ms, which says only that the application is not the limit.
200 saves open at once (100 guests, two each) served 64 and answered **503 to the other 136**: the box
ceiling of 64 does what it says, and on a real evening it counts downloads that last seconds on a venue's
Wi-Fi, not 160 ms on loopback, so it will refuse sooner than this figure suggests.
**Not measured**: the weight of a real phone's `display` file (the spec guesses 0.6 to 1.5 MB), the
outgoing bandwidth the hosted offer guarantees (it is not in this repository), and the traffic of a real
evening. Treat 64 as a starting value. To measure on your own box: open the event with a few real photographs,
watch the machine's outgoing traffic (`ssh <box>` then `nload` or the provider's graph) while several phones
save at once, and raise or lower `SAVES_OPEN_TOTAL` in `src/interface/http/middleware/rateLimit.ts` from what the link
sustains. The figure that matters is how many full-size downloads your uplink carries at once without
the wall's own stream stalling.

## Voice messages

A guest can leave a recorded message in the guestbook (the host's **Messages vocaux** setting; the
**Mariage** template turns it on). What the box does with it is in [API.md](API.md) and
[SECURITY.md](SECURITY.md); what you operate is this.

**Variables, all optional.** `GUESTBOOK_VOICE_ENABLED` (`true`; `false` turns voice off for the whole box, read at
boot), `MAX_VOICE_SECONDS` (60, from 10 to 180) and `MAX_VOICE_BYTES` (4 000 000 per upload). A recording is
re-encoded to AAC mono in an MP4 by the same `ffmpeg` as the clips, whatever the phone sent: **a box with no
`ffmpeg` offers no voice message** and nothing else changes.

**It needs https.** A browser gives a web page a microphone only on an https address (or `localhost`). A box
reached by plain `http://192.168...` on the venue's network has no microphone: the button is absent, and the
settings page says why. Fix the address ([INSTALL.md](INSTALL.md)), not the browser. If your proxy sets
`Permissions-Policy` itself, let the application's header through: the guest's pages need
`microphone=(self)`.

**The microphone.** It runs only while a guest records, and stops at the end, when the page is left and at the
maximum length. The wall, the console and the API are forbidden it by the same header. A guest who refused it
once sees how to allow it again in their browser's settings; nothing here can do that for them.

**Offline.** A recording made with no signal stays on the phone, in its own queue (a database of its own, apart from
the photographs'), and is sent by the page itself when the network is back: **the page has to be open**, which is why
the guest is told to keep it open. Safari on iPhone has no background sync to do better. A recording the event
refuses for a reason that may pass (voice switched off, the guestbook full, uploads paused) is kept on the phone, with
a way to save it; it is only dropped when its content is refused.

**Listening, secrecy, archive.** Only the host and the moderators hear a message, in the console, one at a time. With
the secret on ("Garder les messages vocaux secrets jusqu'à la fin de la soirée"), nobody hears them (the owner included)
until the evening is closed or the owner presses **Ouvrir maintenant**, and the archive leaves them out until then. The
ZIP carries each message as `voice/NNNN-<digest>.m4a`, listed in `MANIFEST.sha256` and in `guestbook.txt`. Erasing a
guest's contribution, the host's removal and the purge delete the files first. Before a purge, the deletion band says how
many recordings the host would lose, and **Garder les N messages en attente** publishes the ones nobody decided.

**Cost.** Transcoding a minute of audio is cheap next to a clip, and the worker takes one voice and one clip in turn so a
burst of voices does not delay a video. The figure on a small VPS has not been measured yet; do it on your box before a
big wedding (record a minute, watch the load while it transcodes).

## Guests' replies

A host can ask the guests "Serez-vous là ?" on the invitation's page (the **Réponses des invités** panel of the
Invitations page), and reads the answers on the **Réponses** page of the event. What the box does with them is in
[API.md](API.md) and [SECURITY.md](SECURITY.md); what you operate is this.

**Nothing to install, one optional variable.** `GUEST_RSVP_RATE_LIMIT_PER_MINUTE` (30, from 1 to 6000) is what one
address may write per minute; a second bucket of 300 a minute per invitation is fixed. Raise the first only if many guests
answer from one address (a venue's Wi-Fi behind one connection), and say so to the host: the limit is per address.
The reply is the only public write nobody is signed in for, so the body is capped at 8 KB and a guest keeps a private
token (stored only as its SHA-256): a reply is reached by that link and by nothing else.

**What is kept, and for how long.** A reply holds a name, a number of people and, if the host asks, a diet or an
allergy (health data, read by the owner alone, never in a log, an audit line or an export of the album). The retention
sweep erases the replies **30 days after the event closed or 60 days after the invitation's start, whichever comes
first**, whatever the purge hold says: they are names and diets, not an album. The page says the day beside the list.
Tell the host to export them first: the spreadsheet (**Exporter**, a CSV with a BOM and `;`, which Excel and LibreOffice
open directly) is the only copy that outlives the sweep.

**Live, and the badge.** The host's page re-reads the list on each `rsvp.changed` signal of the moderation stream (a
signal with no content); the badge on the **Réponses** entry counts the replies written or changed since the host last
looked, and is cleared by opening the page. The page also re-reads when the tab comes back into view and
when the stream reconnects, so a dropped connection costs a few seconds, not a reply.

**No e-mail to guests, ever.** A reply sends none, and the box never writes to a guest (ADR 0017): no address of a guest enters EventSlide. What a host may be told by e-mail, **on a box with a working relay** (`SMTP_URL` and `MAIL_FROM`) and unless `HOST_MAIL_NOTICES=off`, is figures only, to the **active owners** of the event (ADR 0019, spec 32):

- **before the replies are erased**, 7 days and 1 day before (the list is to be downloaded by the day before at the latest): always sent, no switch, like the warning before a purge;
- **a daily summary**, if an owner ticked it for this event on the Réponses page: at most one a day, from 09:00 in the invitation's zone, only when there is something new since their last visit or summary;
- **three days before the deadline** while households of the guest list have not answered, **once the deadline stopped the replies** (the summary, with the menus and the number of diets), and **when every place is taken** (once per capacity value).

None of these mails carries the name of a guest, a diet, a word or a photograph: the number of replies, the host's own menu labels, the event's name and one link. The reminder, the summary after the deadline and the "full" notice follow the **account's** "replies" switch (and the daily summary needs both its tick and that switch); outside 08:00 to 21:00 in the invitation's zone (Europe/Paris without one) a notice waits for the next pass. `MAIL_FOLLOWUP_MAX_PER_DAY` bounds how many follow-up mails the box sends a day. The badge and the open page remain the notice for everything else.

### Mail about the life of an event

On a box with a working relay and unless `HOST_MAIL_NOTICES=off`, the **active owners** of an event are also told (spec 32, the account's "events" switch turns each off):

- **a long job is over**: the archive, the photo book or the highlight film is ready or could not be made, **only if it took more than two minutes** (a host who watched it finish needs no mail). The archive goes to the owner who asked for it while they still own the event, else to every owner. It leaves at once and is noted under `<job>@<time asked>`, so a job put back in the queue at boot and finished twice sends one mail. **It is not retried**: a day whose `MAIL_FOLLOWUP_MAX_PER_DAY` is full, or a race lost to another process, drops it, and the log says `a job notice was not sent` with the job and the reason (`budget` or `lost`); the page still shows the result;
- **after the party**: 12 hours after the event's closing (by the host, a schedule or the space's window; an event reopened before then counts from its new closing) and until 48 hours after, **once per event**, with the number of photographs, videos and guestbook messages **published** and the day the album will be deleted. An evening with nothing published is noted without a mail, and nothing is sent once the album's deletion date has passed;
- **the wall closes within 24 hours**: the end of the space's opening time (`max_live_days`, only for an event of a client), unless a closing the host scheduled falls before it. The day is read in the invitation's zone (UTC without one);
- **an invitation was accepted**: the account that wrote the invitation to moderate is told who accepted (the name they gave, else the address typed), at once and without a ledger (the acceptance is its own guard). One place in the day's budget: a day that is full drops it.

The two sweep notices (after the party, the wall closes) follow the same order as every notice: no mail outside 08:00 to 21:00 in the invitation's zone, noted before sent, held back by `MAIL_FOLLOWUP_MAX_PER_DAY` and sent on the next pass while still worth sending. Without a relay nothing is sent and nothing is noted.

## Mail to the hosts

One page for everything the box writes to a host (spec 32, [ADR 0019](adr/0019-host-mail-notices.md)). **Nothing is written without a working relay** (`SMTP_URL` and `MAIL_FROM`): the box then sends **and notes** nothing, so configuring one later does not find a notice skipped. **Never to a guest**, and never a guest's name, diet, word or photograph: only figures, the event's name and the host's own words.

| Mail                                                                                               | When                                                                                                                                            | To                                                                                                                         | Switch                 |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Security of the account (password, second factor, recovery codes, disabled or enabled, deleted)    | right after the act                                                                                                                             | the account                                                                                                                | none                   |
| Replies about to be erased                                                                         | 7 days and 1 day before, for an event that holds at least one reply                                                                             | active owners                                                                                                              | none                   |
| Reminder, summary after the deadline, "full"                                                       | 3 days before the deadline while households of the guest list have not answered; once the deadline stopped the replies; when the places run out | active owners                                                                                                              | "replies"              |
| Daily summary of the replies                                                                       | at most one a day, from 09:00                                                                                                                   | owners who ticked it for the event                                                                                         | "replies" and the tick |
| Archive, book or film ready or failed                                                              | when it took more than 2 minutes                                                                                                                | the requester (archive) or the owners                                                                                      | "events"               |
| After the party                                                                                    | 12 h to 48 h after the closing, once                                                                                                            | owners                                                                                                                     | "events"               |
| The wall closes                                                                                    | within 24 h of the end of the space's opening time                                                                                              | owners                                                                                                                     | "events"               |
| Invitation accepted                                                                                | at once                                                                                                                                         | who wrote it, if still an owner                                                                                            | "events"               |
| An operator's act on the account: a removal, a suspension, a resumption, the end of an engagement  | at once, when the operator left "Prévenir l'hôte" ticked                                                                                        | the event's active owners (a removal), the client's active owners and contact address (a client act), one mail per address | none                   |
| An announcement the operator wrote (a change of terms, of a sub-processor, the end of the service) | by batches, from the next pass of the sweep, spread over the days when the day's ceiling is full                                                | the active owners of at least one client, once each                                                                        | none                   |

**When the operator acts** (a photograph, a message or an event taken down, a client suspended, resumed or put on the way out) the console's dialog carries **"Prévenir l'hôte"**, ticked, and **"Motif pour l'hôte"** (500 characters at most, a field of its own: the log's reason is never shown to the host). The mail names the event (the space for a client act) and the day, gives the reason, says how to contest it and carries **no link and nothing of a guest or of the removed content**; the operator's contact address (`OPERATOR_CONTACT_EMAIL`) is its `Reply-To`. It is not stopped by `HOST_MAIL_NOTICES=off`, nor refused by the day's ceiling (it is counted). **Untick the box when the host must not be told**: a report that may concern the host themselves is the case the runbook `retrait-sans-visualisation.md` names, and it is the operator's call, act by act. Putting a take-down back and holding a purge tell nobody.

**Announcements** (the console's "Annonces" page, `/admin/site/announcements`): the operator writes a subject, a text and an optional https link **in the language they choose, nothing is translated**, sees the preview and **how many accounts it will reach**, confirms (and confirms themselves), and the mails go out **by batches of 100 per pass** of the retention sweep, **within `MAIL_FOLLOWUP_MAX_PER_DAY`** (every mail takes its place before it is sent: a day that is full stops the pass and the rest goes tomorrow, nothing is lost). One mail per account, never an address in copy, `Reply-To` `OPERATOR_CONTACT_EMAIL`; `HOST_MAIL_NOTICES=off` does not stop it (it is the operator's own words, not a family a host switches). A restart resumes where it stopped and **no account is written to twice**; a mail the relay refuses is logged (`a host announcement was not sent`) and not retried. The page shows how far each announcement has gone (a count of accounts). **Needs a relay** (`409` without one). **Kept**: the record of who was reached **30 days after the end**, the text **365 days** after it was written, both erased by the retention sweep (or `npm run purge`); the log line is a number.

**Settings** (read and checked at boot, a malformed value refuses the boot): `HOST_MAIL_NOTICES` (`on` by default, `off` stops every switchable mail for the whole box, the security mails and the warning before the replies are erased go on) and `MAIL_FOLLOWUP_MAX_PER_DAY` (`off` by default, or 1 to 100000 mails per UTC day).

**Quiet hours.** The sweep's mails (the warning, the reminders, the summaries, after the party, the wall closes) leave only between **08:00 and 21:00 in the invitation's zone** (`Europe/Paris` without one); outside it they wait for the next pass and are not noted. The mails that answer an act (security, a finished job, an accepted invitation) leave at once.

**Volume.** A host typically receives a handful of mails per event: two warnings, up to three about the replies, one summary per day with news, one after the party, one or two about jobs. `MAIL_FOLLOWUP_MAX_PER_DAY` counts **every** mail against your relay's free quota but only the follow-up mails wait when it is reached; the sweep sends them on a later pass while they are still worth sending, and **a job mail or an accepted-invitation mail** that finds the day full is dropped (the log says `a job notice was not sent` or `an invitation notice was not sent`).

**What is kept.** Only the ledger that says which notice was served for an event (`event_mail_notices`, no personal data, it goes with its event) and the daily counts (7 days, erased by the retention sweep). Nothing of a mail is stored. A relay that refuses a message is logged by its code and never retried; the page keeps the information. `npm run purge` runs the same sweeps as the timer, so a box with `RETENTION_SWEEP_INTERVAL_MINUTES=off` still sends them from its cron.

## Self-service signup

By default nobody can create an account: an operator invites each one from the console. With `SIGNUP` set, a visitor asks for
one at `/signup` (the sign-in page links to it) and the box does the rest. The hosted instance chose mode `open` and switches it on after the 3.19 upgrade.
The decision and its reasoning are in [ADR 0018](adr/0018-self-service-signup.md); the settings are in `.env.example` and
[UPGRADING.md](UPGRADING.md#upgrading-to-319).

**What it needs.** `SITE_ADMIN=on` (the operator console) and a working mail relay (`SMTP_URL` and `MAIL_FROM`): the address is
proved by a link sent to it, so with no relay the boot is refused (exit 78), every missing piece named. For the welcome mail
below also set `OPERATOR_NAME`, `OPERATOR_CONTACT_EMAIL` and `SUPPORT_URL`. Your reverse proxy must pass `/signup` and
`/api/signup` through and not log `/signup/confirm/*`.

**The three modes** (`SIGNUP`):

| Mode     | What happens once the visitor has confirmed their address                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`    | The default. Nothing is offered; the routes answer 404 and the sign-in page has no link.                                                                                    |
| `open`   | The space opens at once and the invitation (the usual one: the person chooses a name and a password) follows by mail. Only the ceilings and the disk guard protect the box. |
| `review` | The request waits in **Signups** in the operator console. Nothing opens before an operator approves it.                                                                     |

**What the visitor does.** They give an address, the name of their space, and optionally the occasion and a date. They always get
the same "check your inbox" answer, whether or not the address already has an account (the form is not a way to find out who is
registered), and the mail is the same too. The link is valid 24 hours and **confirms only when its button is pressed**, so a mail
scanner that opens it confirms nothing. Past `SIGNUP_MAX_PER_DAY` confirmation mails for the whole box (50 by default) the form
says to come back tomorrow. That daily ceiling is the box's own and has nothing to do with the per-client ceilings (events,
photos, storage) the approval dialog sets. `SIGNUP_RATE_LIMIT_PER_HOUR` (10) bounds one IP, and an address gets three mails a day at most.

**Asking twice.** The answer is always the same, but not every ask sends a mail. A person who asks again before confirming gets
a new link only once the last one is an hour old (a resend; the older link stops working). An address already waiting for a
decision, or refused less than 30 days ago, gets the usual answer and no mail at all: a refusal keeps the address quiet for 30
days. An address that already has an account is answered and mailed like any other.

**What the operator sees.** The console has a **Signups (N)** entry, N being the requests waiting for a decision (in `open`,
that is only the held ones, below). In `open` the page lists the accounts opened in the last 30 days; in `review` the
requests to approve. **Approve** opens the client with the ceilings shown in the dialog (the instance's defaults, which you may
change) and sends the invitation; **Refuse** asks whether to tell the person, with a neutral mail and no reason. Both are writes
behind the usual step-up. Each decision is one line in the audit log (`signup.approved`, `signup.refused`). The page never
shows what a client made. With `SIGNUP_NOTIFY_EMAIL` set you also get at most one mail an hour saying that requests wait (counts
only: no name, no address).

**Switching modes.** Change `SIGNUP` and restart. `open` to `review` and back needs nothing else: requests already waiting stay
in the page. `off` hides the form and the console page, keeps the requests until they expire, and the sweep still erases them.
A request that nobody decides is erased after 30 days, an unconfirmed one after 48 hours, and none is kept beyond 60 days.

### When an account opens and the invitation does not arrive

In `open` two cases leave a visitor without a usable account. Both tell the visitor "your address is confirmed, the account opens
as soon as possible" and send you the usual signup notice:

- **the relay refused the invitation mail**, or **the request could not be marked as done** after the account was opened. The box
  logs the **client id** (never the address). Open the client from the operator console (Clients) and issue the owner's invitation
  again from the client's page; the visitor then gets the usual invitation mail. A request that stays `approving` is given back
  to `pending` by the sweep after an hour: do not approve it again from the Signups page if the client already exists, or you will
  open a second account for the same address.
- **the free disk space is too low** (or cannot be read): the request waits in the Signups page, under "Held requests", like
  one in `review`; the guard is not checked again when you approve, so you decide when there is room. The box needs `MIN_FREE_DISK_BYTES` plus 5 GB for each client that still has an
  event or was created in the last 30 days, plus 5 GB for the newcomer.

### Welcome mail

With `SIGNUP=review` or `open`, the first owner of a space that has no member and no event yet receives one welcome mail after
accepting their invitation, in the space's language. It names `OPERATOR_CONTACT_EMAIL` as the contact and reply address and links
`SUPPORT_URL`; if either is unset, or the box has no mail relay, nothing is sent and the boot logs a warning naming what is missing.
A failed send never blocks the acceptance. With `SIGNUP=off` nothing changes.

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

An archive must not overlap the installation it saves or replaces, and neither command
lets it: `backup` refuses a `--to` (or `BACKUP_DIR`) inside the media directory, around it,
or around the database file; `restore` refuses the same three layouts for the archive it
is given, before it writes anything and with or without `--force`, because a restore
empties the media directory and would otherwise delete the archive it is reading from.
The comparison is on real paths, so a symlink, a Windows junction, `..` or a different
case does not get past it. The refusal names both paths; the fix is to put the archive
beside the media directory, not under it.

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
[docs/SECURITY.md §11](SECURITY.md#11-deployment-posture).

## A sound for each new photo

Off by default, for every event. The host turns it on in the event settings ("Affichage du mur", "Son": four sounds, a volume and a Test button) and the setting is the same for every wall of the event. A wall rings once when a photo or clip becomes visible on it, at most once every 5 seconds; a photo still waiting for moderation never rings.

A browser only plays a sound on a page where someone has clicked or pressed a key, so **each screen that should ring must be activated once** (the speaker icon that shows when the pointer moves, or the `S` key). A wall that reloads comes back silent until the next click or key: that is the browser, not a fault. The sound files are the four synthesised, CC0 sounds in `web/public/sounds/` (see `web/public/licenses/SOUNDS.txt`).

**Kiosk screens.** On a dedicated machine nobody touches, start Chrome with `--autoplay-policy=no-user-gesture-required` so that the wall can ring after a reload. It is a setting of that computer; EventSlide never asks for it. The first sound after a long silence may lose its start if the HDMI output goes to sleep: test on the real hardware.

## Hourly limits per account

A few things a host does from the console are limited per **account** and per **hour**, not per address, so an
office behind one connection is not throttled as one person. The counters are separate: sending invitations
never uses up the allowance for logos. They are a brake on a script, well above what anyone does by hand, and
they can be set in `.env` (each takes a whole number from 1 to 1000):

| Variable                             | Default | What it limits                                                                                 |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `EVENT_CREATION_RATE_LIMIT_PER_HOUR` | 20      | Events created.                                                                                |
| `INVITATION_RATE_LIMIT_PER_HOUR`     | 30      | Invitations sent to helpers, to any address.                                                   |
| `VENUE_PHOTO_RATE_LIMIT_PER_HOUR`    | 10      | Venue photographs uploaded.                                                                    |
| `BOOK_REQUEST_RATE_LIMIT_PER_HOUR`   | 20      | Photo-book requests, whatever the answer (the event's own limit of three a day still applies). |
| `LOGO_RATE_LIMIT_PER_HOUR`           | 10      | Event logos uploaded.                                                                          |

A host who goes past one gets a "too many requests" answer and the time to wait. Raise a limit only if a
real workflow reaches it, for example a booking office that signs in as one account for every event.
