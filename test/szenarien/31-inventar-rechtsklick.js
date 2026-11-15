// Rechtsklick im eigenen Inventar wie im Spiel: halben Stapel an die Maus nehmen, mit Links-/
// Rechtsklick alles bzw. eins ablegen, zurücklegen, wegwerfen; andere Aktionen legen das Item an
// der Maus vorher zurück; Prüfungen, Rechte, Protokoll; im Browser mit Maus und Touch
module.exports = {
  name: 'Rechtsklick im Inventar',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  dateien: {
    'item-icons/de_de.json': JSON.stringify({ 'block.minecraft.stone': 'Stein', 'block.minecraft.dirt': 'Erde', 'item.minecraft.diamond': 'Diamant' }),
  },
  async run (t) {
    t.chk('Alle online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 120000))
    const b = t.java('alpha')
    const inv = b.inventory
    const klick = (slot, button, als) => t.api('POST', '/api/inventory/alpha/click', { slot, button }, als)
    const holen = async () => (await t.api('GET', '/api/inventory/alpha')).data

    inv.setzen(10, 'stone', 32)
    inv.setzen(13, 'dirt', 5)
    let d = await holen()
    t.chk('Anfangs nichts an der Maus', d.cursor === null, d.cursor)

    // Rechtsklick: Hälfte
    let r = await klick(10, 1)
    d = await holen()
    t.chk('Rechtsklick nimmt den halben Stapel', r.status === 200 && d.cursor && d.cursor.count === 16 && d.cursor.label === 'Stein' && d.slots[10].count === 16, [r.data, d.cursor, d.slots[10]])
    t.chk('Klick geht wie im Spiel raus (Rechtsklick, normaler Klick)', b.klicks.some((k) => k[0] === 10 && k[1] === 1 && k[2] === 0))
    r = await klick(11, 1)
    d = await holen()
    t.chk('Rechtsklick auf leeren Platz legt eins ab', d.slots[11] && d.slots[11].count === 1 && d.cursor.count === 15)
    r = await klick(12, 0)
    d = await holen()
    t.chk('Linksklick legt den Rest ab', d.slots[12] && d.slots[12].count === 15 && d.cursor === null)
    await klick(13, 1)
    d = await holen()
    t.chk('Ungerade Anzahl: wie im Spiel die größere Hälfte an die Maus', d.cursor && d.cursor.count === 3 && d.slots[13].count === 2, [d.cursor, d.slots[13]])
    r = await t.api('POST', '/api/inventory/alpha/cursor-back')
    d = await holen()
    t.chk('Zurücklegen: zurück auf den Platz, von dem es kam', r.status === 200 && d.cursor === null && d.slots[13].count === 5, d.slots[13])

    // Andere Aktion mit Item an der Maus: erst zurücklegen
    await klick(10, 1)
    d = await holen()
    t.chk('Wieder halbiert', d.cursor && d.cursor.count === 8)
    r = await t.api('POST', '/api/inventory/alpha/move', { from: 12, to: 20 })
    d = await holen()
    t.chk('Verschieben legt das Item an der Maus vorher zurück', r.status === 200 && d.cursor === null && d.slots[10].count === 16 && d.slots[20] && d.slots[20].count === 15, [r.data, d.slots[10], d.slots[20]])

    // Wegwerfen (außerhalb klicken)
    await klick(11, 0)
    r = await klick(-999, 0)
    d = await holen()
    t.chk('Klick außerhalb wirft das Item an der Maus weg', r.status === 200 && d.cursor === null && !d.slots[11], r.data)

    // Prüfungen
    for (const [body, name] of [
      [{ slot: 46, button: 0 }, 'Platz 46'],
      [{ slot: -1, button: 0 }, 'Platz -1'],
      [{ slot: '10x', button: 1 }, 'Text als Platz'],
      [{ slot: 10, button: 2 }, 'Mittelklick'],
      [{ button: 1 }, 'ohne Platz'],
    ]) {
      r = await t.api('POST', '/api/inventory/alpha/click', body)
      t.chk(`Abgelehnt: ${name}`, r.status === 400 && /Ungültiger Klick/.test(r.data.error || ''), r.data)
    }
    r = await klick(-999, 0)
    t.chk('Außerhalb ohne Item an der Maus: verständlicher Fehler', r.status === 400 && /nichts auf der Maus/.test(r.data.error), r.data)
    b.fensterOeffnen('minecraft:generic_9x1', 'Kiste', {})
    r = await klick(10, 1)
    t.chk('Mit offenem Fenster: Hinweis aufs Fenster', r.status === 400 && /Fenster offen/.test(r.data.error), r.data)
    await t.api('POST', '/api/inventory/alpha/window-close')

    // Kein Platz zum Zurücklegen
    for (let i = 9; i <= 44; i++) inv.setzen(i, 'stone', 64)
    inv.selectedItem = { ...inv.slots[9], name: 'dirt', type: b.registry.itemsByName.dirt.id, count: 3 }
    r = await t.api('POST', '/api/inventory/alpha/cursor-back')
    t.chk('Kein Platz: verständlicher Fehler', r.status === 400 && /Kein Platz frei/.test(r.data.error), r.data)
    inv.selectedItem = null
    for (let i = 9; i <= 44; i++) inv.setzen(i, null)

    // Rechte und Protokoll
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['bravo'] })
    t.chk('User: fremdes Inventar klicken verboten', (await klick(10, 1, 'paul')).status === 403)
    t.chk('User: fremdes Zurücklegen verboten', (await t.api('POST', '/api/inventory/alpha/cursor-back', {}, 'paul')).status === 403)
    t.java('bravo').inventory.setzen(9, 'diamond', 4)
    r = await t.api('POST', '/api/inventory/bravo/click', { slot: 9, button: 1 }, 'paul')
    t.chk('User: eigenes Inventar erlaubt', r.status === 200 && t.java('bravo').inventory.selectedItem && t.java('bravo').inventory.selectedItem.count === 2, r.data)
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Rechtsklick mit Item', e.some((x) => x.action === 'Klick im Inventar' && x.target === 'alpha' && /Rechtsklick auf 32× Stein/.test(x.detail)), e.slice(0, 5))
    t.chk('Protokoll: Wegwerfen', e.some((x) => x.action === 'Klick im Inventar' && /außerhalb/.test(x.detail)))
    t.chk('Protokoll: wer', e.some((x) => x.action === 'Klick im Inventar' && x.target === 'bravo' && x.who === 'paul'))

    // ---------- Im Browser ----------
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    const shot = process.env.TEST_SCREENSHOTS
    for (const [breite, touch] of [[1280, false], [390, true]]) {
      inv.selectedItem = null
      for (let i = 9; i <= 44; i++) inv.setzen(i, null)
      inv.setzen(10, 'stone', 32)
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1300 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      const ww = `(${breite}px)`
      await p.waitForSelector('#invNormal .slot[data-slot="10"] .cnt', { timeout: 8000 })
      const sel = (n) => `#invNormal .slot[data-slot="${n}"]`
      const warte = async (fn) => { for (let i = 0; i < 30; i++) { if (await fn()) return true; await p.waitForTimeout(100) } return false }
      if (!touch) {
        await p.click(sel(10), { button: 'right' })
        t.chk('Browser: Rechtsklick mit der Maus nimmt die Hälfte', await warte(() => inv.selectedItem && inv.selectedItem.count === 16 && inv.slots[10].count === 16))
        t.chk('Browser: „Auf der Maus“ wird angezeigt', await warte(async () => /Auf der Maus: 16× Stein/.test(await p.textContent('#invCursor'))))
        t.chk('Browser: kein Kontextmenü-Ersatz nötig (Detail bleibt zu)', (await p.$$('#invDetail button')).length === 0)
        if (shot) await p.locator('#invCard').screenshot({ path: `${shot}/rechtsklick-breit.png` })
        await p.click(sel(20), { button: 'right' })
        t.chk('Browser: Rechtsklick auf leeren Platz legt eins ab', await warte(() => inv.slots[20] && inv.slots[20].count === 1 && inv.selectedItem && inv.selectedItem.count === 15))
        await p.waitForTimeout(300)
        await p.click(sel(21))
        t.chk('Browser: Linksklick legt den Rest ab', await warte(() => inv.slots[21] && inv.slots[21].count === 15 && !inv.selectedItem))
        t.chk('Browser: Anzeige wieder leer', await warte(async () => (await p.textContent('#invCursor')).trim() === ''))
        await p.click(sel(10), { button: 'right' })
        await warte(() => inv.selectedItem)
        await warte(async () => /Auf der Maus/.test(await p.textContent('#invCursor')))
        await p.click('#invCursor button:has-text("Zurücklegen")')
        t.chk('Browser: Zurücklegen-Knopf', await warte(() => !inv.selectedItem && inv.slots[10].count === 16))
      } else {
        await p.tap(sel(10))
        await p.waitForTimeout(200)
        t.chk('Handy: Antippen wählt aus, mit „Hälfte nehmen“', (await p.$$eval('#invDetail button', (els) => els.map((x) => x.textContent.trim()))).includes('Hälfte nehmen'))
        await p.tap('#invDetail button:has-text("Hälfte nehmen")')
        t.chk('Handy: Hälfte an der Maus', await warte(() => inv.selectedItem && inv.selectedItem.count === 16))
        t.chk('Handy: Anzeige „Auf der Maus“', await warte(async () => /Auf der Maus: 16× Stein/.test(await p.textContent('#invCursor'))))
        await p.tap(sel(20))
        await p.waitForTimeout(200)
        const kn = await p.$$eval('#invDetail button', (els) => els.map((x) => x.textContent.trim()))
        t.chk('Handy: leerer Platz -> Alles ablegen / Eins ablegen / Abbrechen', kn.join() === 'Alles ablegen,Eins ablegen,Abbrechen', kn)
        t.chk('Handy: Antippen allein legt noch nichts ab', !inv.slots[20])
        if (shot) await p.locator('#invCard').screenshot({ path: `${shot}/rechtsklick-handy.png` })
        await p.tap('#invDetail button:has-text("Eins ablegen")')
        t.chk('Handy: Eins ablegen', await warte(() => inv.slots[20] && inv.slots[20].count === 1 && inv.selectedItem && inv.selectedItem.count === 15))
        await warte(async () => /15× Stein/.test(await p.textContent('#invCursor')))
        await p.tap(sel(21))
        await p.waitForTimeout(200)
        await p.tap('#invDetail button:has-text("Alles ablegen")')
        t.chk('Handy: Alles ablegen', await warte(() => inv.slots[21] && inv.slots[21].count === 15 && !inv.selectedItem))
      }
      t.chk(`Browser ${ww}: kein seitliches Scrollen`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= breite)
      t.chk(`Browser ${ww}: keine JS-Fehler`, fehler.length === 0, fehler)
      await ctx.close()
    }
    await browser.close()
  },
}
