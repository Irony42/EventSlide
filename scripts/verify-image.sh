#!/usr/bin/env bash
#
# Proves what the Dockerfile and compose.yaml claim, instead of asserting it.
#
# The image makes eight promises that nothing in the six test rings can reach, because
# none of them runs Docker. They are all promises about the *artefact*, not about the
# code, so they cannot be moved down a ring: `npm run test:coverage` is green on a tree
# whose image has no ffmpeg in it, ships the Playwright browsers, or runs as root.
#
#   1. ffmpeg and ffprobe are the distribution's, present, and carry the two encoders
#      `probeFfmpegCapability` asks for by name.
#   2. The native modules that ship are the ones that were built — better-sqlite3 and
#      sharp load in the runtime image, not merely in the builder.
#   3. No devDependencies, no test suite, no Playwright browsers, and neither of the two
#      static ffmpeg packages.
#   4. An empty volume boots: the database and the media root are created on first run.
#   5. A missing secret is refused with a readable message, not a stack trace.
#   6. /api/health and /api/ready answer, and SIGTERM stops the process inside the grace
#      period compose gives it.
#   7. The process is not root, and what it writes to the volume is not owned by root.
#   8. The operator can back up, verify, purge and restore with what the image carries.
#      These are the README's Backups commands minus the `docker compose` in front, and
#      until they were compiled into `dist/ops/` none of them could run here: the image
#      has no `scripts/` and no `tsx`. So this takes a backup of the running server,
#      verifies it, purges, copies the archive off the volume, stops the server, is
#      refused by a restore without `--force`, restores with it, and boots on the result.
#
# Usage:
#   ./scripts/verify-image.sh              # build, then check
#   ./scripts/verify-image.sh --no-build   # check an image that is already built
#   IMAGE=eventslide:test ./scripts/verify-image.sh
#
# Exits non-zero on the first broken promise. Needs Docker and nothing else.

set -euo pipefail

IMAGE="${IMAGE:-eventslide:verify}"
CONTAINER="eventslide-verify-$$"
RESTORED="eventslide-verify-restored-$$"
VOLUME="eventslide-verify-$$"
BUILD=1
host_scratch=""

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

passed=0
failed=0

pass() {
  printf '  ok    %s\n' "$1"
  passed=$((passed + 1))
}

fail() {
  printf '  FAIL  %s\n' "$1" >&2
  failed=$((failed + 1))
}

section() { printf '\n== %s\n' "$1"; }

cleanup() {
  docker rm -f "$CONTAINER" "$RESTORED" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  if [ -n "$host_scratch" ]; then rm -rf "$host_scratch"; fi
}
trap cleanup EXIT

# Runs a command inside a throwaway container of the image under test. `--entrypoint`
# is overridden because the image's is dumb-init, which would swallow the exit code we
# are reading.
in_image() {
  docker run --rm --entrypoint /bin/sh "$IMAGE" -c "$1"
}

# ------------------------------------------------------------------------- build --
if [ "$BUILD" -eq 1 ]; then
  section "Building $IMAGE"
  docker build -t "$IMAGE" .
fi

# -------------------------------------------------------------- what is inside it --
section "Contents"

if in_image 'command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null'; then
  pass "ffmpeg and ffprobe are on PATH"
else
  fail "ffmpeg or ffprobe is missing — clip uploads would be refused on every box built from this image"
fi

# The same question `probeFfmpegCapability` asks, and for the same reason: a build
# without these two encoders reports a perfectly modern version and then fails at the
# first transcode. Checked by name, never by version.
# `-w` rather than a bare substring or hand-padded spaces: the listing puts the encoder
# name in a padded column, so matching " aac " would depend on that padding and matching
# `aac` alone would also accept `libfdk_aac` in a build that has no plain `aac` — which
# is the looser reading the application itself takes, and the one place being stricter
# here than the code is right, because a false pass costs a silent failure at a wedding.
if in_image 'ffmpeg -hide_banner -loglevel error -nostdin -encoders 2>/dev/null | grep -qw libx264'; then
  pass "ffmpeg has the libx264 encoder"
