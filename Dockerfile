# syntax=docker/dockerfile:1

# EventSlide, as one image.
#
# The install story is the product for a self-hosted tool: `docker compose up` should be
# the whole thing. A host setting up in a venue an hour before the guests arrive is not
# going to install a C++ toolchain.

# ----------------------------------------------------------------------- deps --
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Native prebuilds cover better-sqlite3, sharp and bcrypt on linux/amd64 and
# linux/arm64 (which is what a Raspberry Pi wall needs), so no build toolchain is
# installed here. If a prebuild is ever missing the install fails loudly rather than
# silently pulling in gcc.
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
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4300 \
    DATABASE_PATH=/data/eventslide.sqlite \
    MEDIA_ROOT=/data/media

# `dumb-init` so SIGTERM reaches Node as pid 1 and the graceful shutdown actually runs:
# without it the WAL is not checkpointed and in-flight uploads are cut off.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The album and the database belong to the operator. One volume, so a backup is one
# path and a host can copy the whole event to a USB stick.
RUN mkdir -p /data/media && chown -R node:node /data
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
