// Fenster, die im Spiel aufgehen (Kisten, Menüs von Plugins nach einem Befehl, Ofen ...):
// im Inventar-Widget ansehen (Titel und Item-Namen in Farbe, Beschreibung), links/rechts klicken,
// schließen (Knopf und Esc); Rechte und Protokoll; im Browser mit Maus und am Handy (Touch)
module.exports = {
  name: 'Fenster und Menüs',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  dateien: {
    'item-icons/de_de.json': JSON.stringify({ 'item.minecraft.compass': 'Kompass', 'block.minecraft.stone': 'Stein', 'item.minecraft.diamond': 'Diamant', 'block.minecraft.oak_log': 'Eichenstamm', 'item.minecraft.coal': 'Kohle' }),
  },
  async run (t) {
    t.chk('Alle online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 120000))
    const b = t.java('alpha')
    b.inventory.setzen(9, 'oak_log', 10)
    b.inventory.setzen(36, 'diamond', 3)
    const menue = () => b.fensterOeffnen('minecraft:generic_9x3', { text: 'Warps', color: 'dark_purple', bold: true }, {
      11: ['compass', 1, { name: { text: 'Spawn', color: 'gold', italic: false }, lore: [{ text: 'Klicke zum Teleportieren', color: 'gray' }, { text: '' }, { text: 'Spieler: ', color: 'gray', extra: [{ text: '12', color: 'green' }] }] }],
      13: ['stone', 32],
      15: ['arrow', 1, { name: { text: 'Nächste Seite', color: 'yellow' } }],
    })
    const klick = (body, als) => t.api('POST', '/api/inventory/alpha/window-click', body, als)

    // ---------- Ohne Fenster ----------
    let r = await t.api('GET', '/api/inventory/alpha')
    t.chk('Ohne Fenster: window = null', r.status === 200 && r.data.window === null && r.data.windowOpen === false, r.data.window)
    r = await klick({ windowId: 1, slot: 0, button: 0 })
    t.chk('Klick ohne Fenster: verständlicher Fehler', r.status === 400 && /kein Fenster/.test(r.data.error), r.data)

    // ---------- Menü eines Plugins (Kiste mit 3 Reihen) ----------
    let win = menue()
    r = await t.api('GET', '/api/inventory/alpha')
    let w = r.data.window
    t.chk('Fenster: Art, Nummer, Plätze', w && w.type === 'minecraft:generic_9x3' && w.id === win.id && w.inventoryStart === 27 && w.inventoryEnd === 63 && w.slots.length === 63, w && { type: w.type, id: w.id, n: w.slots.length })
    t.chk('Titel als Text und in Farbe (fett)', w.title.text === 'Warps' && w.title.segs && w.title.segs[0].c === '#AA00AA' && !!w.title.segs[0].b, w.title)
    const kompass = w.slots[11]
    t.chk('Item mit eigenem Namen (farbig) und deutschem Grundnamen', kompass.custom === 'Spawn' && kompass.label === 'Kompass' && kompass.customSegs && kompass.customSegs[0].c === '#FFAA00', kompass)
    t.chk('Beschreibung (Lore) mit Farben', kompass.lore && kompass.lore.length === 3 && kompass.lore[0].text === 'Klicke zum Teleportieren' && kompass.lore[2].text === 'Spieler: 12' && kompass.lore[2].segs.some((x) => x.t === '12' && x.c === '#55FF55'), kompass.lore)
    t.chk('Eigenes Inventar unten im Fenster', w.slots[27] && w.slots[27].name === 'oak_log' && w.slots[27].count === 10 && w.slots[54] && w.slots[54].name === 'diamond', [w.slots[27], w.slots[54]])
    t.chk('Nichts auf der Maus', w.cursor === null)

    // Prüfungen der Eingaben
    for (const [body, name, re] of [
      [{ windowId: w.id + 1, slot: 11, button: 0 }, 'anderes Fenster', /geändert/],
      [{ windowId: w.id, slot: 63, button: 0 }, 'Platz hinter dem Fenster', /Ungültiger Platz/],
      [{ windowId: w.id, slot: 500, button: 0 }, 'Platz 500', /Ungültiger Klick/],
      [{ windowId: w.id, slot: '11; x', button: 0 }, 'Text als Platz', /Ungültiger Klick/],
      [{ windowId: w.id, slot: 11, button: 2 }, 'Mittelklick', /Ungültiger Klick/],
      [{ windowId: 'x', slot: 11, button: 0 }, 'Fensternummer kein Zahl', /Ungültiger Klick/],
      [{ windowId: w.id, slot: -999, button: 0 }, 'außerhalb ohne Item auf der Maus', /nichts auf der Maus/],
    ]) {
      r = await klick(body)
      t.chk(`Abgelehnt: ${name}`, r.status === 400 && re.test(r.data.error || ''), r.data)
    }
    t.chk('Abgelehnte Klicks kommen nicht im Spiel an', b.klicks.length === 0, b.klicks)

    // Linksklick (wie im Spiel: Item hängt dann an der Maus, wenn der Server es zulässt)
    let gemeldet = []
    b.beimFensterKlick = (slot, button) => { gemeldet.push([slot, button]) }
    r = await klick({ windowId: w.id, slot: 11, button: 0 })
    t.chk('Linksklick kommt an', r.status === 200 && b.klicks.some((k) => k[0] === 11 && k[1] === 0 && k[2] === 0) && gemeldet.length === 1, [r.data, b.klicks])
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Item hängt an der Maus', w.cursor && w.cursor.name === 'compass' && w.cursor.custom === 'Spawn' && w.slots[11] === null, w.cursor)
    await klick({ windowId: w.id, slot: 12, button: 0 })
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Linksklick auf leeren Platz legt es ab', w.cursor === null && w.slots[12] && w.slots[12].name === 'compass')
    // Rechtsklick: halben Stapel nehmen, dann eins ablegen
    await klick({ windowId: w.id, slot: 13, button: 1 })
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Rechtsklick nimmt den halben Stapel', w.cursor && w.cursor.count === 16 && w.slots[13].count === 16, [w.cursor, w.slots[13]])
    await klick({ windowId: w.id, slot: 14, button: 1 })
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Rechtsklick legt eins ab', w.cursor && w.cursor.count === 15 && w.slots[14] && w.slots[14].count === 1)
    r = await klick({ windowId: w.id, slot: -999, button: 0 })
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Klick außerhalb wirft weg, was an der Maus hängt', r.status === 200 && w.cursor === null && b.klicks.some((k) => k[0] === -999), r.data)

    // Menü reagiert mit einer neuen Seite (neues Fenster)
    b.beimFensterKlick = (slot) => { if (slot === 15) b.fensterOeffnen('minecraft:generic_9x1', '§6Seite §l2', { 4: ['coal', 5] }) }
    await klick({ windowId: w.id, slot: 15, button: 0 })
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Neue Menüseite wird angezeigt', w && w.type === 'minecraft:generic_9x1' && w.slots.length === 45 && w.slots[4].label === 'Kohle', w && w.type)
    t.chk('Titel mit §-Farbcodes: Text ohne Codes, Farbe gold', w.title.text === 'Seite 2' && w.title.segs && w.title.segs.some((x) => x.c === '#FFAA00'), w.title)
    r = await klick({ windowId: win.id, slot: 4, button: 0 })
    t.chk('Klick fürs alte Fenster wird abgelehnt', r.status === 400 && /geändert/.test(r.data.error), r.data)

    // Ofen (übersetzter Titel)
    b.fensterOeffnen('minecraft:furnace', { translate: 'container.furnace' }, { 1: ['coal', 8] })
    w = (await t.api('GET', '/api/inventory/alpha')).data.window
    t.chk('Ofen: 3 Plätze, Titel übersetzt', w.type === 'minecraft:furnace' && w.inventoryStart === 3 && w.slots[1].name === 'coal' && w.title.text === 'Furnace', w.title)

    // Schließen
    r = await t.api('POST', '/api/inventory/alpha/window-close')
    t.chk('Schließen', r.status === 200 && r.data.wasOpen === true && b.currentWindow === null, r.data)
    r = await t.api('POST', '/api/inventory/alpha/window-close')
    t.chk('Schließen ohne Fenster: nichts passiert', r.status === 200 && r.data.wasOpen === false)
    t.chk('Danach wieder das normale Inventar', (await t.api('GET', '/api/inventory/alpha')).data.window === null)

    // Rechte und Protokoll
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['bravo'] })
    win = menue()
    t.chk('User: fremdes Fenster ansehen verboten', (await t.api('GET', '/api/inventory/alpha', undefined, 'paul')).status === 403)
    t.chk('User: im fremden Fenster klicken verboten', (await klick({ windowId: win.id, slot: 11, button: 0 }, 'paul')).status === 403)
    t.chk('User: fremdes Fenster schließen verboten', (await t.api('POST', '/api/inventory/alpha/window-close', {}, 'paul')).status === 403 && b.currentWindow === win)
    t.java('bravo').fensterOeffnen('minecraft:hopper', 'Trichter', {})
    r = await t.api('POST', '/api/inventory/bravo/window-click', { windowId: t.java('bravo').currentWindow.id, slot: 2, button: 0 }, 'paul')
    t.chk('User: im eigenen Fenster klicken erlaubt', r.status === 200, r.data)
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Klick mit Item und Fenster', e.some((x) => x.action === 'Klick im Fenster' && x.target === 'alpha' && /Linksklick auf 1× Spawn in „Warps“/.test(x.detail)), e.slice(0, 6))
    t.chk('Protokoll: Rechtsklick', e.some((x) => x.action === 'Klick im Fenster' && /Rechtsklick auf 32× Stein/.test(x.detail)))
    t.chk('Protokoll: Schließen', e.some((x) => x.action === 'Fenster geschlossen' && x.target === 'alpha'))
    t.chk('Protokoll: wer geklickt hat', e.some((x) => x.action === 'Klick im Fenster' && x.target === 'bravo' && x.who === 'paul'))

    // ---------- Im Browser ----------
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    const shot = process.env.TEST_SCREENSHOTS
    for (const [breite, touch] of [[1280, false], [390, true]]) {
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1300 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      win = menue()
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      const ww = `(${breite}px)`
      const offen = async () => p.evaluate(() => !document.getElementById('invWindow').hidden && document.getElementById('invNormal').hidden)
      let da = false
      for (let i = 0; i < 40 && !da; i++) { await p.waitForTimeout(100); da = await offen() }
      t.chk(`Browser ${ww}: Fenster statt Inventar`, da)
      t.chk(`Browser ${ww}: alle 63 Plätze (27 Menü + 36 Inventar)`, (await p.$$('#invWindow .slot[data-wslot]')).length === 63)
      t.chk(`Browser ${ww}: Titel in Farbe`, await p.$eval('#winTitle', (el) => el.textContent === 'Warps' && !!el.querySelector('span[style*="color"]')))
      t.chk(`Browser ${ww}: kein seitliches Scrollen`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= breite)
      const anzahl = b.klicks.length
      if (!touch) {
        await p.hover('#invWindow .slot[data-wslot="11"]')
        t.chk('Browser: Maus drüber zeigt Name und Beschreibung', /Spawn/.test(await p.textContent('#winDetail')) && /Klicke zum Teleportieren/.test(await p.textContent('#winDetail')) && (await p.$$('#winDetail button')).length === 0)
        t.chk('Browser: Beschreibung auch als Tooltip', /Klicke zum Teleportieren/.test(await p.getAttribute('#invWindow .slot[data-wslot="11"]', 'title')))
        if (shot) await p.locator('#invCard').screenshot({ path: `${shot}/fenster-breit.png` })
        await p.click('#invWindow .slot[data-wslot="13"]')
        await p.waitForTimeout(700)
        t.chk('Browser: Linksklick mit der Maus geht direkt', b.klicks.slice(anzahl).some((x) => x[0] === 13 && x[1] === 0), b.klicks.slice(anzahl))
        let maus = false
        for (let i = 0; i < 30 && !maus; i++) { maus = /Auf der Maus: 32× Stein/.test(await p.textContent('#winCursor')); if (!maus) await p.waitForTimeout(100) }
        t.chk('Browser: „Auf der Maus“ wird angezeigt', maus)
        await p.click('#invWindow .slot[data-wslot="20"]', { button: 'right' })
        await p.waitForTimeout(700)
        t.chk('Browser: Rechtsklick mit der Maus geht direkt', b.klicks.slice(anzahl).some((x) => x[0] === 20 && x[1] === 1), b.klicks.slice(anzahl))
        t.chk('Browser: Rechtsklick legt eins ab', b.currentWindow.slots[20] && b.currentWindow.slots[20].count === 1)
        // Wie Safari auf iPhone/iPad: nach einem Tippen meldet das Klick-Ereignis "mouse" -
        // trotzdem nur auswählen (Name/Beschreibung lesen), nicht klicken
        const vorIos = b.klicks.length
        await p.evaluate(() => {
          const el = document.querySelector('#invWindow .slot[data-wslot="11"]')
          el.dispatchEvent(new Event('touchstart', { bubbles: true }))
          el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }))
          el.dispatchEvent(new PointerEvent('click', { pointerType: 'mouse', bubbles: true }))
        })
        await p.waitForTimeout(200)
        const iosKnoepfe = await p.$$eval('#winDetail button', (els) => els.map((x) => x.textContent.trim()))
        t.chk('iPhone/iPad (Klick meldet "mouse"): nur auswählen, Name und Knöpfe', b.klicks.length === vorIos && iosKnoepfe.join() === 'Linksklick,Rechtsklick,Abbrechen' && /Spawn/.test(await p.textContent('#winDetail')) && /Klicke zum Teleportieren/.test(await p.textContent('#winDetail')), [b.klicks.slice(vorIos), iosKnoepfe])
        await p.click('#winDetail button:has-text("Abbrechen")')
        await p.focus('#invAccountSelect')
        await p.keyboard.press('Escape')
        await p.waitForTimeout(400)
        t.chk('Browser: Esc in einem Auswahlfeld schließt nichts', b.currentWindow === win)
        await p.evaluate(() => document.activeElement && document.activeElement.blur())
        await p.keyboard.press('Escape')
        await p.waitForTimeout(900)
        t.chk('Browser: Esc schließt das Fenster', b.currentWindow === null)
        // (die Ansicht wechselt erst mit dem nächsten Stand vom Server - darauf warten statt fester Pause)
        t.chk('Browser: danach wieder das normale Inventar', await p.waitForFunction(() => document.getElementById('invWindow').hidden && !document.getElementById('invNormal').hidden, null, { timeout: 8000 * Math.max(1, Number(process.env.TEST_ZEITRAFFER || 40)) }).then(() => true, () => false))
      } else {
        await p.tap('#invWindow .slot[data-wslot="11"]')
        await p.waitForTimeout(300)
        t.chk('Handy: Antippen klickt noch nicht', b.klicks.length === anzahl, b.klicks.slice(anzahl))
        const knoepfe = await p.$$eval('#winDetail button', (els) => els.map((x) => x.textContent.trim()))
        t.chk('Handy: Auswahl Linksklick / Rechtsklick / Abbrechen', knoepfe.join() === 'Linksklick,Rechtsklick,Abbrechen', knoepfe)
        t.chk('Handy: Beschreibung beim Auswählen', /Klicke zum Teleportieren/.test(await p.textContent('#winDetail')))
        if (shot) await p.locator('#invCard').screenshot({ path: `${shot}/fenster-handy.png` })
        await p.tap('#winDetail button:has-text("Abbrechen")')
        await p.waitForTimeout(200)
        t.chk('Handy: Abbrechen', (await p.$$('#winDetail button')).length === 0 && b.klicks.length === anzahl)
        await p.tap('#invWindow .slot[data-wslot="13"]')
        await p.tap('#winDetail button:has-text("Rechtsklick")')
        await p.waitForTimeout(700)
        // auf die Anzeige im Browser warten (echte Zeit; die Timer dieses Tests laufen im Zeitraffer)
        const zr = Math.max(1, Number(process.env.TEST_ZEITRAFFER || 40))
        const mausText = await p.waitForFunction(() => /Auf der Maus: 16× Stein/.test(document.getElementById('winCursor').textContent), null, { timeout: 5000 * zr }).then(() => true).catch(() => false)
        t.chk('Handy: Rechtsklick über den Knopf', b.klicks.slice(anzahl).some((x) => x[0] === 13 && x[1] === 1) && mausText, b.klicks.slice(anzahl))
        await p.tap('#invWindow .slot[data-wslot="22"]')
        t.chk('Handy: leerer Platz mit Item auf der Maus: Ablegen möglich', /Leerer Platz/.test(await p.textContent('#winDetail')) && /ganzen Stapel ab/.test(await p.textContent('#winDetail')))
        await p.tap('#winDetail button:has-text("Linksklick")')
        await p.waitForTimeout(700)
        t.chk('Handy: Linksklick über den Knopf legt ab', b.currentWindow.slots[22] && b.currentWindow.slots[22].count === 16 && !b.currentWindow.selectedItem)
        // Handy/Tablet ohne Maus: auch ein Klick-Ereignis, das "mouse" meldet, wählt nur aus
        const vorHandy = b.klicks.length
        await p.evaluate(() => document.querySelector('#invWindow .slot[data-wslot="11"]').dispatchEvent(new PointerEvent('click', { pointerType: 'mouse', bubbles: true })))
        await p.waitForTimeout(200)
        t.chk('Handy: Klick meldet "mouse" -> trotzdem nur auswählen', b.klicks.length === vorHandy && (await p.$$('#winDetail button')).length === 3, b.klicks.slice(vorHandy))
        await p.tap('#winDetail button:has-text("Abbrechen")')
        await p.tap('#winCloseBtn')
        await p.waitForTimeout(900)
        t.chk('Handy: Schließen-Knopf', b.currentWindow === null)
      }
      t.chk(`Browser ${ww}: keine JS-Fehler`, fehler.length === 0, fehler)
      await ctx.close()
    }
    await browser.close()
  },
}
