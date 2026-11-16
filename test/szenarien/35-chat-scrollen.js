// Chat im Dashboard: Wer hochgescrollt ist, wird von neuen Nachrichten nicht nach unten geworfen;
// stattdessen erscheint "↓ N neue Nachrichten". Unten läuft der Chat wie gewohnt mit.
module.exports = {
  name: 'Chat hochscrollen',
  accounts: [{ username: 'alpha', everJoined: true }],
  async run (t) {
    await t.alleEinloggenBis(async () => (await t.status('alpha')) === 'online', 60000)
    const b = t.java('alpha')
    for (let i = 1; i <= 60; i++) b.chatEmpfangen(`Spieler${i}: Nachricht Nummer ${i}`, { text: `Spieler${i}: Nachricht Nummer ${i}` })
    await t.warte(2000)

    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    for (const [breite, touch] of [[1280, false], [390, true]]) {
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1000 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      const ww = `(${breite}px)`
      await p.waitForFunction(() => document.querySelectorAll('#chatlog .chat-line').length >= 60, null, { timeout: 8000 })
      const lage = () => p.evaluate(() => {
        const el = document.getElementById('chatlog')
        const btn = document.getElementById('chatNewBtn')
        return { top: el.scrollTop, unten: el.scrollHeight - el.scrollTop - el.clientHeight < 40, knopf: btn.hidden ? null : btn.textContent }
      })
      const warteBis = async (fn) => { for (let i = 0; i < 40; i++) { if (await fn()) return true; await p.waitForTimeout(100) } return false }
      let l = await lage()
      t.chk(`${ww} Am Anfang unten`, l.unten && l.knopf === null, l)

      // unten: läuft mit
      b.chatEmpfangen('unten: läuft mit', { text: 'unten: läuft mit' })
      t.chk(`${ww} Unten: neue Nachricht, bleibt unten`, await warteBis(async () => /läuft mit/.test(await p.textContent('#chatlog')) && (await lage()).unten && (await lage()).knopf === null))

      // hochscrollen
      await p.evaluate(() => { document.getElementById('chatlog').scrollTop = 200 })
      await p.waitForTimeout(150)
      const oben = (await lage()).top
      b.chatEmpfangen('neu 1', { text: 'neu 1' })
      b.chatEmpfangen('neu 2', { text: 'neu 2' })
      b.chatEmpfangen('neu 3', { text: 'neu 3' })
      t.chk(`${ww} Hochgescrollt: Knopf mit Anzahl`, await warteBis(async () => (await lage()).knopf === '↓ 3 neue Nachrichten'), await lage())
      if (process.env.TEST_SCREENSHOTS) await p.locator('.chatlog-wrap').screenshot({ path: `${process.env.TEST_SCREENSHOTS}/chat-knopf-${breite}.png` })
      l = await lage()
      t.chk(`${ww} Hochgescrollt: Stelle bleibt`, Math.abs(l.top - oben) <= 2 && !l.unten, { l, oben })
      // Farbschema wechseln: Stelle bleibt auch
      await p.selectOption('#themeSelect', await p.$eval('#themeSelect', (s) => [...s.options].map((o) => o.value).find((x) => x !== s.value)))
      await p.waitForTimeout(200)
      l = await lage()
      t.chk(`${ww} Farbschema wechseln: Stelle bleibt`, Math.abs(l.top - oben) <= 2, { l, oben })
      // Knopf
      if (touch) await p.tap('#chatNewBtn')
      else await p.click('#chatNewBtn')
      await p.waitForTimeout(150)
      l = await lage()
      t.chk(`${ww} Knopf: nach unten, Knopf weg`, l.unten && l.knopf === null, l)

      // hochscrollen, dann selbst runterscrollen -> Knopf weg
      await p.evaluate(() => { document.getElementById('chatlog').scrollTop = 100 })
      await p.waitForTimeout(150)
      b.chatEmpfangen('neu 4', { text: 'neu 4' })
      t.chk(`${ww} 1 neue Nachricht`, await warteBis(async () => (await lage()).knopf === '↓ 1 neue Nachricht'))
      await p.evaluate(() => { const el = document.getElementById('chatlog'); el.scrollTop = el.scrollHeight })
      t.chk(`${ww} Selbst nach unten gescrollt: Knopf weg`, await warteBis(async () => (await lage()).knopf === null))

      // eigene Nachricht senden -> nach unten
      await p.evaluate(() => { document.getElementById('chatlog').scrollTop = 0 })
      await p.waitForTimeout(150)
      await p.fill('#chatInput', 'hallo von mir')
      await p.press('#chatInput', 'Enter')
      t.chk(`${ww} Eigene Nachricht: nach unten`, await warteBis(async () => (await lage()).unten))
      t.chk(`${ww} keine JS-Fehler`, fehler.length === 0, fehler)
      await ctx.close()
    }
    await browser.close()
  },
}
