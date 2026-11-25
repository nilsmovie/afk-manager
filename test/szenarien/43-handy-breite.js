// Handy: Das Dashboard passt in die Bildschirmbreite (gleicher Rand links und rechts), auch mit
// mehreren Servern, langen Servernamen, Chat-Quelle, Auto-Chat und Bedrock-Account.
const accounts = [
  { username: 'NilsMovie', everJoined: true, autoChat: [{ text: '/afk', delaySeconds: 600 }] },
  { username: '.NilsMovie8', everJoined: true },
]
for (let i = 2; i <= 8; i++) accounts.push({ username: `NilsMovieAlt${i}`, everJoined: true })
module.exports = {
  name: 'Handy: Dashboard passt in die Breite',
  accounts,
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [
      { id: 'steal', name: 'Steal a Spawner', host: 'steal.test', javaPort: 25565, bedrockPort: 19132, autoChatTemplate: [] },
      { id: 'hugo', name: 'HugoSMP', host: 'hugo.test', javaPort: 25565, bedrockPort: null, autoChatTemplate: [] },
    ] },
    'verbindungen.json': { version: 1, connections: [
      { username: 'NilsMovie', server: 'steal', everJoined: true, autoChat: [{ text: '/spawner', delaySeconds: 600 }] },
      { username: 'NilsMovie', server: 'hugo', everJoined: true, autoChat: [] },
      { username: 'NilsMovieAlt2', server: 'steal', everJoined: true, autoChat: [] },
    ] },
  },
  async run (t) {
    await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online' && (a.connections || []).every((c) => c.status === 'online')), 300000)
    let playwright
    try { playwright = require('playwright') } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const { chromium, devices } = playwright
    const browser = await chromium.launch()
    const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
    const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
    for (const [name, opts] of [['iPhone 13', { ...devices['iPhone 13'] }], ['iPhone 13 mini', { ...devices['iPhone 13 Mini'] }], ['Handy schmal (360px)', { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['iPhone SE', { ...devices['iPhone SE'] }]]) {
      delete opts.defaultBrowserType
      const ctx = await browser.newContext(opts)
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      await p.waitForSelector('.conn-row .uptime-bar')
      await p.waitForTimeout(300)
      const lage = await p.evaluate(() => {
        const w = document.documentElement.clientWidth
        const karten = [...document.querySelectorAll('.card')].filter((c) => c.offsetParent).map((c) => { const r = c.getBoundingClientRect(); return { id: c.id || c.querySelector('h2')?.textContent?.trim().slice(0, 30), links: Math.round(r.left), rechts: Math.round(w - r.right) } })
        // Elemente, die über den rechten Rand ihrer Karte hinausragen (die schuldigen "Blätter")
        const zuBreit = [...document.querySelectorAll('.card *')].filter((e) => {
          const r = e.getBoundingClientRect(); const c = e.closest('.card').getBoundingClientRect()
          return r.width > 0 && r.right > c.right - 1 && ![...e.children].some((x) => x.getBoundingClientRect().right > c.right - 1)
        }).slice(0, 8).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)} "${(e.textContent || '').trim().slice(0, 25)}" w=${Math.round(e.getBoundingClientRect().width)}`)
        return { breite: w, seite: document.scrollingElement.scrollWidth, karten, zuBreit }
      })
      t.chk(`${name}: nichts ragt seitlich heraus`, lage.seite <= lage.breite, lage)
      t.chk(`${name}: Karten mit gleichem Rand links und rechts`, lage.karten.length > 0 && lage.karten.every((c) => Math.abs(c.links - c.rechts) <= 1 && c.links >= 8), lage.karten)
      t.chk(`${name}: nichts steht über den Kartenrand`, lage.zuBreit.length === 0, lage.zuBreit)
      const kopf = await p.$$eval('.conn-head', (els) => els.map((h) => { const r = h.getBoundingClientRect(); const z = h.closest('.conn-row').getBoundingClientRect(); return { passt: r.right <= z.right + 0.5, name: h.querySelector('.conn-server').textContent } }))
      t.chk(`${name}: Server-Zeilen (Name, Chat-Quelle, Auto-Chat, Status) passen in ihren Kasten`, kopf.length >= 3 && kopf.every((x) => x.passt), kopf)
      // Status bleibt lesbar ("online" ganz zu sehen), gekürzt wird zuerst der Servername
      const st = await p.$$eval('.conn-head .status-text', (els) => els.map((e) => ({ text: e.textContent, ganz: e.scrollWidth <= e.clientWidth + 1 })))
      if (name !== 'iPhone SE') t.chk(`${name}: Status der Server-Zeilen ungekürzt`, st.length >= 3 && st.every((x) => x.ganz), st)
      // Knöpfe einer Server-Zeile in einer Reihe (nur ganz schmale Handys dürfen umbrechen)
      const reihen = await p.$$eval('.conn-row .account-buttons', (els) => els.map((ab) => new Set([...ab.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))).size))
      if (name !== 'iPhone SE') t.chk(`${name}: Knöpfe der Server-Zeilen in einer Reihe`, reihen.length >= 3 && reihen.every((n) => n === 1), reihen)
      // Online-Zeit der Server-Zeile steht jetzt rechts neben ihrem Balken (wie beim Account)
      const zeit = await p.$$eval('.conn-tl .uptime-text', (els) => els.map((e) => e.textContent))
      t.chk(`${name}: Online-Zeit neben dem Balken der Server-Zeile`, zeit.length >= 3 && zeit.every((x) => /^\d+(h \d+)?m heute$/.test(x)), zeit)
      if (process.env.TEST_SCREENSHOTS) {
        await p.screenshot({ path: `${process.env.TEST_SCREENSHOTS}/handy-breite-${name.replace(/\W+/g, '-')}.png` })
        await p.locator('.account-row').first().screenshot({ path: `${process.env.TEST_SCREENSHOTS}/handy-breite-account-${name.replace(/\W+/g, '-')}.png` })
      }
      t.chk(`${name}: keine JS-Fehler`, fehler.length === 0, fehler)
      await ctx.close()
    }
    await browser.close()
  },
}
