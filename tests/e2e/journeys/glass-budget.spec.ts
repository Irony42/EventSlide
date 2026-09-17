import { expect, joinAsGuest, test, wallUrl } from '../fixtures/app'

/**
 * The glass budget, in a real browser — roadmap 11.3.
 *
 * The rule itself is unit-tested (`web/src/design-system/glass.test.ts`) and the material
 * is pinned against the stylesheet (`glass.material.test.ts`). Neither of those can say
 * whether the cascade actually delivers it: the tier is an inherited custom property set
 * on a surface element and read by a pane several components down, and "a custom property
 * that references another is resolved on the element it is declared on" is precisely the
 * mistake this repository already made once with `--accent` and caught with a Chromium
 * end-to-end check (DESIGN-SYSTEM.md §12). This is the same check for the same class of
 * mistake.
 *
 * It asserts the token rather than a screenshot. What the budget promises is not a look —
 * it is that the projector is not being asked to blur a moving frame — and that claim is
 * legible in `--glass-filter` and invisible in a photograph of a wall that has no glass
 * pane on it yet.
 */
test.describe('the glass budget', () => {
  /** What the surface resolves for the material, which is what every pane inside it uses. */
  const glassFilterOn = async (
    page: Parameters<typeof joinAsGuest>[0],
    selector: string,
  ): Promise<string> =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--glass-filter').trim())

  test('the room is on the opaque fallback, so no blur lands on a moving wall', async ({
    app,
    surfaces,
  }) => {
    // The wall is the one surface whose content never stops moving — a crossfade, Ken
    // Burns, and since roadmap 1.4 a video clip decoding under both — so a backdrop
    // filter there is recomputed every frame at full screen, on a venue mini-PC nobody
    // is standing next to. The fallback is chosen here rather than discovered at a
    // wedding, and this is the assertion that says it is actually in force.
    const event = await app.seedEvent({ slug: 'budget-salle', name: 'Camille & Sacha' })
    const { projector } = surfaces

    await projector.goto(wallUrl(app, event.slug, { transitionMs: 0 }))
    await expect(projector.getByTestId('wall-empty')).toBeVisible()

    await expect(projector.locator('[data-glass]')).toHaveAttribute('data-glass', 'opaque')
    expect(await glassFilterOn(projector, '[data-glass]')).toBe('none')
  })

  test('the guest keeps the blur, which is the half of the budget worth having', async ({
    app,
    surfaces,
  }) => {
    // Roadmap 11.3 decides this pair together: if glass costs frames on the projector the
    // wall gives it up and the guest does not. A test that only proved the wall had lost
    // it would pass just as well if the material had been switched off everywhere.
    const event = await app.seedEvent({ slug: 'budget-invite', name: 'Camille & Sacha' })
    const { guest } = surfaces

    await joinAsGuest(guest, app, event.joinCode, 'Léa')
    await expect(guest.getByTestId('upload-composer')).toBeVisible()

    // Read on the pane, not on `body`. `body` is an *ancestor* of the element `AppShell`
    // marks, so it resolves `:root`'s value whatever the tier decides — this assertion
    // was written that way first and would have passed unchanged if the rule had put the
    // guest on the opaque tier, which is the one thing it exists to notice.
    expect(await glassFilterOn(guest, '[data-testid="upload-composer"]')).toMatch(/^blur\(/)
  })

  test('the guest composer is really blurred, not merely told to be', async ({
    app,
    surfaces,
    browserName,
  }) => {
    // One engine, because this asserts the resolved `backdrop-filter` property and not a
    // custom property: WebKit carried it behind `-webkit-` for years, so the unprefixed
    // longhand is a different question on a different browser and answering it here would
    // make the test about the engine rather than about the budget. The material declares
    // both spellings and `glass.material.test.ts` holds it to that.
    test.skip(browserName !== 'chromium', 'the resolved longhand differs by engine')

    const event = await app.seedEvent({ slug: 'budget-verre', name: 'Camille & Sacha' })
    const { guest } = surfaces

    await joinAsGuest(guest, app, event.joinCode, 'Léa')

    const applied = await guest
      .getByTestId('upload-composer')
      .evaluate((element) => getComputedStyle(element).backdropFilter)

    // The pane a guest presses everything on, over the photographs they just sent.
    expect(applied).toMatch(/blur\(\d/)
    expect(applied).toContain('saturate')
  })

  test('a guest who asked for more contrast gets the opaque pane instead', async ({
    app,
    surfaces,
    browserName,
  }) => {
    // The preference tier, which was otherwise asserted only as a string in the
    // stylesheet. `prefers-reduced-transparency` is the other half of that media query and
    // Playwright cannot emulate it, so this exercises the half it can — the block is one
    // rule, so proving it is reached proves both operands land somewhere real.
    test.skip(browserName !== 'chromium', 'media emulation differs by engine')

    const event = await app.seedEvent({ slug: 'budget-contraste', name: 'Camille & Sacha' })
    const { guest } = surfaces

    await guest.emulateMedia({ contrast: 'more' })
    await joinAsGuest(guest, app, event.joinCode, 'Léa')

    const composer = guest.getByTestId('upload-composer')
    await expect(composer).toBeVisible()

    expect(await glassFilterOn(guest, '[data-testid="upload-composer"]')).toBe('none')

    // And the pane is opaque rather than a transparent box with nothing behind it, which
    // is the failure roadmap 11.1 names for a fallback done badly.
    const background = await composer.evaluate((element) => getComputedStyle(element).background)
    expect(background).not.toContain('rgba')

    await guest.emulateMedia({ contrast: 'no-preference' })
  })
})