else
  fail "ffmpeg cannot encode H.264 — a clip would not play in a browser"
fi

if in_image 'ffmpeg -hide_banner -loglevel error -nostdin -encoders 2>/dev/null | grep -qw aac'; then
  pass "ffmpeg has the aac encoder"
else
  fail "ffmpeg cannot encode AAC audio"
fi

# The design decision recorded against roadmap 1.4: the system binaries, with the static
# packages as devDependencies only. Ninety megabytes, and the half of this promise that
# is easiest to break by accident.
for pkg in ffmpeg-static ffprobe-static; do
  if in_image "[ ! -e node_modules/$pkg ]"; then
    pass "$pkg is not in the image"
  else
    fail "$pkg shipped — npm prune --omit=dev did not run, or it is no longer a devDependency"
  fi
done

# The build toolchain belongs to the `deps` stage and must not reach the runtime.
# `deps` installs python3, make and g++ because a native dependency compiles from
# source on this base; the runtime is a fresh image that copies only the pruned
# node_modules out of it. If a future edit collapses the two stages, a venue box
# starts carrying a compiler, and this is the line that says so.
for tool in g++ gcc make python3; do
  if in_image "! command -v $tool >/dev/null 2>&1"; then
    pass "$tool is not in the runtime image"
  else
    fail "$tool shipped — the build toolchain escaped the deps stage into the runtime"
  fi
done

for pkg in typescript vitest @playwright/test eslint prettier tsx; do
  if in_image "[ ! -e node_modules/$pkg ]"; then
    pass "$pkg is not in the image"
  else
    fail "$pkg shipped — production carries a devDependency"
  fi
done

if in_image '[ ! -e tests ] && [ ! -e playwright.config.ts ]'; then
  pass "the test suite is not in the image"
else
  fail "the test suite shipped"
fi

if in_image '[ ! -d /root/.cache/ms-playwright ] && [ ! -d /home/node/.cache/ms-playwright ]'; then
  pass "no Playwright browsers in the image"
else
  fail "Playwright browsers shipped"
fi

# The classic multi-stage failure: node_modules built on one base, copied onto another,
# and the native module throws at the first request rather than at build time. Loading
# them is the only check that distinguishes the two.
if in_image 'node -e "require(\"better-sqlite3\"); require(\"sharp\"); require(\"bcrypt\")"'; then
  pass "better-sqlite3, sharp and bcrypt load in the runtime image"
else
  fail "a native module does not load in the runtime image — the builder and the runtime disagree"
fi

if in_image '[ -f dist/server/main/index.js ] && [ -f dist/client/index.html ]'; then
  pass "the server build and the web bundle are both present"
else
  fail "dist is incomplete — the image would start without a front end"
fi

# Promise 8's precondition. The devDependency check above is right to refuse `tsx`, and
# `scripts/` is not copied into the runtime stage, so these compiled files are the only
# way an operator on this image can back up, restore or purge at all.
if in_image '[ -f dist/ops/scripts/backup.js ] && [ -f dist/ops/scripts/restore.js ] && [ -f dist/ops/scripts/purge.js ]'; then
  pass "the backup, restore and purge commands are compiled into the image"
else
  fail "dist/ops/scripts is missing a command — a Docker install would have no way to back up or restore"
fi

# What they carry is their own import graph, and that graph is kept off the composition
# root on purpose: `container.ts` imports every route in the product, so a command that
# reached it would put a second, startable copy of the server under dist/ops/.
if in_image '[ ! -e dist/ops/src/main/container.js ] && [ ! -e dist/ops/src/interface ]'; then
  pass "dist/ops carries the commands, not a second copy of the server"
else
  fail "dist/ops contains the composition root — an operator command imports src/main/container.ts again"
fi

size="$(docker image inspect "$IMAGE" --format '{{.Size}}')"
printf '  info  image size: %s MB\n' "$((size / 1000000))"

# ------------------------------------------------------------------------ non-root --
section "Non-root"

uid="$(in_image 'id -u')"
if [ "$uid" != "0" ]; then
  pass "the process runs as uid $uid, not root"
