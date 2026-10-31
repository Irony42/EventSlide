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

## On the night

1. **Create the event** in `/admin` — a name is enough.
   Add photo missions here too, if you want them.
2. **Print the QR code** from the event page and put it on the tables.
3. **Open it to guests** when the evening starts, with **Open to guests** on the event
   page, or give it an opening time in its settings. Until then it is a draft: the QR
   code lets nobody in and there is no wall to show.
4. **Open the wall** on the projector: the display page, fullscreen. It needs no
   keyboard after that.
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
  container. The audit log of a box run for other people (`SITE_ADMIN=on`) is pruned only by
  the in-process sweep, so turning it off also stops that.
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
[docs/SECURITY.md §11](SECURITY.md#11-deployment-posture).
