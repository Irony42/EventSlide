#!/usr/bin/env bash
#
# Proves what the Dockerfile and compose.yaml claim, instead of asserting it.
#
# The image makes seven promises that nothing in the six test rings can reach, because
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
VOLUME="eventslide-verify-$$"
BUILD=1

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
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
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

# --------------------------------------------------------------------------- done --
printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