else
  fail "the image runs as root — a bind-mounted media directory would fill with files the operator cannot delete"
fi

# ------------------------------------------------- refusing a misconfigured boot --
section "A misconfigured boot is refused, readably"

# No SESSION_SECRET, no GUEST_TOKEN_SECRET, NODE_ENV=production. env.ts must name both
# and exit 78 (EX_CONFIG) rather than throw. This is the first thing a first-time
# operator meets when they skip the two secrets, so it has to read like a sentence.
set +e
refusal="$(docker run --rm -e NODE_ENV=production -e PUBLIC_URL=https://example.com "$IMAGE" 2>&1)"
refusal_code=$?
set -e

if [ "$refusal_code" -eq 78 ]; then
  pass "a boot with no secrets exits 78 (EX_CONFIG)"
else
  fail "a boot with no secrets exited $refusal_code, expected 78"
fi

if printf '%s' "$refusal" | grep -q 'SESSION_SECRET is required in production' &&
  printf '%s' "$refusal" | grep -q 'GUEST_TOKEN_SECRET is required in production'; then
  pass "the refusal names both missing secrets at once"
else
  fail "the refusal did not name both secrets — an operator would fix one per restart"
fi

if printf '%s' "$refusal" | grep -qi 'at Object\.\|at Module\.\|node:internal'; then
  fail "the refusal printed a stack trace"
else
  pass "the refusal is a message, not a stack trace"
fi

# The same refusal with **no environment named at all**, which is the case the image's
# own `ENV NODE_ENV=production` hides. `-e NODE_ENV=` blanks it, so this drives the
# default in `env.ts` rather than the Dockerfile's line: a box that is never told which
# environment it is in must land on the strict one. While that default was
# `development`, this exact command booted a server signing sessions and guest tokens
# with two constants published in this repository, and said nothing.
set +e
unnamed="$(docker run --rm -e NODE_ENV= -e PUBLIC_URL=https://example.com "$IMAGE" 2>&1)"
unnamed_code=$?
set -e

if [ "$unnamed_code" -eq 78 ] &&
  printf '%s' "$unnamed" | grep -q 'SESSION_SECRET is required in production'; then
  pass "a boot that names no NODE_ENV is refused as production, not relaxed into development"
else
  fail "a boot with a blank NODE_ENV exited $unnamed_code — the strict posture is not the default"
fi

# ------------------------------------------------------------ an empty volume boots --
section "First boot on an empty volume"

docker volume create "$VOLUME" >/dev/null

# `--read-only` and the tmpfs mirror compose.yaml's hardening rather than running the
# image in an easier configuration than the one that ships. They belong here because a
# read-only root is precisely the kind of setting that is fine at build time and fails at
# the first write, and nothing else in the repository would catch it.
docker run -d --name "$CONTAINER" \
  -v "$VOLUME:/data" \
  --read-only \
  --tmpfs /tmp:size=512m,mode=1777 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -e NODE_ENV=production \
  -e PUBLIC_URL=https://example.com \
  -e SESSION_SECRET=verification-session-secret-at-least-32-chars \
  -e GUEST_TOKEN_SECRET=verification-guest-token-secret-at-least-32-c \
  "$IMAGE" >/dev/null

ready=""
for _ in $(seq 1 60); do
  # Captured through command substitution rather than a file in /tmp: the script runs on
  # a CI runner, in WSL and in Git Bash on the Windows workstation this repository is
  # developed on, and only one of those three is certain to have a writable /tmp.
  if body="$(docker exec "$CONTAINER" node -e \
    "fetch('http://127.0.0.1:4300/api/ready').then(r=>r.text()).then(t=>{console.log(t);process.exit(0)}).catch(()=>process.exit(1))" \
    2>/dev/null)"; then
    ready="$body"
    break
  fi
  sleep 1
done

if [ -n "$ready" ]; then
  pass "the container came up against an empty volume"
else
  fail "the container never became ready — logs follow"
  docker logs "$CONTAINER" 2>&1 | tail -40 >&2
fi

if printf '%s' "$ready" | grep -q '"status":"ready"'; then
  pass "/api/ready reports ready"
