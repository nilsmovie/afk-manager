// Balken der heutigen Online-Zeit: ganzer Balken = 24 Stunden (vorher war er schon nach 8 h voll)
const heute = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
const H = 60 * 60 * 1000
module.exports = {
  name: 'Tagesbalken',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }, { username: 'charlie', everJoined: true }],
  dateien: {
    'statistik.json': { version: 1, day: heute, savedAt: Date.now(), summarySentFor: null, totals: { alpha: 12 * H, bravo: 6 * H, charlie: 0 } },
  },
  async run (t) {
    t.chk('Werte von heute übernommen', t.logEnthaelt(/Online-Zeiten von heute übernommen/))
    // gestoppt lassen, damit die Zeiten stehen bleiben
    for (const n of ['alpha', 'bravo', 'charlie']) await t.api('POST', `/api/stop/${n}`)
    const liste = await t.liste()
    t.chk('API: alpha 12 h, bravo 6 h', liste.find((a) => a.username === 'alpha').uptimeMs === 12 * H && liste.find((a) => a.username === 'bravo').uptimeMs === 6 * H, liste.map((a) => [a.username, a.uptimeMs]))

    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
    const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 2 })
    await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
    const p = await ctx.newPage()
    const fehler = []
    p.on('pageerror', (err) => fehler.push(err.message))
    await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
    await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
    await p.waitForSelector('.uptime-bar')
    const balken = await p.$$eval('.uptime-bar', (els) => els.map((b) => {
      const f = b.querySelector('.uptime-fill')
      return { anteil: f.getBoundingClientRect().width / b.getBoundingClientRect().width, titel: b.getAttribute('title'), text: b.parentElement.textContent.trim() }
    }))
    const von = (n) => balken.find((b) => b.text === (n === 'alpha' ? '12h 0m heute' : n === 'bravo' ? '6h 0m heute' : '0m heute'))
    t.chk('alpha: 12 h = halber Balken', von('alpha') && Math.abs(von('alpha').anteil - 0.5) < 0.02, balken)
    t.chk('bravo: 6 h = Viertel', von('bravo') && Math.abs(von('bravo').anteil - 0.25) < 0.02, balken)
    t.chk('charlie: 0 = leer', von('charlie') && von('charlie').anteil < 0.01, balken)
    t.chk('Tooltip erklärt den Balken', von('alpha') && /^12h 0m von 24 Stunden online \(50 %\)$/.test(von('alpha').titel), von('alpha') && von('alpha').titel)
    t.chk('Text rechts bleibt ("… heute")', /12h 0m heute/.test(von('alpha').text))
    if (process.env.TEST_SCREENSHOTS) await p.locator('.uptime-row').first().screenshot({ path: `${process.env.TEST_SCREENSHOTS}/tagesbalken.png` })
    t.chk('keine JS-Fehler', fehler.length === 0, fehler)
    await browser.close()
  },
}
