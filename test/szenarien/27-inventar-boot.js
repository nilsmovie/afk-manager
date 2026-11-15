// Inventar (ansehen, verschieben, droppen, in die Hand, craften), Item-Bilder/deutsche Namen
// aus "npm run bilder", Rechte und Protokoll; Boot fahren mit nachgebauter Boots-Physik
// Gültiges 2x2-PNG (selbst erzeugt, kein Spielbild)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8DwnwEIGBkYGRgAAA4FAgBpJ1nAAAAAAElFTkSuQmCC', 'base64')
module.exports = {
  name: 'Inventar und Boot',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }, { username: '.bed', everJoined: true }],
  dateien: {
    'item-icons/de_de.json': JSON.stringify({ 'item.minecraft.diamond_sword': 'Diamantschwert', 'block.minecraft.oak_log': 'Eichenstamm', 'block.minecraft.oak_planks': 'Eichenholzbretter', 'enchantment.minecraft.sharpness': 'Schärfe', 'enchantment.minecraft.mending': 'Reparatur', 'item.minecraft.bread': 'Brot' }),
    'item-icons/item/diamond_sword.png': PNG,
    'item-icons/block/oak_log.png': Buffer.concat([PNG, Buffer.from('LOG')]),
  },
  async run (t) {
    t.chk('Alle online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 120000))
    const b = t.java('alpha')
    const inv = b.inventory
    inv.setzen(36, 'diamond_sword', 1, { durabilityUsed: 400, enchants: [{ name: 'sharpness', lvl: 5 }], customName: '{"text":"Excalibur","italic":false}' })
    inv.setzen(9, 'oak_log', 10)
    inv.setzen(5, 'diamond_helmet', 1)
    inv.setzen(40, 'oak_log', 3)

    // Ansehen
    let r = await t.api('GET', '/api/inventory/alpha')
    const s = r.data.slots
    t.chk('Inventar: 46 Plätze', r.status === 200 && s.length === 46, r.data)
    t.chk('Deutscher Name, eigener Name, Haltbarkeit, Verzauberung', s[36].label === 'Diamantschwert' && s[36].custom === 'Excalibur' && s[36].durability.left === 1161 && s[36].enchants[0].name === 'sharpness', s[36])
    t.chk('Ohne Übersetzung: englischer Name', s[5].label === 'Diamond Helmet', s[5])
    t.chk('Hand, Leben, Hunger, Bilder', r.data.quickBar === 0 && r.data.health === 20 && r.data.food === 18 && typeof r.data.icons === 'number' && r.data.icons > 0 && r.data.inBoat === false)

    // Bilder
    const bild = await t.api('GET', '/item-icons/diamond_sword')
    t.chk('Bild aus item/', bild.status === 200 && /PNG/.test(String(bild.data)) && !/LOG/.test(String(bild.data)))
    t.chk('Block-Bild als Ersatz', /LOG/.test(String((await t.api('GET', '/item-icons/oak_log')).data)))
    t.chk('Unbekanntes Bild: 404', (await t.api('GET', '/item-icons/gibtsnicht')).status === 404)
    t.chk('Pfad-Tricks: 404', (await t.api('GET', '/item-icons/..%2F..%2Fusers.json')).status === 404 && (await t.api('GET', '/item-icons/a.b%5C..%5Cusers')).status === 404)
    t.chk('Bilder nur mit Anmeldung', (await fetch(`http://127.0.0.1:${process.env.PORT}/item-icons/diamond_sword`, { redirect: 'manual' })).status === 302)

    // Verschieben
    r = await t.api('POST', '/api/inventory/alpha/move', { from: 9, to: 20 })
    t.chk('Verschieben', r.status === 200 && !inv.slots[9] && inv.slots[20].name === 'oak_log', r.data)
    r = await t.api('POST', '/api/inventory/alpha/move', { from: 40, to: 20 })
    t.chk('Gleiche Items stapeln', inv.slots[20].count === 13 && !inv.slots[40])
    for (const [body, name] of [[{ from: 9, to: 21 }, 'leerer Platz'], [{ from: 20, to: 0 }, 'aufs Ergebnis'], [{ from: 20, to: 99 }, 'Platz 99'], [{ from: '20; x', to: 1 }, 'Text'], [{ from: 20, to: 20 }, 'gleicher Platz']]) {
      t.chk(`Verschieben abgelehnt: ${name}`, (await t.api('POST', '/api/inventory/alpha/move', body)).status === 400)
    }
    b.currentWindow = { id: 3 }
    await t.api('POST', '/api/inventory/alpha/move', { from: 5, to: 30 })
    t.chk('Offenes Fenster wird vorher geschlossen', b.currentWindow === null && inv.slots[30].name === 'diamond_helmet')

    // In die Hand
    r = await t.api('POST', '/api/inventory/alpha/hold', { slot: 38 })
    t.chk('In die Hand (Schnellleiste 3)', r.status === 200 && b.quickBarSlot === 2)
    t.chk('In die Hand nur Schnellleiste', (await t.api('POST', '/api/inventory/alpha/hold', { slot: 20 })).status === 400)

    // Droppen
    r = await t.api('POST', '/api/inventory/alpha/drop', { slot: 20, all: false })
    t.chk('1 droppen (wie Q)', r.status === 200 && inv.slots[20].count === 12 && b.klicks.some((k) => k[0] === 20 && k[1] === 0 && k[2] === 4))
    r = await t.api('POST', '/api/inventory/alpha/drop', { slot: 30, all: true })
    t.chk('Stapel droppen (wie Strg+Q)', r.status === 200 && !inv.slots[30])
    t.chk('Droppen von leerem Platz abgelehnt', (await t.api('POST', '/api/inventory/alpha/drop', { slot: 30 })).status === 400)

    // Craften
    r = await t.api('GET', '/api/inventory/alpha/recipes')
    const namen = (r.data.items || []).map((x) => x.name)
    t.chk('Rezepte ohne Werkbank: Bretter ja, Kiste nein', r.status === 200 && r.data.table === false && namen.includes('oak_planks') && !namen.includes('chest'), r.data)
    t.chk('Wie oft (12 Stämme -> bis 12×)', r.data.items.find((x) => x.name === 'oak_planks').maxTimes === 12 && r.data.items.find((x) => x.name === 'oak_planks').label === 'Eichenholzbretter')
    const planks = r.data.items.find((x) => x.name === 'oak_planks').id
    r = await t.api('POST', '/api/inventory/alpha/craft', { item: planks, times: 3 })
    t.chk('Craften 3×', r.status === 200 && r.data.count === 12 && inv.count(planks) === 12 && inv.slots[20].count === 9, r.data)
    t.chk('Craften: Anzahl geprüft', (await t.api('POST', '/api/inventory/alpha/craft', { item: planks, times: 0 })).status === 400 && (await t.api('POST', '/api/inventory/alpha/craft', { item: 999999, times: 1 })).status === 400)
    b.werkbank = true
    r = await t.api('GET', '/api/inventory/alpha/recipes')
    t.chk('Mit Werkbank in Reichweite: Kiste', r.data.table === true && r.data.items.some((x) => x.name === 'chest'), r.data)
    const chest = r.data.items.find((x) => x.name === 'chest').id
    r = await t.api('POST', '/api/inventory/alpha/craft', { item: chest, times: 1 })
    t.chk('Kiste gecraftet', r.status === 200 && inv.count(chest) === 1)
    b.werkbank = false
    r = await t.api('POST', '/api/inventory/alpha/craft', { item: chest, times: 1 })
    t.chk('Ohne Werkbank: verständlicher Fehler', r.status === 400 && /Werkbank/.test(r.data.error), r.data)

    // Rechte und Protokoll
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })
    t.chk('User: eigenes Inventar', (await t.api('GET', '/api/inventory/alpha', undefined, 'paul')).status === 200)
    t.chk('User: fremdes Inventar verboten', (await t.api('GET', '/api/inventory/bravo', undefined, 'paul')).status === 403 && (await t.api('POST', '/api/inventory/bravo/drop', { slot: 9 }, 'paul')).status === 403)
    t.chk('Bedrock: klare Meldung', /Bedrock/.test((await t.api('GET', '/api/inventory/.bed')).data.error || ''))
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Droppen mit Item', e.some((x) => x.action === 'Item gedroppt' && x.target === 'alpha' && /1× Eichenstamm/.test(x.detail)), e.slice(0, 8))
    t.chk('Protokoll: Craften', e.some((x) => x.action === 'Gecraftet' && /12× Eichenholzbretter/.test(x.detail)))

    // ---------- Verzauberungen (alle Formate), leere Hand, Essen, Rechtsklick halten ----------
    const reg = b.registry
    const comp = (type, list) => new Map([[type, { type, data: { enchantments: list, showTooltip: true } }]])
    inv.setzen(37, 'diamond_pickaxe', 1, { enchants: { enchantments: [{ id: reg.enchantmentsByName.efficiency.id, level: 4 }, { id: reg.enchantmentsByName.mending.id, level: 1 }], showTooltip: true }, componentMap: comp('enchantments', [{ id: reg.enchantmentsByName.efficiency.id, level: 4 }, { id: reg.enchantmentsByName.mending.id, level: 1 }]) })
    inv.setzen(10, 'enchanted_book', 1, { enchants: { enchantments: [], showTooltip: true }, componentMap: comp('stored_enchantments', [{ id: reg.enchantmentsByName.sharpness.id, level: 3 }]) })
    inv.setzen(11, 'bread', 3)
    inv.setzen(12, 'golden_apple', 1)
    r = await t.api('GET', '/api/inventory/alpha')
    const lbl = (i) => (r.data.slots[i] ? r.data.slots[i].enchants.map((e) => e.label) : [])
    t.chk('Verzauberung (alte Form) mit deutschem Namen und Stufe', lbl(36).join() === 'Schärfe V', lbl(36))
    t.chk('Verzauberung (ab 1.20.5, Komponente): Stufe, "Reparatur" ohne I', lbl(37).join() === 'Efficiency IV,Reparatur', lbl(37))
    t.chk('Verzaubertes Buch: gespeicherte Verzauberung', lbl(10).join() === 'Schärfe III', lbl(10))
    t.chk('Essbar markiert', r.data.slots[11].edible === true && !r.data.slots[20].edible)
    r = await t.api('POST', '/api/inventory/alpha/hold', { slot: 41 })
    t.chk('Leeren Schnellleisten-Platz in die Hand nehmen', r.status === 200 && b.quickBarSlot === 5)
    b.food = 14
    r = await t.api('POST', '/api/inventory/alpha/eat', { slot: 11 })
    t.chk('Essen aus dem Inventar: in die Hand und gegessen', r.status === 200 && b.steuerung.some((x) => x[0] === 'consume' && x[1] === 'bread') && inv.slots[41] && inv.slots[41].count === 2 && !inv.slots[11], r.data)
    b.food = 20
    r = await t.api('POST', '/api/inventory/alpha/eat', { slot: 41 })
    t.chk('Satt: verständliche Meldung', r.status === 400 && /satt/.test(r.data.error), r.data)
    r = await t.api('POST', '/api/inventory/alpha/eat', { slot: 12 })
    t.chk('Goldener Apfel geht auch satt', r.status === 200, r.data)
    t.chk('Nicht Essbares abgelehnt', (await t.api('POST', '/api/inventory/alpha/eat', { slot: 37 })).status === 400)
    r = await t.api('POST', '/api/control/alpha/rightclick', { hold: true })
    t.chk('Rechtsklick gedrückt: Item benutzen', r.status === 200 && b.steuerung.some((x) => x[0] === 'activate'), r.data)
    await t.api('POST', '/api/control/alpha/rightclick-release')
    t.chk('Rechtsklick losgelassen: Benutzen beenden', b.steuerung.filter((x) => x[0] === 'deactivate').length === 1)
    await t.api('POST', '/api/control/alpha/rightclick-release')
    t.chk('Loslassen ohne Drücken: nichts', b.steuerung.filter((x) => x[0] === 'deactivate').length === 1)
    await t.api('POST', '/api/inventory/alpha/hold', { slot: 38 })

    // ---------- Boot ----------
    // Wasser bis y=61, darüber Luft; bei z >= 6 eine Steinwand
    b.welt = (x, y, z) => {
      if (z >= 6 && y >= 62) return { name: 'stone', boundingBox: 'block' }
      if (y <= 61) return { name: 'water', boundingBox: 'empty' }
      return { name: 'air', boundingBox: 'empty' }
    }
    b.vehicle = { id: 77, name: 'oak_boat', position: { x: 0.5, y: 62, z: 0.5 }, yaw: Math.PI } // Blick nach Süden (+z)
    r = await t.api('GET', '/api/inventory/alpha')
    t.chk('Inventar meldet: im Boot', r.data.inBoat === true && r.data.vehicle === 'oak_boat')
    const fahrten = () => b.geschrieben.filter((p) => p[0] === 'vehicle_move')
    r = await t.api('POST', '/api/control/alpha/move', { direction: 'forward', state: true })
    t.chk('Bewegung im Boot geht ans Boot', r.status === 200 && r.data.boat === true && !b.steuerung.some((x) => x[0] === 'forward'), r.data)
    await t.warte(1500) // 30 Takte
    const f = fahrten()
    t.chk('Boot fährt (Positionen an den Server)', f.length >= 10 && f[f.length - 1][1].z > 2 && Math.abs(f[f.length - 1][1].x - 0.5) < 0.01, f.slice(-2))
    t.chk('Paddel und Eingaben gemeldet', b.geschrieben.some((p) => p[0] === 'steer_boat' && p[1].leftPaddle && p[1].rightPaddle) && b.vehicleEingaben.some((x) => x[1] === 1))
    t.chk('Wasser: Höchstgeschwindigkeit wie im Spiel (≤ 0,4 pro Takt)', f.every((p, i) => i === 0 || Math.abs(p[1].z - f[i - 1][1].z) <= 0.41))
    await t.warte(2000)
    const vorWand = fahrten()[fahrten().length - 1][1].z
    t.chk('An der Wand bleibt es stehen', vorWand < 6 && vorWand > 4.5, vorWand)
    await t.api('POST', '/api/control/alpha/move', { direction: 'forward', state: false })
    await t.api('POST', '/api/control/alpha/move', { direction: 'right', state: true })
    await t.warte(1000)
    await t.api('POST', '/api/control/alpha/move', { direction: 'right', state: false })
    const gedreht = fahrten()[fahrten().length - 1][1].yaw
    t.chk('D lenkt nach rechts', gedreht > 5, gedreht)
    await t.warte(3000)
    const n = fahrten().length
    await t.warte(1000)
    t.chk('Ohne Taste kommt es zur Ruhe (keine Pakete mehr)', fahrten().length === n)
    // Server setzt das Boot zurück -> übernehmen
    await t.api('POST', '/api/control/alpha/move', { direction: 'back', state: true })
    b._client.emit('vehicle_move', { x: 10.5, y: 62, z: 1.5, yaw: 0, pitch: 0 })
    await t.warte(300)
    await t.api('POST', '/api/control/alpha/move', { direction: 'back', state: false })
    const last = fahrten()[fahrten().length - 1][1]
    t.chk('Korrektur vom Server übernommen', Math.abs(last.x - 10.5) < 0.5 && Math.abs(last.z - 1.5) < 0.5, last)
    // Aussteigen
    let ausgestiegen = false
    b.dismount = () => { ausgestiegen = true; b.vehicle = null }
    await t.api('POST', '/api/control/alpha/dismount')
    t.chk('Absteigen', ausgestiegen)
    r = await t.api('POST', '/api/control/alpha/move', { direction: 'forward', state: true })
    t.chk('Ohne Boot: normale Bewegung', r.data.boat !== true && b.steuerung.some((x) => x[0] === 'forward' && x[1] === true))
    await t.api('POST', '/api/control/alpha/move', { direction: 'forward', state: false })

    // ---------- Im Browser ----------
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    const shot = process.env.TEST_SCREENSHOTS
    for (const breite of [1280, 390]) {
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1100 }, deviceScaleFactor: 1 })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (e) => fehler.push(e.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      await p.waitForTimeout(2500)
      const w = `(${breite}px)`
      t.chk(`Browser ${w}: keine JS-Fehler`, fehler.length === 0, fehler)
      t.chk(`Browser ${w}: zwei Widgets (Bewegung, Inventar)`, (await p.$$eval('h2', (els) => els.map((e) => e.textContent.trim()))).filter((x) => x === 'Bewegung' || x === 'Inventar').length === 2)
      t.chk(`Browser ${w}: Inventar mit allen Plätzen`, (await p.$$eval('#invBody .slot[data-slot]', (els) => els.filter((e) => Number(e.dataset.slot) >= 0).length)) === 46,
        await p.evaluate(() => ({ status: document.getElementById('invStatus').textContent, hidden: document.getElementById('invBody').hidden, sel: document.getElementById('invAccountSelect').value, ctrl: document.getElementById('controlAccountSelect').value, opts: document.getElementById('invAccountSelect').options.length })))
      t.chk(`Browser ${w}: echtes Bild fürs Schwert, Symbol als Ersatz`, (await p.$$('#invBody img[data-name="diamond_sword"]')).length === 1 && (await p.$$('#invBody .slot .sym')).length >= 1)
      t.chk(`Browser ${w}: Auswahl beim Inventar folgt der Bewegung`, await p.$eval('#invAccountSelect', (el) => el.value) === await p.$eval('#controlAccountSelect', (el) => el.value))
      t.chk(`Browser ${w}: kein seitliches Scrollen`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= breite)
      if (breite === 1280) {
        // Auswählen, Details, Verschieben per Klick
        await p.click('#invBody .slot[data-slot="36"]')
        t.chk('Browser: Details zum Item', /Excalibur/.test(await p.$eval('#invDetail', (el) => el.textContent)) && /Diamantschwert/.test(await p.$eval('#invDetail', (el) => el.textContent)))
        await p.click('#invBody .slot[data-slot="44"]')
        await p.waitForTimeout(800)
        t.chk('Browser: Klick auf anderen Platz verschiebt', inv.slots[44] && inv.slots[44].name === 'diamond_sword' && !inv.slots[36])
        await p.click('#invBody .slot[data-slot="44"]')
        t.chk('Browser: Verzauberungen im Detail', /Schärfe V/.test(await p.$eval('#invDetail', (el) => el.textContent)))
        await p.click('#invDetail button:has-text("Abwählen")')
        b.food = 10
        await p.click('#invBody .slot[data-slot="12"]') // Brot (wurde vom goldenen Apfel dorthin getauscht)
        t.chk('Browser: Essen-Knopf bei Essen', (await p.$$('#invDetail button:has-text("Essen")')).length === 1)
        await p.click('#invDetail button:has-text("Essen")')
        await p.waitForTimeout(800)
        t.chk('Browser: Essen klappt (in die Hand und gegessen)', inv.slots[38] && inv.slots[38].name === 'bread' && inv.slots[38].count === 1, inv.slots[38])
        await p.click('#invBody .slot[data-slot="43"]') // leer
        await p.waitForTimeout(800)
        t.chk('Browser: leeren Schnellleisten-Platz anklicken = in die Hand', b.quickBarSlot === 7, b.quickBarSlot)
        // Rezepte
        await p.click('#invRecipesBtn')
        await p.waitForTimeout(800)
        t.chk('Browser: Rezeptliste', /Eichenholzbretter/.test(await p.$eval('#invRecipes', (el) => el.textContent)))
        let kaputt = -1
        for (let i = 0; i < 30 && kaputt !== 0; i++) {
          await p.waitForTimeout(100)
          kaputt = await p.$$eval('#invRecipes img', (els) => els.filter((x) => x.complete && x.naturalWidth === 0).length)
        }
        t.chk('Browser: fehlendes Bild in der Rezeptliste wird zum Symbol', kaputt === 0, kaputt)
        if (shot) await p.locator('#invCard').screenshot({ path: `${shot}/inventar-breit.png` })
        if (shot) await p.locator('.cat-control-row').screenshot({ path: `${shot}/bewegung.png` })
        // Droppen mit Nachfrage
        await p.click('#invBody .slot[data-slot="20"]')
        await p.click('#invDetail button:has-text("Alle")')
        await p.waitForTimeout(300)
        await p.click('.msg-box button:has-text("Droppen")')
        await p.waitForTimeout(800)
        t.chk('Browser: Stapel droppen nach Nachfrage', !inv.slots[20])
      } else if (shot) {
        await p.locator('#invCard').screenshot({ path: `${shot}/inventar-handy.png` })
      }
      await ctx.close()
    }
    await browser.close()
  },
}