else
  fail "/api/ready did not report ready: $ready"
fi

if printf '%s' "$ready" | grep -q '"database":"ok"'; then
  pass "the database was created on the empty volume"
else
  fail "the database check did not pass: $ready"
fi

if printf '%s' "$ready" | grep -q '"media":"ok"'; then
  pass "the media root is present and writable"
else
  fail "the media root is not writable: $ready"
fi

# The ffmpeg promise proven through the application's own capability probe rather than
# through `command -v`: this is the boot-time check that decides whether clips are
# accepted at all, so it is the one an operator's /api/ready actually reflects.
if printf '%s' "$ready" | grep -q '"video":"ok"'; then
  pass "the app's own boot probe found a usable encoder (video: ok)"
else
  fail "the app reports video transcoding unavailable in its own image: $ready"
fi

if docker exec "$CONTAINER" node -e \
  "fetch('http://127.0.0.1:4300/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
  pass "/api/health answers"
else
  fail "/api/health does not answer"
fi

# The HEALTHCHECK in the Dockerfile is what an operator's `docker ps` reads. Checking
# the route by hand above does not prove the directive itself is wired correctly.
health_state=""
for _ in $(seq 1 60); do
  health_state="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo none)"
  [ "$health_state" = "healthy" ] && break
  sleep 2
done
if [ "$health_state" = "healthy" ]; then
  pass "the container's own HEALTHCHECK reports healthy"
else
  fail "the HEALTHCHECK never reported healthy (last state: $health_state)"
fi

# Point 7, the half that bites: files written into the volume must belong to the
# unprivileged user, or an operator bind-mounting a directory cannot delete their photos.
owner="$(docker exec "$CONTAINER" stat -c '%u' /data/eventslide.sqlite 2>/dev/null || echo unknown)"
if [ "$owner" = "$uid" ]; then
  pass "the database on the volume is owned by uid $uid"
else
  fail "the database on the volume is owned by uid $owner, expected $uid"
fi

# docs/SECURITY.md §11 asks for 0700 on the media root. The database file's own mode is
# left to the process umask and is deliberately not asserted here — see the note in that
# section.
mode="$(docker exec "$CONTAINER" stat -c '%a' /data/media 2>/dev/null || echo unknown)"
if [ "$mode" = "700" ]; then
  pass "the media root on the volume is mode 700"
else
  fail "the media root on the volume is mode $mode, expected 700"
fi

# ------------------------------------------- backing up the evening, while it runs --
section "Backup, verify and purge, beside the running server"

# `docker compose exec eventslide <command>` is `docker exec` into the service's
# container: the image's own user, the service's environment, the live volume. Each
# command below is the README's, with that prefix taken off.
ops() {
  local script="$1"
  shift
  docker exec "$CONTAINER" node "dist/ops/scripts/$script" "$@"
}

# Something for the round trip to carry, written where the media store would put it. No
# photo row names it, which a backup reports as dead weight and keeps — enough to prove
# the media half travels without driving an upload through the API.
captured="/data/media/verify-event/thumb/aa/$(printf '%064d' 0 | tr 0 a).jpg"
if ! docker exec "$CONTAINER" sh -c "mkdir -p \"\$(dirname '$captured')\" && printf captured > '$captured'"; then
  fail "could not write a media file into the running container's volume as its own user"
fi

# No arguments, because that is what an operator types first. The default is BACKUP_DIR,
# which the image sets to /data/backups: the only other writable place is a tmpfs.
set +e
backup_out="$(ops backup.js 2>&1)"
backup_code=$?
set -e
archive="$(printf '%s\n' "$backup_out" | sed -n 's/^  archive   //p' | head -n 1)"

if [ "$backup_code" -eq 0 ] && printf '%s' "$backup_out" | grep -q '^OK '; then
  pass "a backup with no arguments is written and re-read inside the running container"
else
  fail "the backup failed in the image (exit $backup_code) — output follows"
  printf '%s\n' "$backup_out" | tail -20 >&2
fi

case "$archive" in
  /data/backups/eventslide-*) pass "it landed in BACKUP_DIR, on the data volume: $archive" ;;
  *) fail "the archive is not under /data/backups: '$archive'" ;;
