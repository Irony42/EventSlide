import {
  closeQuietly,
  expect,
  FIRST_JOIN_CODE,
  freshServerTest as test,
  photoIdAt,
  signInAsHost,
  VISUAL_PUBLIC_URL,
  wallUrl,
} from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aBrightPhoto, aPhoto } from '../fixtures/media'

/**
 * Visual regression, and only where "looks right" *is* the requirement.
 *
 * Restricted to the wall on purpose. A snapshot of a form tells you a button moved four
 * pixels and fails on a font-rendering difference between two machines; a snapshot of
 * the projected surface catches the class of regression that matters here — a caption
 * that has become unreadable, a photo that has started being cropped, a layout that
 * collapsed — and none of those have a non-visual assertion that is honest.
 *
 * Only `chromium-desktop` runs these. Font rasterisation differs between engines, so
 * three browsers would mean three snapshot sets and three ways to be flaky for no extra
 * information.
 *
 * The display URL's `?layout=` now selects the layout, read in the browser by
 * `web/src/features/wall/hooks/useLayoutParam.ts`; the server no longer accepts a
 * layout at all. These tests still reach the mosaic with the host's `L` shortcut
 * instead, because a baseline is only worth what the assertion in front of it is worth:
 * `?layout=` was dead for four baseline generations and every one of them quietly
 * photographed the spotlight. Counting the tiles before the shot is what caught that,
 * so the count stays and the route to the layout stays the one a person takes. That the
 * URL reaches the same place is proved without a snapshot in
 * `tests/e2e/journeys/display-wall.spec.ts`.
 *
 * The four layouts added in roadmap 2.3 are reached by `?layout=`, because `L` would
 * mean four keystrokes and a test that fails on the cycle order rather than on the
 * layout. They are guarded the same way and then some: `data-wall-layout` on the wall
 * element says which layout is up, which a slot count cannot — a filmstrip and a mosaic
 * can both be holding six photos, and a fall back between them would have photographed
 * exactly as well as the `?layout=` generations did.
 *
 * **Every test here takes a server of its own** — `freshServerTest`, not the worker-scoped
 * `test` the journeys use. The pixels in these shots contain values the server minted: a
 * polaroid print's tilt is a static hash of its photo id, and the join card prints a code
 * drawn from the same generator. Both come from `sequentialIdGenerator`, whose counters are
 * per *process* while a shared server is per *worker*, so what a spec was handed depended
 * on which other tests its worker happened to take first — and two renders of one commit
 * disagreed by 243 291 pixels, ratio 0.117, on a polaroid neither of them had touched. A
 * server per test makes each event its server's first, and the assertions below say so out
 * loud rather than leaving it to this paragraph: {@link FIRST_JOIN_CODE} in `seedAlbum`,
 * and the three print ids on the polaroid shot.
 *
 * The QR beside that code needed a different answer, because no fixture can pin an
 * ephemeral port. It used to be built in the browser from `window.location.origin`; it now
 * comes from `joinUrl` on the wall response, which the server derives from `PUBLIC_URL`,
 * and `freshServerTest` gives its servers a fixed one. That was a product fix as much as a
 * test one — a projector on a venue LAN was printing a QR no guest's phone could resolve —
 * and it is why these baselines compare the QR pixel for pixel instead of masking the one
 * region on this wall whose correctness a guest's evening depends on. `docs/TESTING.md`
 * carries the numbers.
 */

