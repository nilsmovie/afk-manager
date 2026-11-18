// Bewegung: Dimension, Welt, Koordinaten und Blickrichtung des ausgewählten Accounts; Umrechnung
// Oberwelt <-> Nether; Koordinaten kopieren; das Inventar wird beim Laufen nicht neu gezeichnet
module.exports = {
  name: 'Position in der Bewegung',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  async run (t) {
    t.chk('Alle online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 120000))
    const b = t.java('alpha')
    const setze = (x, y, z, yaw, dim, welt) => {
      b.entity.position = { x, y, z, distanceTo: () => 1 }
      b.entity.yaw = yaw
      b.game = { dimension: dim }
      if (welt !== undefined) b._client.emit('respawn', { worldState: { name: welt, dimension: 0 } })
    }
    setze(123.7, 64, -45.2, 0, 'overworld', 'minecraft:overworld')
    b.inventory.setzen(36, 'stone', 5)
    let d = (await t.api('GET', '/api/inventory/alpha')).data
    t.chk('API: Koordinaten (gerundet) und Blickrichtung', d.position && d.position.x === 123.7 && d.position.y === 64 && d.position.z === -45.2 && d.position.yaw === 0, d.position)
    t.chk('API: Dimension und Welt', d.dimension && d.dimension.type === 'overworld' && d.dimension.world === 'overworld', d.dimension)
    b.game = { dimension: '<script>alert(1)</script>' }
    d = (await t.api('GET', '/api/inventory/alpha')).data
    t.chk('API: komische Dimensionsnamen werden verworfen', d.dimension && d.dimension.type === null, d.dimension)
    setze(123.7, 64, -45.2, 0, 'overworld')
    t.java('bravo').entity.position = { x: 1, y: 2, z: 3 }
    t.java('bravo').game = { dimension: 'the_end' }
    t.chk('Login-Paket (1.20.5+): Weltname gemerkt', (() => { t.java('bravo')._client.emit('login', { worldState: { name: 'minecraft:the_end' } }); return t.java('bravo').__afkWorld === 'the_end' })())

    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    const shot = process.env.TEST_SCREENSHOTS
    for (const [breite, touch] of [[1280, false], [390, true]]) {
      setze(123.7, 64, -45.2, 0, 'overworld', 'minecraft:overworld')
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1100 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${process.env.PORT}` })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      const ww = `(${breite}px)`
      await p.selectOption('#controlAccountSelect', 'alpha')
      const box = async () => (await p.textContent('#posBox')) || ''
      // Im Browser warten: Die Seite fragt in echter Zeit alle 1,5 s nach, die Timer dieses Tests
      // (auch die Zeitlimits von Playwright) laufen aber im Zeitraffer -> Zeitlimit hochrechnen
      const ZR = Math.max(1, Number(process.env.TEST_ZEITRAFFER || 40))
      const zeigt = (ja, nein = []) => p.waitForFunction(([j, n]) => {
        const txt = (document.getElementById('posBox') || {}).textContent || ''
        return j.every((r) => new RegExp(r).test(txt)) && !n.some((r) => new RegExp(r).test(txt))
      }, [ja.map((r) => r.source), nein.map((r) => r.source)], { timeout: 8000 * ZR }).then(() => true).catch(() => false)
      const bis = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 8000 * ZR }).then(() => true).catch(() => false)
      t.chk(`${ww} Oberwelt mit Koordinaten (Blockkoordinaten wie F3)`, await zeigt([/🌍 Oberwelt/, /X 123 · Y 64 · Z −46/]), await box())
      t.chk(`${ww} Blickrichtung Norden`, /Blick: Norden \(−Z\)/.test(await box()), await box())
      t.chk(`${ww} Umrechnung in den Nether`, /Im Nether wäre das X 15 · Z −6/.test(await box()), await box())
      if (shot) await p.locator('#posBox').screenshot({ path: `${shot}/position-${breite}.png` })

      // Inventar wird beim Laufen nicht neu gezeichnet
      await p.waitForSelector('#invMain .slot, #invHotbar .slot')
      await p.evaluate(() => { document.querySelector('#invHotbar .slot').dataset.merker = '1' })
      setze(130, 64, -40, -Math.PI / 2, 'overworld')
      t.chk(`${ww} Laufen: Koordinaten und Blick ändern sich`, await zeigt([/X 130 · Y 64 · Z −40/, /Blick: Osten \(\+X\)/]), await box())
      t.chk(`${ww} Laufen: Inventar bleibt, wie es ist (nicht neu gezeichnet)`, await p.evaluate(() => document.querySelector('#invHotbar .slot').dataset.merker === '1'))
      b.inventory.setzen(37, 'dirt', 3)
      t.chk(`${ww} Inventar ändert sich: wird neu gezeichnet`, await bis(() => !document.querySelector('#invHotbar .slot').dataset.merker))
      b.inventory.setzen(37, null)

      // Nether
      setze(10, 70, -3, Math.PI, 'the_nether', 'minecraft:the_nether')
      t.chk(`${ww} Nether mit Umrechnung in die Oberwelt`, await zeigt([/🔥 Nether/, /X 10 · Y 70 · Z −3/, /In der Oberwelt wäre das X 80 · Z −24/]), await box())
      t.chk(`${ww} Blickrichtung Süden`, /Blick: Süden \(\+Z\)/.test(await box()), await box())
      // eigene Welt (z.B. Lobby): Name, keine Umrechnung
      setze(0.5, 100, 0.5, Math.PI / 2, 'overworld', 'minecraft:hub')
      t.chk(`${ww} Eigene Welt: Name, keine Umrechnung`, await zeigt([/Welt: hub/, /Blick: Westen \(−X\)/], [/wäre das/]), await box())
      setze(5, 60, 5, 0, 'the_end', 'minecraft:the_end')
      t.chk(`${ww} Ende`, await zeigt([/🌌 Ende/, /X 5 · Y 60 · Z 5/], [/Welt:/]), await box())

      // Kopieren
      if (touch) await p.tap('#posBox .pos-coords')
      else await p.click('#posBox .pos-coords')
      t.chk(`${ww} Kopieren: Rückmeldung`, await zeigt([/Kopiert ✓/]))
      t.chk(`${ww} Kopieren: in der Zwischenablage`, (await p.evaluate(() => navigator.clipboard.readText())) === '5 60 5')
      t.chk(`${ww} Danach wieder Koordinaten`, await zeigt([/X 5 · Y 60 · Z 5/]))

      // anderer Account, dann offline
      await p.selectOption('#controlAccountSelect', 'bravo')
      t.chk(`${ww} Anderer Account: seine Position`, await zeigt([/🌌 Ende/, /X 1 · Y 2 · Z 3/]), await box())
      await t.api('POST', '/api/stop/bravo')
      t.chk(`${ww} Offline: keine Position`, await bis(() => document.getElementById('posBox').hidden))
      await t.api('POST', '/api/start/bravo')
      await t.alleEinloggenBis(async () => (await t.status('bravo')) === 'online', 60000)
      t.java('bravo').entity.position = { x: 1, y: 2, z: 3 }
      t.java('bravo').game = { dimension: 'the_end' }

      t.chk(`${ww} kein seitliches Scrollen`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= breite)
      t.chk(`${ww} keine JS-Fehler`, fehler.length === 0, fehler)
      await ctx.close()
    }
    await browser.close()
  },
}