esac

# The default is on the same disk as the album, and the command must say so rather than
# let an "OK" reassure anybody.
if printf '%s' "$backup_out" | grep -q 'same filesystem as the database it was taken from'; then
  pass "it says the archive shares the album's disk"
else
  fail "a backup on the data volume did not say it shares the album's disk"
fi

# The follow-up it prints must be a command this image has. `npm run restore` is not.
if printf '%s' "$backup_out" | grep -qF "node dist/ops/scripts/restore.js $archive" &&
  ! printf '%s' "$backup_out" | grep -q 'npm run'; then
  pass "the restore it prints is the one the image can run, not an npm script"
else
  fail "the backup's output names a command the image does not have"
fi

archive_owner="$(docker exec "$CONTAINER" stat -c '%u' "$archive/database.sqlite" 2>/dev/null || echo unknown)"
if [ "$archive_owner" = "$uid" ]; then
  pass "the archive belongs to uid $uid, like everything else on the volume"
else
  fail "the archive is owned by uid $archive_owner, expected $uid"
fi

# The other half of the same-disk warning, which needs a second filesystem: /tmp is the
# container's tmpfs. Not a place to keep a backup — it is gone at the next restart.
set +e
elsewhere_out="$(ops backup.js --to /tmp/verify-other-filesystem 2>&1)"
elsewhere_code=$?
set -e
if [ "$elsewhere_code" -eq 0 ] && ! printf '%s' "$elsewhere_out" | grep -q 'same filesystem'; then
  pass "an archive on another filesystem is not said to share the album's disk"
else
  fail "a backup to the tmpfs exited $elsewhere_code or claimed to share the database's disk"
fi
docker exec "$CONTAINER" rm -rf /tmp/verify-other-filesystem || true

set +e
verify_out="$(ops backup.js --verify "$archive" 2>&1)"
verify_code=$?
set -e
if [ "$verify_code" -eq 0 ] && printf '%s' "$verify_out" | grep -q 'with full checksums'; then
  pass "backup --verify checks every byte of the archive in the image"
else
  fail "backup --verify failed in the image (exit $verify_code)"
  printf '%s\n' "$verify_out" | tail -20 >&2
fi

# Retention, on demand. Nothing is due on a fresh volume, so this proves the command runs
# in the image and a dry run touches nothing; what it deletes is ring 2's business.
set +e
purge_dry_out="$(ops purge.js --dry-run 2>&1)"
purge_dry_code=$?
set -e
if [ "$purge_dry_code" -eq 0 ] && printf '%s' "$purge_dry_out" | grep -q 'Nothing is due for purge' &&
  docker exec "$CONTAINER" test -f "$captured"; then
  pass "purge --dry-run runs in the image and leaves the media alone"
else
  fail "purge --dry-run failed in the image (exit $purge_dry_code)"
  printf '%s\n' "$purge_dry_out" | tail -20 >&2
fi

set +e
purge_out="$(ops purge.js 2>&1)"
purge_code=$?
set -e
if [ "$purge_code" -eq 0 ] && printf '%s' "$purge_out" | grep -q '^Reconciled '; then
  pass "purge runs in the image, reconciliation sweep included"
else
  fail "purge failed in the image (exit $purge_code)"
  printf '%s\n' "$purge_out" | tail -20 >&2
fi

# A restore beside the live server is the race the README tells an operator not to run.
# The dry run is harmless and must still read the archive — and must say, from the WAL
# the server holds open, that a server is running.
set +e
live_dry_out="$(ops restore.js "$archive" --dry-run 2>&1)"
live_dry_code=$?
set -e
if [ "$live_dry_code" -eq 0 ] && printf '%s' "$live_dry_out" | grep -q 'the archive is intact'; then
  pass "restore --dry-run reads the archive in the image"
else
  fail "restore --dry-run could not read the archive in the image (exit $live_dry_code)"
  printf '%s\n' "$live_dry_out" | tail -20 >&2
fi
if printf '%s' "$live_dry_out" | grep -q 'A server is probably still running'; then
  pass "run beside the live server, the restore says a server is still running"