test.describe('the projected wall @visual', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'snapshots are taken on one engine; font rasterisation differs between them',
  )

  /**
   * A fixed album: the same six photos, the same captions, the same order, every run.
   * Deterministic colours from the labels rather than real photographs, so a snapshot
   * diff is always a layout change and never a JPEG-encoder difference.
   */
  const seedAlbum = async (
    app: Parameters<typeof signInAsHost>[1],
    surfaces: {
      guest: Parameters<typeof joinAndUpload>[0]
      host: Parameters<typeof signInAsHost>[0]
    },
    slug: string,
  ) => {
    const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })

    // `freshServerTest`'s promise, asserted rather than trusted. This event is its
    // server's first, which is what makes the six photo ids below — and therefore the
    // polaroid's three tilts — and the code printed on every full-page shot the same on
    // every run. Swap the fixture back to the worker-scoped `test` and this line fails
    // here, naming its cause, instead of a baseline failing two runs later on 60 000
    // pixels of nothing.
    expect(event.joinCode).toBe(FIRST_JOIN_CODE)

    /**
     * And the other half of the same promise: the origin the QR encodes.
     *
     * **This is the one pin a baseline cannot catch on its own, which is exactly why it is
     * asserted here.** The join card occupies roughly 13 000 pixels and the whole-frame
     * budget is 20 736, so the card could render *completely differently* and every shot
     * below would still pass. Drop `PUBLIC_URL` from `freshServerTest` and the QR quietly
     * goes back to encoding an ephemeral port — no red job, just a baseline that has
     * stopped meaning anything about the region it was regenerated for.
     *
     * Read off the wall response rather than out of the DOM, because the response is where
     * the value now comes from and a QR's own pixels cannot be read back.
     */
    const wall = (await (
      await surfaces.host.request.get(app.url(`/api/events/${event.slug}/wall`))
    ).json()) as { joinUrl?: string }
    expect(wall.joinUrl).toBe(`${VISUAL_PUBLIC_URL}/join/${FIRST_JOIN_CODE}`)

    await signInAsHost(surfaces.host, app)
    await surfaces.host.goto(app.url(`/admin/events/${event.slug}/moderation`))

    const album = [
      { label: 'confettis', caption: 'Les confettis', width: 1600, height: 1200 },
      { label: 'gateau', caption: 'Le gâteau', width: 1200, height: 1600 },
      { label: 'discours', caption: 'Le discours', width: 1600, height: 1067 },
      { label: 'danse', caption: 'La première danse', width: 1067, height: 1600 },
      { label: 'table', caption: 'La table 4', width: 1600, height: 1200 },
      { label: 'sortie', caption: 'La sortie', width: 1600, height: 900 },
    ]

    for (const photo of album) {
      await joinAndUpload(surfaces.guest, app, event.joinCode, {
        displayName: 'Léa',
        caption: photo.caption,
        file: await aPhoto(`${slug}-${photo.label}`, photo.width, photo.height),
      })
    }

    await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(album.length)
    for (let index = 0; index < album.length; index += 1) {
      await surfaces.host
        .getByTestId('moderation-card')
        .first()
        .getByRole('button', { name: /Publier/i })
        .click()
      // Awaited one at a time, and this is the load-bearing line. Clicking `.first()`
      // six times only publishes six photos if the queue has actually shrunk between
      // the clicks; without the wait the loop can hit a card that is still on screen
      // and leave the last photo pending.
      await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(
        album.length - index - 1,
      )
    }

    /**
     * **Every visual test depends on this line, and it was missing.**
     *
     * The wall shows one photo in `spotlight`, and which one is decided by the playlist
     * — so a helper that returns while a photo is still pending hands the screenshot a
     * different composition than the run before. That is not a flake that costs a
     * re-run: the baseline is rendered by one commit and compared by another, so the
     * two sides can disagree about *which photograph the wall is showing* and report it
     * as 78% of pixels changed, on a branch that touched no rendering at all.
     *
     * It cost exactly that on the i18n branch, whose extra work at boot moved the
     * timing enough to land on the other side of the race.
     */
    await expect(surfaces.host.getByTestId('moderation-card')).toHaveCount(0)
    return event
  }

  /**
   * The host choosing the event's look, through the form a host actually uses.
   *
   * Driven through the UI rather than through the API, because the point of a baseline
   * here is the path a real event takes: the picker offers four colours and two faces,
   * and a snapshot taken from a value the console could never produce would photograph
   * something nobody can reach.
   *
   * Only the choices a shot can actually show are passed. A baseline that also varied the
   * two it cannot is a diff that names no cause — the reader cannot tell whether the
   * frame moved or the font did, and half the changes are invisible either way.
   */
  const applyTheme = async (
    host: Parameters<typeof signInAsHost>[0],
    app: Parameters<typeof signInAsHost>[1],
    slug: string,
    theme: { colour?: string; fonts?: string; frame?: string },
  ) => {
    await host.goto(app.url(`/admin/events/${slug}/settings`))
    if (theme.colour !== undefined) await host.getByRole('radio', { name: theme.colour }).check()
    if (theme.fonts !== undefined) {
      await host.getByLabel('Typographie').selectOption({ label: theme.fonts })
    }
    if (theme.frame !== undefined) {
      await host.getByLabel('Cadre des photos').selectOption({ label: theme.frame })
    }
    await host.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(host.getByText('Réglages enregistrés.')).toBeVisible()
  }

  test('the empty state, which is what the room sees first', async ({ app, surfaces }) => {
    // Twenty minutes of an evening are spent looking at this screen. It is the most
    // seen view in the product and the one with no data to hide behind.
    const event = await app.seedEvent({ slug: 'vide', name: 'Camille & Sacha' })
    const { projector } = surfaces

    await projector.goto(wallUrl(app, event.slug, { transitionMs: 0 }))
    await expect(projector.getByTestId('wall-empty')).toBeVisible()

    // Snapshotting the copy, not the page — and the reason has changed, so it is restated
    // rather than left to read as the old one.
    //
    // It used to be that the code was random per event: `.join` is a content-sized grid, so
    // a code of wide characters made that block wider and pushed its flex sibling across
    // the screen, and a full-page baseline here failed intermittently on 3% to 5% of pixels
    // depending on which six characters the server had generated. Masking the block hid its
    // pixels but not the shift it caused. **That is fixed** — `freshServerTest` makes the
    // code `000001` on every run — so a full-page shot here would now be stable.
    //
    // It stays an element shot because that is what this test is *about*: the copy's own
    // typography and spacing, a caption gone unreadable, a heading that stopped fitting.
    // Clipping to the element keeps the diff on the subject instead of spending it on a
    // frame of dark ground. The join block's presence is asserted structurally just above —
    // and note it now depends on the response carrying `joinUrl` as well as the code, since
    // the wall prints no invitation with half of one.
    //
    // The code's value is covered by the journeys, which read it off this screen and join
    // with it.
    await expect(projector.getByTestId('wall-empty-copy')).toHaveScreenshot('wall-empty.png', {
      animations: 'disabled',
    })
  })

  test('the spotlight layout', async ({ app, surfaces }) => {
    const event = await seedAlbum(app, surfaces, 'spotlight')
    const { projector } = surfaces

    // `intervalMs: 0`, not a very long number. The spotlight's Ken Burns is the second
    // animation timed from the slide interval, and the one `--wall-transition` cannot
    // reach; `600_000` left it mounted and running, which made this shot whichever side of
    // `finish()` the shutter landed on. A wall that is not advancing mounts no zoom at all.
    await projector.goto(wallUrl(app, event.slug, { intervalMs: 0, transitionMs: 0 }))
    await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

    // Asserted, so the pin cannot be removed silently: put `600_000` back and this fails
    // on `Expected: still, Received: kenburns` before a pixel is compared.
    await expect(projector.getByTestId('wall-slide')).toHaveAttribute('data-motion', 'still')

    await expect(projector).toHaveScreenshot('wall-spotlight.png', { animations: 'disabled' })
  })

  /**
   * The caption over a white dress in full sun — roadmap 11.3.
   *
   * **The baseline this suite did not have, and the gap is worth recording.** `aPhoto`
   * derives its colour from its label, and every colour it happened to draw for the album
   * above came out dark — so the spotlight's caption scrim sat over near-black, where 55%
   * black and 83% black are the same picture, and raising the scrim to the alpha §8's
   * contrast contract looked like it moved nothing on the one change this suite exists to
   * make a human look at.
   *
   * **That "moved not one pixel" was written here and it was wrong.** Re-rendering the
   * committed set on unmodified `main` says so: the mosaic's in-tile credit plate sits over
   * a mid-grey tile and moved 208 146 pixels, ratio 0.100, the themed mosaic 0.109 and the
   * split 0.019. Nobody saw it because the committed images are not what CI compares — the
   * `Visual regression (wall)` job renders its own before *and* after — so a committed
   * baseline can go stale for eleven commits and stay green. The set is regenerated with
   * this change and those three land the scrim raise they should have landed in #58. The
   * lesson is the one `docs/TESTING.md` now states: a baseline nobody re-rendered is not
   * evidence about today's source.
   *
   * A scrim's whole job is the photograph that is brighter than its text. So the case is
   * here now, at the top of the gamut, which is the backdrop `tokens.contrast.test.ts`
   * derives the alpha against: this baseline is a picture of that arithmetic, and the next
   * person to reach for the scrim to make the photo show through more sees what it costs.
   */
  test('the caption over a photograph brighter than the text on it', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'robe-blanche', name: 'Camille & Sacha' })
    const { guest, host, projector } = surfaces

    await signInAsHost(host, app)
    await joinAndUpload(guest, app, event.joinCode, {
      displayName: 'Léa',
      caption: 'La robe en plein soleil',
      file: await aBrightPhoto('robe-blanche'),
    })

    await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
    await host
      .getByTestId('moderation-card')
      .getByRole('button', { name: /Publier/i })
      .click()
    await expect(host.getByTestId('moderation-card')).toHaveCount(0)

    await projector.goto(wallUrl(app, event.slug, { intervalMs: 0, transitionMs: 0 }))
    await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

    // **This is the shot the Ken Burns fast-forward was actually visible on**, and the
    // reason is the fixture rather than the layout: `aBrightPhoto` is 4:3 on a 16:9 screen
    // under `object-fit: contain`, so it is pillarboxed. A flat colour that covers the
    // screen photographs identically at scale 1 and at 1.08; a pillarboxed one moves its
    // two vertical edges, which is exactly the diff #56 predicted would appear "the day a
    // fixture letterboxes". `intervalMs: 0` mounts no zoom, and this asserts it.
    await expect(projector.getByTestId('wall-slide')).toHaveAttribute('data-motion', 'still')

    // The join card is put away because the subject of this shot is the caption's scrim,
    // and the card reserves the bottom-right corner that a centred caption would otherwise
    // use (`data-wall-chrome`). Not because it is unstable — it is not any more: both the
    // code and the QR now come from the server, so the shots that keep the card compare it
    // pixel for pixel.
    await projector.keyboard.press('Escape')
    await expect(projector.getByTestId('wall-join')).toHaveCount(0)

    await expect(projector).toHaveScreenshot('wall-spotlight-bright.png', {
      animations: 'disabled',
    })
  })

  test('the mosaic layout', async ({ app, surfaces }) => {
    const event = await seedAlbum(app, surfaces, 'mosaique')
    const { projector } = surfaces

    await projector.goto(wallUrl(app, event.slug, { intervalMs: 0, transitionMs: 0 }))
    await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

    // `L` is the host's layout shortcut. Asserting six tiles before the shot is what
    // keeps this test honest: a spotlight has one, so a silent fall back to it fails
    // here rather than in a snapshot diff nobody reads.
    await projector.keyboard.press('l')
    await expect(projector.getByTestId('wall-slide')).toHaveCount(6)

    await expect(projector).toHaveScreenshot('wall-mosaic.png', { animations: 'disabled' })
  })

  /**
   * The four layouts of roadmap 2.3, each reached by the URL a kiosk would be launched
   * on and each checked by name before the shutter.
   *
   * The album is six photos, which is deliberately more than the polaroid and the split
   * show and fewer than the collage can hold: what each layout does with a playlist that
   * does not match its grid is precisely what a snapshot is for here.
   *
   * `intervalMs: 0` is what stops the clock, and it is not the same instruction as a very
   * long number — so every shot of a *running* wall passes it, including the ones whose
   * layout animates nothing today. There were two animations timed from the slide interval
   * and `600_000` left both of them mounted and running; a layout that grows a third gets
   * the pin for free instead of a red job on somebody else's pull request. The two
   * reduced-motion shots are the deliberate exception and say why at the call site: their
   * subject is the preference, and a wall that had stopped anyway would prove nothing
   * about it.
   *
   * **A screenshot does not freeze a running animation — it fast-forwards it.**
   * `animations: 'disabled'` calls `finish()` on every finite animation on the page, so
   * the shutter photographs the animation's *last* frame and holds it there for the rest
   * of the test. For every other layout here that is harmless: the polaroid's landing and
   * the mosaic's fade are timed from `--wall-transition`, which these tests set to `0`,
   * and Ken Burns only scales a photograph that already covers the screen.
   *
   * The filmstrip's drift is the exception, because it is timed from
   * `--wall-drift-duration` — the *slide interval*, deliberately, so it can never outlast
   * its slide (trap 6) — and `transitionMs: 0` therefore does not touch it. Its end frame
   * is one whole frame width of travel: the band slides 384px left on a 1920 screen and
   * the first photograph leaves the screen entirely. So `wall-filmstrip.png` was a
   * photograph of *either* end of that travel, and which one a machine produced was
   * decided by the harness rather than by this file. It cost four red visual jobs on four
   * unrelated pull requests, every one of them reporting 34% of the screen changed on a
   * branch that had not touched the wall, and every one of them green on a re-run.
   *
   * `intervalMs: 0` is the honest version of what `600_000` was reaching for. A wall that
   * is not advancing declares `data-motion="still"` and mounts no animation at all, so
   * there is nothing for the shutter to move and both ends of the travel stop being
   * possible. The motion each layout is in is asserted below rather than assumed, which
   * is what makes this comment a rule and not a hope: put `600_000` back and the
   * filmstrip's assertion fails on `drift` before any pixel is compared.
   *
   * The drift is not left untested by that. Its presence, its duration and its anchoring
   * are ring 5 (`WallLayouts.test.tsx`), and the distance it travels — the one fact only
   * a real engine can check — is asserted without a snapshot in
   * `tests/e2e/journeys/display-wall.spec.ts`.
   */
  const LAYOUTS = [
    {
      layout: 'polaroid',
      slug: 'polaroid',
      slides: 3,
      file: 'wall-polaroid.png',
      // A 0ms landing, so its end frame is the print at rest whether or not it is
      // fast-forwarded. Asserted, because that is the property this shot depends on.
      motion: 'landing',
      /**
       * The photographs the three prints must be holding, and the only entry that names
       * any — because this is the one shot whose pixels are a **function of the ids**.
       * `tiltFor` is an FNV-1a hash of the photo id folded into ±4°, so a print holding
       * photograph five instead of six is a print at a different angle, and that is the
       * 243 291-pixel disagreement this file used to produce between two renders of one
       * commit. The wall plays newest first and `rotatingSlots` fills slot *n* from
       * position *n* before its first turn, so a fresh server's six-photograph album puts
       * six, five and four on the pile.
       */
      photoIds: [photoIdAt(6), photoIdAt(5), photoIdAt(4)],
    },
    {
      layout: 'filmstrip',
      slug: 'pellicule',
      slides: 6,
      file: 'wall-filmstrip.png',
      motion: 'still',
      photoIds: null,
    },
    // The split declares no motion at all; its fade is the mosaic's, timed from
    // `--wall-transition`.
    {
      layout: 'split',
      slug: 'cote-a-cote',
      slides: 2,
      file: 'wall-split.png',
      motion: null,
      photoIds: null,
    },
  ] as const

  for (const { layout, slug, slides, file, motion, photoIds } of LAYOUTS) {
    test(`the ${layout} layout`, async ({ app, surfaces }) => {
      const event = await seedAlbum(app, surfaces, slug)
      const { projector } = surfaces

      await projector.goto(wallUrl(app, event.slug, { layout, intervalMs: 0, transitionMs: 0 }))

      // Named, then counted. A slot count alone cannot tell a filmstrip from a mosaic —
      // both can be holding six photos — and a silent fall back between two layouts
      // photographs exactly as convincingly as the right one.
      await expect(projector.locator('[data-wall-layout]')).toHaveAttribute(
        'data-wall-layout',
        layout,
      )
      await expect(projector.getByTestId('wall-slide')).toHaveCount(slides)

      // And then: what is moving. See the note above `LAYOUTS` — a baseline taken while
      // something is animating is a baseline of whichever frame the shutter reached.
      //
      // `null` means "declares no motion at all", which is a claim and gets checked like
      // one: the branch asserts the *absence* of the attribute rather than skipping. A
      // skipped branch is how the next layout added to this table copies the split's row
      // and silently asserts nothing about the very thing the table exists to pin.
      if (motion === null) {
        await expect(projector.locator('[data-motion]')).toHaveCount(0)
      } else {
        await expect(projector.locator('[data-motion]')).toHaveAttribute('data-motion', motion)
      }

      // And, where the ids reach the pixels, which photographs are in which slot.
      if (photoIds !== null) {
        const held = await projector
          .locator('[data-photo-id]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-photo-id')))

        expect(held).toEqual([...photoIds])
      }

      await expect(projector).toHaveScreenshot(file, { animations: 'disabled' })
    })
  }

  test('the collage layout, once it has filled', async ({ app, surfaces }) => {
    // The collage is the one layout whose composition is a function of how long the
    // screen has been on: it starts on one photo and gains a cell per slide. A snapshot
    // of its first frame would photograph a single tile and tell nobody anything.
    //
    // The wall is driven by the arrow key rather than by a fast interval, so the shot is
    // taken at a known slide instead of at whichever one the clock happened to be on.
    // A 250ms interval would have filled the grid too, and produced a different baseline
    // on every run. `advance` is a callback and not the timer, so it still steps a wall
    // whose interval is `0`.
    const event = await seedAlbum(app, surfaces, 'collage')
    const { projector } = surfaces

    await projector.goto(
      wallUrl(app, event.slug, { layout: 'collage', intervalMs: 0, transitionMs: 0 }),
    )
    await expect(projector.locator('[data-wall-layout]')).toHaveAttribute(
      'data-wall-layout',
      'collage',
    )
    await expect(projector.getByTestId('wall-slide')).toHaveCount(1)

    for (let slide = 0; slide < 5; slide += 1) {
      await projector.keyboard.press('ArrowRight')
    }

    // Six photos in the album, so the grid tops out at six cells rather than at twelve:
    // repeating a face to fill the other six is the one thing it must not do.
    await expect(projector.getByTestId('wall-slide')).toHaveCount(6)

    await expect(projector).toHaveScreenshot('wall-collage.png', { animations: 'disabled' })
  })

  test('the filmstrip does not drift for a viewer who asked for no motion', async ({
    app,
    surfaces,
    browser,
  }) => {
    // The drift runs for the whole length of a slide and crosses four metres of wall, so
    // it is the worst vestibular case the product has. Under the preference the band has
    // to be a finished composition standing still, not the first frame of a movement
    // that never completes.
    const event = await seedAlbum(app, surfaces, 'pellicule-sobre')

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      baseURL: app.baseUrl,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    // **A long interval here, deliberately, where every other shot in this file pins `0`.**
    // A wall that is not advancing is already still, so `intervalMs: 0` would make this
    // baseline's stillness unattributable — it would pass just as well with the preference
    // ignored entirely. With the wall genuinely advancing, `still` can only have come from
    // the preference, which is the one thing this test is about. It is not an unpinned
    // input: under `prefers-reduced-motion` no interval-timed animation is mounted at all,
    // and the line below asserts that before the shutter.
    await page.goto(
      wallUrl(app, event.slug, { layout: 'filmstrip', intervalMs: 600_000, transitionMs: 0 }),
    )
    await expect(page.getByTestId('wall-slide')).toHaveCount(6)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'still')

    await expect(page).toHaveScreenshot('wall-filmstrip-reduced-motion.png', {
      animations: 'disabled',
    })

    // `closeQuietly`, not `context.close()`. This spec opens its own context because
    // `reducedMotion` is a context option, so it had none of the protection
    // `openSurfaces` carries for Playwright deleting a passing test's own recordings —
    // which on Windows loses a race with itself and fails the close with `ENOENT`, on a
    // different test every run, in a suite whose assertions all passed.
    await closeQuietly(context)
  })

  test('the spotlight layout under reduced motion', async ({ app, surfaces, browser }) => {
    // Reduced motion is a health requirement, not a preference: Ken Burns and the
    // crossfade can trigger vestibular symptoms. The still frame has to be a finished
    // composition rather than the first frame of an animation that never runs.
    const event = await seedAlbum(app, surfaces, 'sobre')

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      baseURL: app.baseUrl,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    // A long interval, for the reason the filmstrip's reduced-motion shot above states: a
    // stopped wall is still on its own, so pinning `0` here would let this baseline pass
    // with the preference ignored. The wall is advancing and the frame is at rest anyway,
    // which is the whole claim.
    await page.goto(wallUrl(app, event.slug, { intervalMs: 600_000, transitionMs: 0 }))
    await expect(page.getByTestId('wall-slide')).toHaveCount(1)
    await expect(page.getByTestId('wall-slide')).toHaveAttribute('data-motion', 'still')

    await expect(page).toHaveScreenshot('wall-spotlight-reduced-motion.png', {
      animations: 'disabled',
    })

    await closeQuietly(context)
  })

  /**
   * Per-event theming, roadmap 2.2 — the one feature in this file whose whole
   * requirement is "looks right", and therefore the one with the strongest claim on a
   * baseline.
   *
   * Two shots, because no single frame shows all three choices: the accent appears only
   * where the wall speaks in its own voice (the invitation), and the frame style only
   * where a layout draws a frame at all. The caption's face is not photographed a third
   * time — it is `--font-display`, the same token the event's name below resolves, and
   * one proof that the substitution reaches the projector is enough.
   *
   * Every other baseline in this file photographs an event that chose nothing, which is
   * what makes them the evidence that the default is unchanged.
   */
  test('the invitation in the event’s own colour and face', async ({ app, surfaces }) => {
    const event = await app.seedEvent({ slug: 'theme-vide', name: 'Camille & Sacha' })
    const { host, projector } = surfaces

    await signInAsHost(host, app)
    // The two this frame shows: the accent on the invitation's first line, and the
    // display face on the event's name. The frame style is left alone — the empty state
    // draws no frame, so varying it here would be a change the baseline cannot see.
    await applyTheme(host, app, event.slug, { colour: 'Rose', fonts: 'Classique' })

    await projector.goto(wallUrl(app, event.slug, { transitionMs: 0 }))
    await expect(projector.getByTestId('wall-empty')).toBeVisible()

    // The same element the unthemed baseline photographs, for the same reason it gives: the
    // subject is the copy — the accent on its first line and the display face on the event's
    // name — and clipping to it keeps the diff on that. Not because the code moves any more.
    await expect(projector.getByTestId('wall-empty-copy')).toHaveScreenshot(
      'wall-empty-themed.png',
      { animations: 'disabled' },
    )
  })

  test('the mosaic with the frames the event asked for', async ({ app, surfaces }) => {
    const event = await seedAlbum(app, surfaces, 'theme-mosaique')
    const { host, projector } = surfaces

    // The frame style alone. The mosaic's in-tile credit is the only text it prints and
    // it stays in the sans by design, and no accent reaches this layout at all — so a
    // colour or a face set here would be two more ways for this diff to move without
    // meaning anything.
    await applyTheme(host, app, event.slug, { frame: 'Coins droits' })

    await projector.goto(wallUrl(app, event.slug, { layout: 'mosaic', intervalMs: 0 }))
    await expect(projector.locator('[data-wall-layout]')).toHaveAttribute(
      'data-wall-layout',
      'mosaic',
    )
    await expect(projector.getByTestId('wall-slide')).toHaveCount(6)

    // The join card is put away first, which the unthemed layout baselines do not do.
    // The reason used to be that its code and QR were random per event; they are not any
    // more — the code comes from a server this test has to itself and the QR from that
    // server's `PUBLIC_URL`, so the eight shots that keep the card compare it pixel for
    // pixel. It goes because the subject here is the frame style on every tile, and the
    // card covers two of them.
    await projector.keyboard.press('Escape')
    await expect(projector.getByTestId('wall-join')).toHaveCount(0)

    await expect(projector).toHaveScreenshot('wall-mosaic-themed.png', { animations: 'disabled' })
  })
})
