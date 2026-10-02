# Licensing FAQ for people who run EventSlide

This page is for someone who installs EventSlide on their own machine, or on a server they
rent, and wants to know what its licence asks of them. It is a plain reading of the licence,
not legal advice: where it and [LICENSE](../LICENSE) differ, the licence text wins. It is about
the licence only.

## The short version

| You...                                                              | The AGPL asks of you                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| run a build of a tagged release, or of an unchanged upstream commit | Nothing that the GPL did not already ask. No notice, no registration, no publishing.              |
| modify it, and other people use your version over a network         | Offer those users the source of your version, under the same licence. Set `SOURCE_CODE_URL`.      |
| fork it                                                             | The same as a modified version, and your fork stays AGPL-3.0-only.                                |
| are still on code from before the relicence                         | That code stays GPL-3.0, for good. See [which versions](#which-versions-are-under-which-licence). |

## What changed, and what did not

EventSlide is now licensed under the GNU Affero General Public License, version 3 only
(**AGPL-3.0-only**), and `v3.0.0` is the first release under the AGPL. Before, it was GPL-3.0.
`v2.1.0` is the last release under the GPL-3.0, and the tag `gpl-final` marks the last GPL-3.0 commit.
"Only" means there is no "or any later version": a later version of the AGPL does not apply to
EventSlide unless the project adopts it on purpose.

The AGPL is the GPL plus one clause, **section 13**, "Remote Network Interaction". The GPL asks
you to pass on the source when you _give a copy_ of a modified program to someone. Section 13
asks the same when you _run_ a modified program and let other people use it over a network,
because in that case nobody ever receives a copy.

What did not change:

- The product. The licence change removes nothing from EventSlide and switches nothing off.
- What you may do. Run it, read it, change it, pass it on, and use it for money: the licence
  has no restriction on commercial use.
- What the GPL already asked when you hand a copy to someone else: pass on the licence and the
  source.
- Your data. The licence covers the software and not what goes through it. Your event photos,
  captions, guest names, database and `.env` are yours, and none of them is "source code" you
  would ever have to publish.

What is new for everyone, whatever they run: guests and hosts see a small "Source code
(AGPL-3.0)" link in the footer of the guest and host screens, in the language of the interface.
EventSlide has no setting that hides it.

## I run it unmodified

Unmodified means a build of a tagged release, or of an unchanged upstream commit. You owe
nothing: section 13 only applies to a program you have **modified**.

- Setting environment variables, mounting volumes, putting a reverse proxy in front of it and
  taking backups is not modifying the program. The licence defines to modify as changing the
  work in a way that needs the copyright holder's permission (AGPL section 0), and choosing a
  setting the program offers does not.
- The "Source code (AGPL-3.0)" link in the footer, `/about` and `GET /api/about`
  ([API.md](API.md)) already offer the source for you. Unset, they point at the upstream tag of
  the version you run, which is exactly your source when you run an unmodified copy of that
  tagged release. You do not need to do anything.
- If you build from an unchanged commit that no tag names, the default link would name a tag
  that is not your build. Either build with
  `docker build --build-arg SOURCE_REF=<the commit> .`, or set `SOURCE_CODE_URL` to the page of
  that commit. `SOURCE_REF` is only for an unchanged upstream tag or commit.

## I modify it

Change the code, a translation, a stylesheet or the build, and what you run is a modified
version.

- **Your guests count as users.** A person who opens the upload page on their phone, or a host
  who signs in, is interacting with your copy over a network. If nobody but you ever uses it,
  there is nobody to offer anything to.
- **Once other people use it**, you must offer all of them the _Corresponding Source_ of your
  version: the complete source of your version of EventSlide, your changes included, with the
  scripts that build and install it, under the AGPL.
- **How, in EventSlide.** Publish your source (a public repository, at a tag or a commit that
  matches what you deploy) and set `SOURCE_CODE_URL` to that page. It must be an `https`
  address. The footer link and `/api/about` then offer your source instead of the upstream
  tag, which does not contain your changes and would be the wrong thing to offer.
  [`.env.example`](../.env.example) has the details.
- **Keep it true.** When you deploy a new version of your changes, the source you offer must be
  the one that is running.
- **The link is not yours to hide.** EventSlide has no setting for it. If you edit the code to
  remove it, you still owe the offer and have to make it some other prominent way.
- **You do not have to publish anything else**: not your data, not your secrets, not changes
  you never run for other people.

## I fork it

You may. A fork is a modified version, so everything above applies, and in addition:

- It keeps the licence: `LICENSE` unmodified, [NOTICE](../NOTICE) and the copyright notices
  stay, and your fork is **AGPL-3.0-only** too. You can add your own copyright line for your
  own changes. You cannot put the code you received under a different licence.
- Point `SOURCE_CODE_URL` at your fork.
- You may fork the older, GPL-3.0 code instead (see below). You then get that code under the
  GPL, which has no network clause, and nothing the project did after it.

## Which versions are under which licence

| Code                                                                            | Licence           |
| ------------------------------------------------------------------------------- | ----------------- |
| Up to and including commit `5c2607380ebb18045a14cae979bb54e6fa2def76`           | **GPL-3.0**       |
| After it on the main line (`v3.0.0` is the first release) and everything beyond | **AGPL-3.0-only** |

That commit is the one [`.github/gpl-boundary`](../.github/gpl-boundary) names, and the tag
`gpl-final` is cut on it. The tag is deliberately not a version number, so that nothing mistakes
it for a release. A CI job (`licenseHistory`) checks that every commit after the boundary on the
first-parent line of `main` carries the AGPL text in `LICENSE`.

**Nothing published before the boundary is relicensed.** It stays available under GPL-3.0. The
GPL makes its grant irrevocable (GPL-3.0 section 2) for as long as its terms are followed:
whoever has a copy from before the boundary keeps the right to use, modify and pass it on
under the GPL, and the project cannot take that back. The GPL has no network clause, so the
older code carries none.

To know which licence a given build is under, read the `LICENSE` file at its commit: the GPL
text means GPL-3.0, the AGPL text means AGPL-3.0-only. A commit merged later from a branch that
was cut before the relicence can still carry the GPL text in its own tree, which is why this is
the reliable test. Every release from `v3.0.0` is AGPL-3.0-only; `v2.0.0` and `v2.1.0` are
GPL-3.0.

## Other questions

**Does this change how sharp, libvips or ffmpeg are licensed?** No. They stay under their own
licences; [NOTICE](../NOTICE) names the main ones. ffmpeg is installed in the image and run as
a separate process, never linked into EventSlide.

**Is it all right to run it for clients, for money?** Yes. Running it unmodified for other
people obliges nothing new; only modifying it and serving the modified version triggers
section 13.

**How do I contribute?** See [CONTRIBUTING.md](../CONTRIBUTING.md). It is not covered here.

**My case is not on this page.** Open an issue on the repository, or ask a lawyer: the answer
for a particular situation depends on facts this page cannot know.