else
  fail "a restore beside the live server did not warn that one is running"
fi

# Off the volume: `docker compose cp` is `docker cp`, and it has to reach the archive,
# which it can because BACKUP_DIR is on the volume and not on the container's tmpfs.
host_scratch="$(mktemp -d)"
host_copy="$host_scratch/archive"
if docker cp "$CONTAINER:$archive" "$host_copy" >/dev/null && [ -f "$host_copy/manifest.json" ] &&
  [ -f "$host_copy/database.sqlite" ] && [ -d "$host_copy/media" ]; then
  pass "docker cp takes the archive off the volume"
else
  fail "docker cp could not copy $archive off the volume"
fi

# ------------------------------------------------------------------------ shutdown --
section "Shutdown"

# compose.yaml gives this 20s, because index.ts's backstop is at 15s. Docker's own
# default is 10s, which would SIGKILL the process before that backstop can run — the
# case this timing exists to check.
start="$(date +%s)"
docker stop --time 20 "$CONTAINER" >/dev/null
elapsed=$(($(date +%s) - start))

exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER")"
if [ "$exit_code" = "0" ]; then
  pass "SIGTERM produced a clean exit (code 0) in ${elapsed}s"
else
  fail "SIGTERM produced exit code $exit_code after ${elapsed}s — dumb-init may not be forwarding it"
fi

if [ "$elapsed" -lt 20 ]; then
  pass "the process exited inside the stop grace period"
else
  fail "the process had to be killed — it did not stop on its own"
fi

if docker logs "$CONTAINER" 2>&1 | grep -q 'shutdown complete'; then
  pass "the shutdown ran to completion (WAL checkpointed)"
else
  fail "'shutdown complete' was never logged — the database may not have been checkpointed"
fi

# ------------------------------------------------ restoring, with the server stopped --
section "Restore, with the server stopped"

# `docker compose stop eventslide`, then `docker compose run --rm eventslide <command>`:
# a one-off container of the same image, on the same volume, with the same hardening and
# the image's own entrypoint — so an exit code here has come through dumb-init, as the
# operator's will — and nothing else holding the database open. `docker compose run`
# publishes no ports and drops the restart policy, which is why it is the documented way
# to run a command against a stopped service. The extra mount is the archive copied off
# the box a moment ago, read-only, as the README mounts one coming back from a USB stick.
one_off() {
  docker run --rm \
    -v "$VOLUME:/data" \
    -v "$host_copy:/restore:ro" \
    --read-only \
    --tmpfs /tmp:size=512m,mode=1777 \
    --security-opt no-new-privileges:true \
    --cap-drop ALL \
    -e NODE_ENV=production \
    -e PUBLIC_URL=https://example.com \
    -e SESSION_SECRET=verification-session-secret-at-least-32-chars \
    -e GUEST_TOKEN_SECRET=verification-guest-token-secret-at-least-32-c \
    "$IMAGE" "$@"
}

# The clean shutdown above checkpointed the WAL and removed it, so the procedure the
# README gives — stop, then run — reaches a target with no live journal beside it.
set +e
stopped_dry_out="$(one_off node dist/ops/scripts/restore.js /restore --dry-run 2>&1)"
stopped_dry_code=$?
set -e
if [ "$stopped_dry_code" -eq 0 ] && printf '%s' "$stopped_dry_out" | grep -q 'the archive is intact' &&
  printf '%s' "$stopped_dry_out" | grep -q 'the real run needs --force'; then
  pass "a copy brought back read-only verifies, and the dry run says the real one needs --force"
else
  fail "the dry run from the copied archive failed (exit $stopped_dry_code) — output follows"
  printf '%s\n' "$stopped_dry_out" | tail -20 >&2
fi
if printf '%s' "$stopped_dry_out" | grep -q -- '-wal or -shm is present'; then
  fail "a journal is still beside the database after a clean stop — the restore would race it"
else
  pass "after the stop, no journal is left for a restore to race"
fi

