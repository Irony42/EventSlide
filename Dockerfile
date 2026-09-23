# syntax=docker/dockerfile:1

# EventSlide, as one image.
#
# The install story is the product for a self-hosted tool: `docker compose up` should be
# the whole thing. A host setting up in a venue an hour before the guests arrive is not
# going to install a C++ toolchain.

# ----------------------------------------------------------------------- deps --
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# A build toolchain, in the stage that is thrown away.
#
# This said the opposite until CI built the image for the first time: "prebuilds cover
# better-sqlite3, sharp and bcrypt, so no toolchain is installed here — if a prebuild is
# ever missing the install fails loudly rather than silently pulling in gcc." It failed
# loudly, on every build, because one of them compiles from source on this base and
# `node-gyp` needs Python. Nothing had ever run `docker build`, so the promise that
# `docker compose up` is the whole install had never been true.
#
# The fear behind the old comment was bloat, and that fear is answered by the staging
# rather than by the absence: `deps` is a builder, the runtime copies only the pruned
# `node_modules` out of it, and `python3`/`make`/`g++` never reach the image a venue
# runs. `scripts/verify-image.sh` asserts that — it refuses an image carrying a
# compiler — so this cannot quietly become a fat runtime.
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

# ---------------------------------------------------------------------- build --
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# --------------------------------------------------------------------- prune --
FROM deps AS production-deps
WORKDIR /app
RUN npm prune --omit=dev

# --------------------------------------------------------------------- runtime --
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# BACKUP_DIR is where `node dist/ops/scripts/backup.js` writes when it is not given `--to`.
# The default outside the image, `./backups`, resolves against `/app` here, which is
# root's and read-only under compose, so the bare command could not write at all.
# `/data/backups` is on the data volume, which makes it **the same disk as the album**:
# somewhere to write an archive, not somewhere to keep one. The command says so when it
# runs, and the README's Backups section gives the copy that takes it off the box.
ENV NODE_ENV=production \
    PORT=4300 \
    DATABASE_PATH=/data/eventslide.sqlite \
    MEDIA_ROOT=/data/media \
    BACKUP_DIR=/data/backups

# `dumb-init` so SIGTERM reaches Node as pid 1 and the graceful shutdown actually runs:
# without it the WAL is not checkpointed and in-flight uploads are cut off.
#
# `ffmpeg` for short video clips. Distribution packages rather than a bundled build:
# `ffmpeg-static` and `ffprobe-static` are **devDependencies**, so `npm ci` alone gives a
# developer a runnable ring-3 suite on Windows and macOS while `npm prune --omit=dev`
# above keeps ninety megabytes of binaries out of this image. Debian's build carries
# libx264 and the native AAC encoder, which is exactly what the boot-time capability
# check asks for — by name, never by version.
#
# A box without it still works: the check fails, the transcoder becomes a Null Object,
# clip uploads are refused with a named code, and photos are untouched. `/api/ready`
# reports it as a detail and deliberately does not fail, because a photo wall with no
# video still serves the room.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=production-deps /app/node_modules ./node_modules
# `dist/` includes `dist/ops/`: backup, restore and purge compiled to plain JavaScript by
# tsconfig.ops.json. They are the only way to run those commands in this image, because
# `scripts/` is not copied here and `tsx` is a devDependency the prune above removed.
COPY --from=build /app/dist ./dist
COPY package.json ./

# The album and the database belong to the operator. One volume, so everything an event
# is lives under one path. That is not the same as "copy the path to back it up": a copy
# of a live SQLite file misses whatever is still in its WAL, which is why the backup
# command snapshots the database with `VACUUM INTO` instead.
#
# `0700` because docs/SECURITY.md §11 asks for it and the reason is real: the SQLite file
# holds every session row and every password hash, and the media root holds photographs
# of people who never signed up for anything. Docker copies an image's ownership and mode
# at this path into a fresh named volume, so this is what a default install gets. A bind
# mount keeps the host directory's own permissions instead — set them yourself there.
RUN mkdir -p /data/media && chown -R node:node /data && chmod 700 /data /data/media
VOLUME ["/data"]

USER node
EXPOSE 4300

# Uses the app's own readiness endpoint, which checks that the database answers and the
# media root is writable — a liveness probe that only proves the port is open would
# keep a container with a read-only disk in service.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4300)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server/main/index.js"]
