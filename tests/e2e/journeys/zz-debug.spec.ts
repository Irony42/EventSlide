import { test } from '../fixtures/app'
import { joinAsGuest } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'
test('dbg', async ({ app, browser }) => {
  const event = await app.seedEvent({ slug: 'dbg2', name: 'Dbg' })
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, baseURL: app.baseUrl, locale: 'fr-FR' })
  const page = await context.newPage()
  await page.addInitScript(() => { const o = Element.prototype.scrollIntoView; (window as any).__log = []; Element.prototype.scrollIntoView = function (a?: any) { const r = (this as HTMLElement).getBoundingClientRect(); (window as any).__log.push(JSON.stringify([this.tagName, a, r.top, r.bottom, scrollY, innerHeight])); return o.call(this, a) } })
  await joinAsGuest(page, app, event.joinCode)
  await passPrivacyNotice(page)
  await page.getByTestId('photo-input').setInputFiles(await Promise.all([1,2,3].map((i) => aPhoto('q' + i, 800, 600))))
  for (const ms of [200, 800, 2500]) {
  await page.waitForTimeout(ms)
  const info = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="upload-composer"]') as HTMLElement
    const b = c.getBoundingClientRect()
    const btn = [...document.querySelectorAll('button')].find((x) => /^Envoyer/.test(x.textContent ?? ''))!
    const r = btn.getBoundingClientRect()
    return { pos: getComputedStyle(c).position, over: c.hasAttribute('data-oversized'), top: b.top, bottom: b.bottom, vh: innerHeight, sy: scrollY, dh: document.documentElement.scrollHeight, btn: [r.top, r.bottom], dis: btn.disabled, log: (window as any).__log }
  })
  console.log('DBG', ms, JSON.stringify(info))
  }
  await context.close()
})