# The evening moves on after the backup, so that a restore has something to undo: the
# file it captured goes, and one it never saw arrives.
later="/data/media/verify-event/thumb/bb/$(printf '%064d' 0 | tr 0 b).jpg"
if ! one_off sh -c "rm '$captured' && mkdir -p \"\$(dirname '$later')\" && printf later > '$later'"; then
  fail "could not change the stopped volume as the image's user"
fi

set +e
refused_out="$(one_off node dist/ops/scripts/restore.js /restore 2>&1)"
refused_code=$?
set -e
if [ "$refused_code" -eq 1 ] &&
  printf '%s' "$refused_out" | grep -q 'Refusing to overwrite an existing installation' &&
  one_off test -f "$later"; then
  pass "a restore without --force refuses the occupied volume, exits 1 and touches nothing"
else
  fail "a restore without --force exited $refused_code or changed the volume — output follows"
  printf '%s\n' "$refused_out" | tail -20 >&2
fi

set +e
forced_out="$(one_off node dist/ops/scripts/restore.js /restore --force 2>&1)"
forced_code=$?
set -e
if [ "$forced_code" -eq 0 ] && printf '%s' "$forced_out" | grep -q '^Restored'; then
  pass "a restore with --force completes in the image"
else
  fail "a restore with --force failed in the image (exit $forced_code) — output follows"
  printf '%s\n' "$forced_out" | tail -20 >&2
fi

# Back to the moment of the backup, not a merge of the two.
if [ "$(one_off cat "$captured" 2>/dev/null)" = "captured" ] && ! one_off test -e "$later"; then
  pass "the restore put back what the backup captured and removed what came after"
else
  fail "the volume after the restore is not the one the backup captured"
fi

# What a restore writes, the server has to be able to open and write. It runs as the
# image's user, so both halves belong to that user, and the media root keeps the mode
# the Dockerfile gave it instead of taking the umask's.
restored_db_owner="$(one_off stat -c '%u' /data/eventslide.sqlite 2>/dev/null || echo unknown)"
restored_media_owner="$(one_off stat -c '%u' "$captured" 2>/dev/null || echo unknown)"
if [ "$restored_db_owner" = "$uid" ] && [ "$restored_media_owner" = "$uid" ]; then
  pass "the restored database and media belong to uid $uid, the server's user"
else
  fail "the restore left files owned by uid $restored_db_owner (database) and $restored_media_owner (media), expected $uid"
fi

restored_mode="$(one_off stat -c '%a' /data/media 2>/dev/null || echo unknown)"
if [ "$restored_mode" = "700" ]; then
  pass "the media root is still mode 700 after the restore"
else
  fail "the restore left the media root at mode $restored_mode, expected 700"
fi

# And the proof that it is a backup rather than a hope: the server comes up on it.
docker run -d --name "$RESTORED" \
  -v "$VOLUME:/data" \
  --read-only \
  --tmpfs /tmp:size=512m,mode=1777 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -e NODE_ENV=production \
  -e PUBLIC_URL=https://example.com \
  -e SESSION_SECRET=verification-session-secret-at-least-32-chars \
  -e GUEST_TOKEN_SECRET=verification-guest-token-secret-at-least-32-c \
  "$IMAGE" >/dev/null

restored_ready=""
for _ in $(seq 1 60); do
  if body="$(docker exec "$RESTORED" node -e \
    "fetch('http://127.0.0.1:4300/api/ready').then(r=>r.text()).then(t=>{console.log(t);process.exit(0)}).catch(()=>process.exit(1))" \
    2>/dev/null)"; then
    restored_ready="$body"
    break
  fi
  sleep 1
done

if printf '%s' "$restored_ready" | grep -q '"status":"ready"' &&
  printf '%s' "$restored_ready" | grep -q '"database":"ok"' &&
  printf '%s' "$restored_ready" | grep -q '"media":"ok"'; then
  pass "the server boots on the restored volume and reports it ready"
else
  fail "the server did not come up on the restored volume: $restored_ready"
  docker logs "$RESTORED" 2>&1 | tail -40 >&2
fi
docker stop --time 20 "$RESTORED" >/dev/null

# --------------------------------------------------------------------------- done --
printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
