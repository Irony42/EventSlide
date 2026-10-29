import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, joinAsGuest, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { sessionOn, succeeded } from '../fixtures/session'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'

type App = Parameters<typeof joinAsGuest>[1]

const COLOURS = [
  '#ff1744',
  '#ffd600',
  '#00e676',
  '#2979ff',
  '#d500f9',
  '#ff9100',
  '#00e5ff',
  '#ffffff',
]
const photo = async (i: number): Promise<string> => {
  const c = COLOURS[i % COLOURS.length]!
  const d = COLOURS[(i + 3) % COLOURS.length]!
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient></defs><rect width="900" height="900" fill="url(#g)"/><circle cx="450" cy="420" r="220" fill="${COLOURS[(i + 5) % 8]}"/><rect x="0" y="700" width="900" height="120" fill="#fff"/><rect x="0" y="40" width="900" height="60" fill="#000"/></svg>`
  const dir = await mkdtemp(join(tmpdir(), 'g2-'))
  const path = join(dir, `colour-${i}.jpg`)
  await writeFile(path, await sharp(Buffer.from(svg)).jpeg().toBuffer())
  return path
}

const THEMES = [
  { ambiance: 'eventslide', hue: 305 },
  { ambiance: 'guinguette', hue: 60 },
  { ambiance: 'noces', hue: 305 },
] as const

const setup = async (
  app: App,
  slug: string,
  ambiance: string,
  hue: number,
  material: 'glass' | 'plain',
) => {
  const event = await app.seedEvent({ slug, name: 'Les 40 ans de Sam' })
  const api = await sessionOn(app.baseUrl)
  const login = await api.post('/api/auth/login', app.owner)
  if (!succeeded(login)) throw new Error('login')
  const saved = await api.patch(`/api/events/${event.slug}/settings`, {
    allowCaptions: true,
    allowClips: true,
    theme: { accentHue: hue, fonts: 'sans', frame: 'soft', material, ambiance },
  })
  if (!succeeded(saved)) throw new Error(`settings ${saved.status} ${JSON.stringify(saved.body)}`)
  return event
}

/** Text of the pane whose nearest painted ancestor (pane excluded) is not (near-)opaque. */
const WALK = `(() => {
  const pane = document.querySelector('[data-testid=upload-composer]')
  const alphaOf = (c) => {
    const m = /\\/\\s*([\\d.]+%?)\\s*\\)/.exec(c)
    if (m) return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1])
    if (c.startsWith('rgba')) return parseFloat(c.split(',')[3])
    if (c === 'transparent') return 0
    return 1
  }
  const bad = [], disabled = [], ok = []
  const seen = new Set()
  const check = (el, label) => {
    if (seen.has(el)) return
    seen.add(el)
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none') return
    let n = el, found = null, op = 1
    while (n && n !== pane) {
      const s = getComputedStyle(n)
      op *= parseFloat(s.opacity)
      if (alphaOf(s.backgroundColor) >= 0.95) { found = n; break }
      n = n.parentElement
    }
    const rec = { text: label.slice(0, 60), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), opacity: op }
    const exempt = el.closest(':disabled,[aria-disabled=true]')
    if (!found) (exempt ? disabled : bad).push(rec)
    else if (op < 0.95 && !exempt) bad.push(rec)
    else ok.push(rec)
  }
  const w = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const t = w.currentNode
    if (t.textContent.trim() && t.parentElement) check(t.parentElement, t.textContent.trim())
  }
  pane.querySelectorAll('input:not([type=file]),textarea').forEach((e) => check(e, e.placeholder || e.value || e.tagName))
  return { bad, disabled, ok: ok.length }
})()`

/**
 * Clear glass (ADR 0010, proposed amendment): the pane is transparent, so no text may stand on it.
 * Every text node of the guest composer, in every state and three ambiances, must have a (near-)opaque
 * painted ancestor inside the pane. A real cascade, which jsdom does not compute.
 */
test.describe('clear glass: text never sits on the pane', () => {
  test('every text of the composer stands on an opaque fill', async ({
    app,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000)
    const results: Record<string, unknown> = {}
    for (const th of THEMES) {
      const event = await setup(
        app,
        `w-${th.ambiance}-${testInfo.workerIndex}`,
        th.ambiance,
        th.hue,
        'glass',
      )
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: SUITE_LOCALE,
        baseURL: app.baseUrl,
      })
      const page = await ctx.newPage()
      await joinAsGuest(page, app, event.joinCode)
      await expect(page.getByTestId('upload-composer')).toBeVisible()
      results[`${th.ambiance}:gated`] = await page.evaluate(WALK)
      await passPrivacyNotice(page)
      results[`${th.ambiance}:empty`] = await page.evaluate(WALK)
      await page.getByRole('button', { name: /Légende/ }).click()
      const clipBtn = page.getByRole('button', { name: /vidéo|clip/i })
      if ((await clipBtn.count()) > 0) await clipBtn.first().click()
      results[`${th.ambiance}:options`] = await page.evaluate(WALK)
      await page.getByTestId('photo-input').setInputFiles([await photo(0), await photo(1)])
      await expect(page.getByTestId('upload-item-1')).toBeVisible()
      results[`${th.ambiance}:queued`] = await page.evaluate(WALK)
      await page.getByRole('button', { name: /^Envoyer/i }).click()
      await expect(page.getByRole('button', { name: 'Masquer le récapitulatif' })).toBeVisible({
        timeout: 30_000,
      })
      results[`${th.ambiance}:done`] = await page.evaluate(WALK)
      await ctx.close()
    }
    const offenders = Object.entries(results)
      .filter(([, v]) => (v as { bad: unknown[] }).bad.length > 0)
      .map(([k, v]) => [k, (v as { bad: unknown[] }).bad])
    expect(offenders).toEqual([])
  })
})
