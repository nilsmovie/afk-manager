// Tagesbalken mit einer statistik.json von vor der Zeitleiste (nur Summen, keine Uhrzeiten):
// die Zeit wird am Stück bis zum letzten Speichern eingezeichnet, die Summe rechts bleibt genau.
const heute = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
const H = 60 * 60 * 1000
const gespeichert = (() => { const d = new Date(); d.setHours(19, 59, 0, 0); return d.getTime() })()
module.exports = {
  name: 'Tagesbalken (alte statistik.json)',
  uhrzeit: 20,
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }, { username: 'charlie', everJoined: true }],
  dateien: {
    'statistik.json': { version: 1, day: heute, savedAt: gespeichert, summarySentFor: null, totals: { alpha: 12 * H, bravo: 6 * H, charlie: 0 } },
  },
  async run (t) {
    t.chk('Werte von heute übernommen', t.logEnthaelt(/Online-Zeiten von heute übernommen/))
    // gestoppt lassen, damit die Zeiten stehen bleiben
    for (const n of ['alpha', 'bravo', 'charlie']) await t.api('POST', `/api/stop/${n}`)
    const liste = await t.liste()
    const acc = (n) => liste.find((a) => a.username === n)
    t.chk('API: alpha 12 h, bravo 6 h', acc('alpha').uptimeMs === 12 * H && acc('bravo').uptimeMs === 6 * H, liste.map((a) => [a.username, a.uptimeMs]))
    const s = (h, m) => h * 3600 + m * 60
    t.chk('API: alpha am Stück 7:59–19:59', JSON.stringify(acc('alpha').timeline) === JSON.stringify([[s(7, 59), s(19, 59)]]), acc('alpha').timeline)
    t.chk('API: bravo am Stück 13:59–19:59', JSON.stringify(acc('bravo').timeline) === JSON.stringify([[s(13, 59), s(19, 59)]]), acc('bravo').timeline)
    t.chk('API: charlie ohne Zeiten', Array.isArray(acc('charlie').timeline) && acc('charlie').timeline.length === 0, acc('charlie').timeline)

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
    await p.waitForSelector('.account-row .uptime-bar')
    const balken = await p.$$eval('.account-row > .uptime-row', (rows) => rows.map((r) => {
      const b = r.querySelector('.uptime-bar').getBoundingClientRect()
      const segs = [...r.querySelectorAll('.uptime-seg')].map((x) => { const q = x.getBoundingClientRect(); return [(q.left - b.left) / b.width, q.width / b.width] })
      return { segs, titel: r.querySelector('.uptime-bar').getAttribute('title'), text: r.querySelector('.uptime-text').textContent.trim() }
    }))
    const von = (n) => balken.find((b) => b.text === (n === 'alpha' ? '12h 0m heute' : n === 'bravo' ? '6h 0m heute' : '0m heute'))
    const nah = (a, b) => Math.abs(a - b) < 0.01
    t.chk('alpha: ab 8 Uhr, halber Balken', von('alpha') && von('alpha').segs.length === 1 && nah(von('alpha').segs[0][0], 7.983 / 24) && nah(von('alpha').segs[0][1], 0.5), balken)
    t.chk('bravo: ab 14 Uhr, Viertel', von('bravo') && von('bravo').segs.length === 1 && nah(von('bravo').segs[0][0], 13.983 / 24) && nah(von('bravo').segs[0][1], 0.25), balken)
    t.chk('charlie: leer', von('charlie') && von('charlie').segs.length === 0, balken)
    t.chk('Tooltip nennt die Uhrzeiten', von('alpha') && /^Online heute: 7:59–19:59 – zusammen 12h 0m\. Balken = 0 bis 24 Uhr\.$/.test(von('alpha').titel), von('alpha') && von('alpha').titel)
    t.chk('Tooltip ohne Zeiten', von('charlie') && /^Heute noch nicht online/.test(von('charlie').titel), von('charlie') && von('charlie').titel)
    t.chk('Text rechts bleibt ("… heute")', /12h 0m heute/.test(von('alpha').text))
    t.chk('keine JS-Fehler', fehler.length === 0, fehler)
    await browser.close()
  },
}
