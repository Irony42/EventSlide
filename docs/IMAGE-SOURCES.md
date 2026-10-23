# What is in the EventSlide image, and where its source is

For someone who pulls `ghcr.io/irony42/eventslide`: what the image is made of, how to get
the source code of every part of it, how to check that an image is the one this repository
published, and what to expect when a vulnerability is found in it. The page is attached to
every GitHub release, next to that release's SBOM and its list of source packages.

It states what the maintainer provides. It is not legal advice, and where it and a licence
differ, the licence wins.

## What the image is made of

One image, three kinds of content, and each has its own source.

| Part                                                   | Licence                                                 | Where it comes from                                                                                            | Where its source is                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| EventSlide (`/app/dist`)                               | AGPL-3.0-only                                           | this repository, built by the `Dockerfile`                                                                     | the tag of the release: `https://github.com/Irony42/EventSlide/tree/vX.Y.Z`, which `GET /api/about` also gives |
| npm packages (`/app/node_modules`, and the web bundle) | MIT, ISC, Apache-2.0, BSD and the like                  | `package-lock.json`                                                                                            | each package's own repository; the licence texts are in `dist/client/third-party-licenses.txt`                 |
| Node.js, and the Debian system under it                | MIT and the many licences of a distribution             | the base image `node:24-bookworm-slim`, **pinned by digest** in the `Dockerfile`                               | Debian's source packages (below)                                                                               |
| `ffmpeg`, `ffprobe` and the libraries they load        | GPL-2.0-or-later (Debian's build enables `libx264`)     | `apt-get install ffmpeg` in the runtime stage of the `Dockerfile`                                              | Debian's source packages `ffmpeg` and `x264`, among others (below)                                             |
| libvips, inside `sharp`                                | LGPL-3.0-or-later (the `@img/sharp-libvips-*` packages) | **not Debian**: the prebuilt library that `sharp` loads from the npm package `@img/sharp-libvips-linux-<arch>` | libvips, and the build scripts of that package (below)                                                         |

EventSlide runs `ffmpeg` as a separate process, and never links to it. `sharp` loads libvips
as a shared library, which is the reason its source is offered and not only named. [NOTICE](../NOTICE)
lists the main third-party components, and
[docs/LICENSING-FAQ.md](LICENSING-FAQ.md) answers what the AGPL asks of someone who runs the image.

## The written offer of source

For each image published at `ghcr.io/irony42/eventslide`, the maintainer will give anyone who
asks the complete corresponding source of the GPL and LGPL parts of it (`ffmpeg`, `x264`,
the libraries they link, libvips and the other system packages), on the terms of their
licences, for at least **three years** after that release is published. Ask by opening an issue
on [the repository](https://github.com/Irony42/EventSlide/issues) that names the release.

You do not have to wait for an answer. Everything below is published by someone else, in
places that keep old versions, and the list that says which version is in your image is
generated from the image itself.

## Getting the source of what the image carries

Each GitHub release attaches two files that describe the image **as it was pushed**:

- `image-sources-X.Y.Z.txt`: the base image the `Dockerfile` pins, the Debian and Node.js
  versions, the versions `sharp` reports for libvips and its libraries, and one line for each
  Debian **source** package in the image, with the binary packages built from it:

  ```
  ffmpeg 7:5.1.6-0+deb12u1 (ffmpeg, libavcodec59, libavformat59, ...)
  x264 2:0.164.3095+gitbaee400-3 (libx264-164)
  ```

- `eventslide-X.Y.Z.spdx.json`: the SBOM, in SPDX, written by Syft from the same image. It is
  also attached to the image, signed (below).

**A Debian package.** Take its source package name and version from the list and either ask
Debian for it, on a Debian bookworm system with a `deb-src` line in its APT sources,

```bash
apt-get source ffmpeg=7:5.1.6-0+deb12u1
```

or fetch the files from `https://snapshot.debian.org/package/ffmpeg/`, which keeps every
version Debian has published, security updates included. The version in the list is the one
installed in the image, not the newest.

**libvips.** `sharp` reports the version of libvips it carries and the versions of the libraries
inside it, and the list has them under `== libvips`; so does

```bash
docker run --rm --entrypoint node ghcr.io/irony42/eventslide:X.Y.Z \
  -e "console.log(require('sharp').versions)"
```

The source of libvips is `https://github.com/libvips/libvips`, at that version's tag. The
package that builds it for `sharp`, with the scripts and the versions of every library it
bundles, is `https://github.com/lovell/sharp-libvips`, at the tag named after the version of
`@img/sharp-libvips-linux-<arch>` in `package-lock.json`.

**The rest of the image.** `https://github.com/Irony42/EventSlide/tree/vX.Y.Z` is the source
of EventSlide and of the `Dockerfile` that built the image. The base image is named by digest on
the lines that start with `FROM node:` in the `Dockerfile` of that tag.

## Checking the signature

Every image published from `v3.0.0` on is signed with [Sigstore](https://www.sigstore.dev/)'s
`cosign`, **keyless**: there is no key to leak or to rotate. The signature says that this
repository's release workflow, running on a tag or on `main`, produced the digest, and it is
written to a public transparency log. Check the digest you run, not a tag, which can be moved:

```bash
docker pull ghcr.io/irony42/eventslide:X.Y.Z
docker inspect --format '{{ index .RepoDigests 0 }}' ghcr.io/irony42/eventslide:X.Y.Z

cosign verify \
  --certificate-identity-regexp '^https://github\.com/Irony42/EventSlide/\.github/workflows/release\.yml@refs/(tags/v.+|heads/main)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/irony42/eventslide@sha256:<the digest above>
```

`cosign verify-attestation --type spdxjson` with the same two options checks the attached SBOM
the same way. An image that was built on your own machine, with
`compose.build.yaml`, has no signature, and is not meant to.

## Where the image comes from

- It is built by [`.github/workflows/release.yml`](../.github/workflows/release.yml), when a
  tag `vX.Y.Z` is pushed, for `linux/amd64` and `linux/arm64`. Nothing else publishes it, and a
  push to `main` does not.
- Before anything is pushed the image is built on its own and put through
  [`scripts/verify-image.sh`](../scripts/verify-image.sh), the script that checks what it
  promises (the unprivileged user, the licence and the source offer, the backup and restore
  commands, the third-party notices) and scanned for vulnerabilities. After the push the
  digest is checked again with the same script before it is signed.
- It is **not** claimed to be reproducible bit for bit. What is pinned is the base image, by
  digest, so that the Debian under it is a known one; what is built on it is built again each
  time.
- The tags are written down in [docs/UPGRADING.md](UPGRADING.md#which-image-tag).

## Vulnerabilities

The image is scanned (Grype, on a Syft SBOM) when it is released, and its latest release
again every week. A critical vulnerability for which a fix exists fails the release, or opens
an issue labelled `image-scan`. What the maintainer aims for after that, and what is not
promised, is in [docs/SECURITY.md](SECURITY.md#a-critical-vulnerability-in-what-decodes-a-guests-file).
