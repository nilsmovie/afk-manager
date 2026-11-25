// Zeitleiste im Tagesbalken: links 0 Uhr, rechts 24 Uhr, Online-Zeiten an ihrer echten Uhrzeit,
// Ausfälle als Lücken. Übersteht einen Neustart (Phase 2 startet später am selben Tag, die Zeit
// dazwischen ist eine Lücke) und beginnt um Mitternacht neu.
const s = (h, m = 0) => h * 3600 + m * 60
const MIN = 60
module.exports = {
  name: 'Tageszeitleiste',
  phasen: 2,
  uhrzeit: [10, 13],
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [
      { id: 'zwei', name: 'Zwei', host: 'zwei.test', javaPort: 25565, bedrockPort: null, autoChatTemplate: [] },
    ] },
    'verbindungen.json': { version: 1, connections: [{ username: 'alpha', server: 'zwei', everJoined: true, autoChat: [] }] },
  },
  async run (t) {
    const acc = async (n) => (await t.liste()).find((a) => a.username === n)
    const conn = async (key) => {
      for (const a of await t.liste()) {
        const c = (a.connections || []).find((x) => x.key === key)
        if (c) return c
      }
      return null
    }
    const etwa = (a, b, tol = 3 * MIN) => Math.abs(a - b) <= tol
    const alleOnline = async () => (await acc('alpha')).status === 'online' && (await acc('bravo')).status === 'online' && ((await conn('alpha@zwei')) || {}).status === 'online'

    if (t.PHASE === 2) {
      t.chk('Neustart: Werte übernommen', t.logEnthaelt(/Online-Zeiten von heute übernommen/))
      let b = await acc('bravo')
      t.chk('Neustart (13 Uhr): bravo hat die zwei Zeiten von vorhin, bis zum letzten Speichern', b.timeline.length === 2 && etwa(b.timeline[0][0], s(10)) && etwa(b.timeline[1][0], s(11, 30), 5 * MIN) && b.timeline[1][1] < s(12, 5) && b.timeline[1][1] > s(11, 40), b.timeline)
      t.chk('Neustart: jetzt-Strich bei 13 Uhr', etwa(b.nowSec, s(13), 2 * MIN), b.nowSec)
      t.chk('Neustart: Verbindung @zwei auch übernommen', (await conn('alpha@zwei')).timeline.length === 1, (await conn('alpha@zwei')).timeline)
      t.chk('Neustart: alle wieder online', await t.alleEinloggenBis(alleOnline, 120000))
      await t.warte(10 * 60 * 1000)
      b = await acc('bravo')
      t.chk('Nach dem Neustart: dritte Zeit ab 13 Uhr, Lücke dazwischen', b.timeline.length === 3 && etwa(b.timeline[2][0], s(13), 3 * MIN) && b.timeline[2][0] - b.timeline[1][1] > 50 * MIN && etwa(b.timeline[2][1], b.nowSec, 2 * MIN), b.timeline)
      const a = await acc('alpha')
      t.chk('alpha: auch eine Lücke vom Neustart', a.timeline.length === 2 && a.timeline[1][0] - a.timeline[0][1] > 50 * MIN, a.timeline)

      // Mitternacht: Zeitleiste fängt neu an
      const m = new Date(t.zeit.jetzt()); m.setHours(23, 59, 50, 0)
      t.zeit.setze(m)
      t.chk('Tageszusammenfassung um 0:00', await t.warteBis(() => t.discord.nachrichten().some((x) => /Tageszusammenfassung/.test(t.discord.text(x))), 200000))
      await t.warte(3 * 60 * 1000)
      b = await acc('bravo')
      t.chk('Nach Mitternacht: nur noch die laufende Zeit ab 0 Uhr', b.timeline.length === 1 && b.timeline[0][0] < 2 * MIN && etwa(b.timeline[0][1], b.nowSec, 2 * MIN) && b.nowSec < 10 * MIN, b)
      return
    }

    // ---- Phase 1: 10 Uhr ----
    t.chk('Start: alle online', await t.alleEinloggenBis(alleOnline, 120000))
    t.chk('Noch nicht lange online: eine Zeit ab 10 Uhr', etwa((await acc('alpha')).timeline[0][0], s(10)), (await acc('alpha')).timeline)
    await t.warte(60 * 60 * 1000)
    await t.api('POST', '/api/stop/bravo')
    await t.warte(30 * 60 * 1000)
    let b = await acc('bravo')
    t.chk('Gestoppt: bravo hat eine abgeschlossene Zeit 10–11 Uhr', b.timeline.length === 1 && etwa(b.timeline[0][0], s(10)) && etwa(b.timeline[0][1], s(11)) && b.nowSec > s(11, 25), b.timeline)
    await t.api('POST', '/api/start/bravo')
    t.chk('bravo wieder online', await t.alleEinloggenBis(alleOnline, 120000))
    await t.warte(15 * 60 * 1000)

    // kurzer Wackler (unter einer Minute) gibt keine eigene Lücke
    const vorher = (await acc('alpha')).timeline.length
    t.javaBots.filter((x) => x.opts.host === 'mc.test' && x.username === 'alpha' && !x.beendet).pop().trennen()
    t.chk('alpha kurz weg', await t.warteBis(async () => (await acc('alpha')).status !== 'online', 5000))
    t.chk('...und nach Sekunden wieder da', await t.alleEinloggenBis(alleOnline, 50 * 1000))
    await t.warte(60 * 1000)

    const a = await acc('alpha')
    b = await acc('bravo')
    const c = await conn('alpha@zwei')
    t.chk('API: nowSec = Uhrzeit des Managers', etwa(a.nowSec, (() => { const d = new Date(t.zeit.jetzt()); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() })(), 2 * MIN), a.nowSec)
    t.chk('API: alpha am Stück seit 10 Uhr (kurzer Wackler zählt nicht als Lücke)', a.timeline.length === vorher && a.timeline.length === 1 && etwa(a.timeline[0][0], s(10)) && etwa(a.timeline[0][1], a.nowSec, MIN), a.timeline)
    t.chk('API: bravo zwei Zeiten mit Lücke 11–11:30', b.timeline.length === 2 && etwa(b.timeline[0][1], s(11)) && etwa(b.timeline[1][0], s(11, 30), 5 * MIN) && etwa(b.timeline[1][1], b.nowSec, MIN), b.timeline)
    t.chk('API: Verbindung @zwei hat eine eigene Zeitleiste', Array.isArray(c.timeline) && c.timeline.length === 1 && etwa(c.timeline[0][0], s(10)), c.timeline)
    const summe = b.timeline.reduce((x, [p, q]) => x + q - p, 0)
    t.chk('API: Summe der Zeiten passt zur Online-Zeit', Math.abs(summe * 1000 - b.uptimeMs) < 3 * 60 * 1000, { summe, ms: b.uptimeMs })

    // ---- Browser ----
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { chromium = null }
    if (chromium) {
      const ZR = Math.max(1, Number(process.env.TEST_ZEITRAFFER || 40))
      const browser = await chromium.launch()
      for (const [breite, touch] of [[1280, false], [390, true]]) {
        const ww = `(${breite}px)`
        const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
        const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
        const ctx = await browser.newContext({ viewport: { width: breite, height: 1100 }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch })
        await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
        const p = await ctx.newPage()
        const fehler = []
        p.on('pageerror', (err) => fehler.push(err.message))
        await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
        await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
        await p.waitForSelector('.account-row .uptime-bar .uptime-seg')
        const sel = (key) => `.uptime-bar[data-tl="${key}"]`
        const messen = async (key) => {
          // erst messen, wenn der Balken fertig gezeichnet ist (die Liste wird alle 30 s neu gebaut)
          await p.waitForFunction((s) => { const x = document.querySelector(s); return x && x.getBoundingClientRect().width > 50 }, sel(key), { timeout: 8000 * ZR })
          return p.$eval(sel(key), (bar) => {
          const r = bar.getBoundingClientRect()
          const rel = (el) => { const q = el.getBoundingClientRect(); return [(q.left - r.left) / r.width, q.width / r.width] }
          return {
            segs: [...bar.querySelectorAll('.uptime-seg')].map(rel),
            jetzt: (() => { const n = bar.querySelector('.uptime-now'); const q = n.getBoundingClientRect(); return (q.left + q.width / 2 - r.left) / r.width })(),
            vorbei: rel(bar.querySelector('.uptime-past'))[1],
            titel: bar.getAttribute('title'),
            offen: bar.getAttribute('aria-expanded'),
          }
          })
        }
        // erst messen, wenn die Liste fertig aufgebaut ist (Breite > 0)
        await p.waitForFunction(() => [...document.querySelectorAll('.uptime-bar')].every((x) => x.getBoundingClientRect().width > 50), null, { timeout: 8000 * ZR })
        const m = await messen('bravo')
        const nah = (x, y, tol = 0.006) => Math.abs(x - y) < tol
        t.chk(`${ww} bravo: zwei Stücke an der richtigen Uhrzeit`, m.segs.length === 2 && nah(m.segs[0][0], 10 / 24) && nah(m.segs[0][1], 1 / 24) && nah(m.segs[1][0], 11.5 / 24, 0.01), m)
        t.chk(`${ww} Lücke von ca. 11 bis 11:30 Uhr`, m.segs.length === 2 && nah(m.segs[1][0] - (m.segs[0][0] + m.segs[0][1]), 0.5 / 24, 0.01), m.segs)
        t.chk(`${ww} jetzt-Strich und "vorbei"-Bereich an der Uhrzeit`, nah(m.jetzt, b.nowSec / 86400, 0.01) && nah(m.vorbei, b.nowSec / 86400, 0.01) && nah(m.segs[1][0] + m.segs[1][1], m.jetzt, 0.01), m)
        t.chk(`${ww} Tooltip nennt die Uhrzeiten`, /^Online heute: 10:0\d–11:0\d, seit 11:[2-4]\d – zusammen \dh \d+m\. Balken = 0 bis 24 Uhr\.$/.test(m.titel), m.titel)
        const cm = await messen('alpha@zwei')
        t.chk(`${ww} Verbindung @zwei: eigene Zeitleiste`, cm.segs.length === 1 && nah(cm.segs[0][0], 10 / 24), cm)
        t.chk(`${ww} zugeklappt: keine Uhrzeiten-Liste`, m.offen === 'false' && await p.$eval('.uptime-detail[data-tl="bravo"]', (el) => el.hidden))

        // antippen/klicken -> Uhrzeiten aufklappen
        if (touch) await p.tap(sel('bravo'))
        else await p.click(sel('bravo'))
        const detail = () => p.$eval('.uptime-detail[data-tl="bravo"]', (el) => ({ sichtbar: !el.hidden && el.getBoundingClientRect().height > 0, text: el.textContent, skala: !document.querySelector('.uptime-scale[data-tl="bravo"]').hidden }))
        let d = await detail()
        t.chk(`${ww} aufgeklappt: Liste der Zeiten`, d.sichtbar && d.skala && /^Online: 10:0\d–11:0\d, seit 11:[2-4]\d$/.test(d.text.trim()), d)
        const skala = await p.$$eval('.uptime-scale[data-tl="bravo"] span', (els) => { const r = document.querySelector('.uptime-bar[data-tl="bravo"]').getBoundingClientRect(); return els.map((e) => { const q = e.getBoundingClientRect(); return [e.textContent, (q.left + q.width / 2 - r.left) / r.width] }) })
        t.chk(`${ww} 12 Uhr steht in der Mitte unter dem Balken`, skala.length === 5 && skala[2][0] === '12' && nah(skala[2][1], 0.5, 0.02) && nah(skala[1][1], 0.25, 0.02), skala)
        t.chk(`${ww} andere Accounts bleiben zu`, await p.$eval('.uptime-detail[data-tl="alpha"]', (el) => el.hidden))
        if (process.env.TEST_SCREENSHOTS) {
          await p.locator('.account-row', { hasText: 'bravo' }).first().screenshot({ path: `${process.env.TEST_SCREENSHOTS}/zeitleiste-${breite}.png` })
          await p.locator('.account-row', { hasText: 'alpha' }).first().screenshot({ path: `${process.env.TEST_SCREENSHOTS}/zeitleiste-verbindung-${breite}.png` })
          const vorher = await p.$eval('#themeSelect', (x) => x.value)
          await p.selectOption('#themeSelect', 'light')
          await p.locator('.account-row', { hasText: 'bravo' }).first().screenshot({ path: `${process.env.TEST_SCREENSHOTS}/zeitleiste-hell-${breite}.png` })
          await p.selectOption('#themeSelect', vorher)
        }
        // Liste wird neu gebaut (alle 30 s) -> bleibt aufgeklappt
        await p.evaluate(() => { document.querySelector('.uptime-bar[data-tl="bravo"]').__alt = true })
        await p.waitForFunction(() => !document.querySelector('.uptime-bar[data-tl="bravo"]').__alt, null, { timeout: 8000 * ZR })
        d = await detail()
        t.chk(`${ww} nach dem Neuaufbau noch offen`, d.sichtbar && (await messen('bravo')).offen === 'true', d)
        // Tastatur: Enter klappt wieder zu
        if (!touch) {
          await p.focus(sel('bravo'))
          await p.keyboard.press('Enter')
          t.chk(`${ww} Enter klappt zu`, !(await detail()).sichtbar && (await messen('bravo')).offen === 'false')
        } else {
          await p.tap(sel('bravo'))
          t.chk(`${ww} nochmal antippen klappt zu`, !(await detail()).sichtbar)
        }
        t.chk(`${ww} keine JS-Fehler`, fehler.length === 0, fehler)
        await ctx.close()
      }
      await browser.close()
    } else {
      console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)')
    }

    // gespeichert für Phase 2
    await t.warte(70 * 1000)
    const st = t.datei('statistik.json')
    t.chk('statistik.json: Version 2 mit Zeiten', st && st.version === 2 && st.segments && Array.isArray(st.segments.bravo) && st.segments.bravo.length === 2 && Array.isArray(st.segments['alpha@zwei']), st && st.segments)
    t.chk('statistik.json: Zeiten sind Zeitpunkte von heute', st && st.segments.bravo.every(([p, q]) => q > p && new Date(p).toDateString() === new Date(t.zeit.jetzt()).toDateString()), st && st.segments.bravo)
  },
}
