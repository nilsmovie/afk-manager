// "npm run bilder" mit einer nachgebauten Spieldatei (.jar): Items ohne eigenes Bild bekommen
// über die Modelle des Spiels ein Bild (Stufen, verzauberter goldener Apfel), Truhen und Betten
// ein gebautes Bild; animierte Texturen nur das erste Bild. Danach liefert der Manager die Bilder.
// Alle Bilder hier sind selbst erzeugte Farbflächen - keine Bilder aus Minecraft.
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const { spawnSync } = require('child_process')
const png = require('../../tools/png-klein')

function flaeche (w, h, rgb, extra) {
  const img = png.create(w, h)
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = (rgb >> 16) & 255; img.data[i * 4 + 1] = (rgb >> 8) & 255; img.data[i * 4 + 2] = rgb & 255; img.data[i * 4 + 3] = 255
  }
  if (extra) extra(img)
  return png.encode(img)
}
function malen (img, x, y, w, h, rgb) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const o = (j * img.width + i) * 4
      img.data[o] = (rgb >> 16) & 255; img.data[o + 1] = (rgb >> 8) & 255; img.data[o + 2] = rgb & 255; img.data[o + 3] = 255
    }
  }
}
function pixel (buf, x, y) {
  const img = png.decode(buf)
  const o = (y * img.width + x) * 4
  return (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2]
}

// Minimales ZIP (ungepackt bzw. deflate) - eine .jar ist ein ZIP
function zipBauen (dateien) {
  const lokal = []
  const zentral = []
  let off = 0
  for (const [name, inhalt0] of Object.entries(dateien)) {
    const inhalt = Buffer.isBuffer(inhalt0) ? inhalt0 : Buffer.from(typeof inhalt0 === 'string' ? inhalt0 : JSON.stringify(inhalt0))
    const gepackt = zlib.deflateRawSync(inhalt)
    const n = Buffer.from(name)
    const crc = png.crc32(inhalt)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8)
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(gepackt.length, 18); h.writeUInt32LE(inhalt.length, 22); h.writeUInt16LE(n.length, 26)
    lokal.push(h, n, gepackt)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(gepackt.length, 20); c.writeUInt32LE(inhalt.length, 24); c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(off, 42)
    zentral.push(c, n)
    off += 30 + n.length + gepackt.length
  }
  const z = Buffer.concat(zentral)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(dateien).length, 8); e.writeUInt16LE(Object.keys(dateien).length, 10)
  e.writeUInt32LE(z.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...lokal, z, e])
}

const T = 'assets/minecraft/textures/'
const M = 'assets/minecraft/models/'
const I = 'assets/minecraft/items/'
const APFEL = flaeche(16, 16, 0xffcc00)
const BRETTER = flaeche(16, 16, 0xa07040)
const TRUHE = flaeche(64, 64, 0x223344, (img) => malen(img, 1, 1, 2, 4, 0xffd700)) // Schloss golden
const BETT = flaeche(64, 64, 0x000000, (img) => { malen(img, 6, 6, 16, 16, 0xeeeeee); malen(img, 6, 28, 16, 16, 0xcc2222) })
const JAR = {
  [`${T}item/golden_apple.png`]: APFEL,
  [`${T}item/tipped_arrow_head.png`]: flaeche(16, 16, 0x808080),
  [`${T}item/tipped_arrow_base.png`]: flaeche(16, 16, 0x553311),
  [`${T}block/oak_planks.png`]: BRETTER,
  [`${T}block/magma.png`]: flaeche(16, 48, 0xff5500, (img) => malen(img, 0, 16, 16, 32, 0x000000)),
  [`${T}block/magma.png.mcmeta`]: { animation: { frametime: 8 } },
  [`${T}entity/chest/ender.png`]: TRUHE,
  [`${T}entity/bed/red.png`]: BETT,
  [`${M}item/generated.json`]: { parent: 'builtin/generated' },
  [`${M}item/golden_apple.json`]: { parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/golden_apple' } },
  [`${M}item/enchanted_golden_apple.json`]: { parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/golden_apple' } },
  [`${M}item/tipped_arrow.json`]: { parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/tipped_arrow_head', layer1: 'minecraft:item/tipped_arrow_base' } },
  [`${M}block/slab.json`]: { textures: { particle: '#side' } },
  [`${M}block/oak_slab.json`]: { parent: 'minecraft:block/slab', textures: { bottom: 'minecraft:block/oak_planks', top: 'minecraft:block/oak_planks', side: 'minecraft:block/oak_planks' } },
  [`${M}block/cube_all.json`]: { textures: { particle: '#all' } },
  [`${M}block/magma_block.json`]: { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/magma' } },
  [`${M}item/ender_chest.json`]: { textures: { particle: 'minecraft:block/obsidian' } },
  [`${I}golden_apple.json`]: { model: { type: 'minecraft:model', model: 'minecraft:item/golden_apple' } },
  [`${I}enchanted_golden_apple.json`]: { model: { type: 'minecraft:model', model: 'minecraft:item/enchanted_golden_apple' } },
  [`${I}tipped_arrow.json`]: { model: { type: 'minecraft:model', model: 'minecraft:item/tipped_arrow', tints: [] } },
  [`${I}oak_slab.json`]: { model: { type: 'minecraft:model', model: 'minecraft:block/oak_slab' } },
  [`${I}magma_block.json`]: { model: { type: 'minecraft:model', model: 'minecraft:block/magma_block' } },
  [`${I}ender_chest.json`]: { model: { type: 'minecraft:special', base: 'minecraft:item/ender_chest', model: { type: 'minecraft:chest', texture: 'minecraft:ender' } } },
  [`${I}red_bed.json`]: { model: { type: 'minecraft:special', base: 'minecraft:item/red_bed', model: { type: 'minecraft:bed', texture: 'minecraft:red' } } },
  [`${I}compass.json`]: { model: { type: 'minecraft:condition', property: 'x', on_true: { type: 'minecraft:model', model: 'minecraft:item/x' }, on_false: { type: 'minecraft:select', cases: [], fallback: { type: 'minecraft:model', model: 'minecraft:block/oak_slab' } } } },
}

module.exports = {
  name: 'Item-Bilder über die Modelle',
  accounts: [{ username: 'alpha', everJoined: true }],
  async run (t) {
    t.chk('Online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 60000))
    t.chk('Ohne Bilder: 404', (await t.api('GET', '/item-icons/oak_slab')).status === 404)
    let r = await t.api('GET', '/api/inventory/alpha')
    t.chk('Ohne Bilder: icons = 0', r.data.icons === 0, r.data.icons)

    // Werkzeug mit der nachgebauten Spieldatei laufen lassen
    const home = process.env.HOME
    const jar = path.join(home, 'test-client.jar')
    fs.writeFileSync(jar, zipBauen(JAR))
    const out = path.join(home, 'item-icons')
    const lauf = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'minecraft-bilder.js'), '--jar', jar, '--keine-namen'], { env: { ...process.env, ITEM_ICONS_DIR: out }, encoding: 'utf8', timeout: 30000 })
    t.chk('Werkzeug läuft durch', lauf.status === 0, (lauf.stdout || '') + (lauf.stderr || ''))
    const map = JSON.parse(fs.readFileSync(path.join(out, 'icons.json'), 'utf8')).items
    t.chk('Stufe: Bild ihres Blocks', map.oak_slab === 'block/oak_planks.png', map)
    t.chk('Verzauberter goldener Apfel: Bild des goldenen Apfels', map.enchanted_golden_apple === 'item/golden_apple.png', map)
    t.chk('Block über Vorlage (cube_all)', map.magma_block === 'block/magma.png')
    t.chk('Bedingtes Modell: normaler Zustand', map.compass === 'block/oak_planks.png', map.compass)
    t.chk('Items mit eigenem Bild brauchen keinen Eintrag', !('golden_apple' in map))
    t.chk('Truhe und Bett: gebaute Bilder', map.ender_chest === 'made/ender_chest.png' && map.red_bed === 'made/red_bed.png', map)
    t.chk('Pfeil aus zwei Ebenen: gebautes Bild', map.tipped_arrow === 'made/tipped_arrow.png')
    const truhe = fs.readFileSync(path.join(out, 'made', 'ender_chest.png'))
    const ti = png.decode(truhe)
    t.chk('Truhe: 16x16, Schloss vorne in der Mitte', ti.width === 16 && ti.height === 16 && pixel(truhe, 7, 4) === 0xffd700 && pixel(truhe, 2, 10) === 0x223344, [ti.width, pixel(truhe, 7, 4).toString(16)])
    const bett = fs.readFileSync(path.join(out, 'made', 'red_bed.png'))
    const bi = png.decode(bett)
    t.chk('Bett: liegend, Kissen links, Decke rechts', bi.width === 32 && bi.height === 32 && pixel(bett, 4, 16) === 0xeeeeee && pixel(bett, 28, 16) === 0xcc2222, [bi.width, bi.height, pixel(bett, 4, 16).toString(16), pixel(bett, 28, 16).toString(16)])
    const pf = fs.readFileSync(path.join(out, 'made', 'tipped_arrow.png'))
    t.chk('Pfeil: obere Ebene liegt oben', pixel(pf, 5, 5) === 0x553311)
    const magma = png.decode(fs.readFileSync(path.join(out, 'block', 'magma.png')))
    t.chk('Animierte Textur: nur das erste Bild', magma.width === 16 && magma.height === 16, [magma.width, magma.height])
    t.chk('Bilder ohne Animation bleiben unverändert', fs.readFileSync(path.join(out, 'item', 'golden_apple.png')).equals(APFEL))

    // Der Manager liefert jetzt die Bilder (prüft die Zuordnung spätestens nach 30 s neu)
    await t.warte(31000)
    r = await t.api('GET', '/api/inventory/alpha')
    t.chk('icons ist jetzt eine Versionsnummer', typeof r.data.icons === 'number' && r.data.icons > 1, r.data.icons)
    const holen = (n) => t.api('GET', `/item-icons/${n}?v=${r.data.icons}`)
    let x = await holen('oak_slab')
    t.chk('Stufe wird ausgeliefert', x.status === 200, x.status)
    x = await holen('ender_chest')
    t.chk('Truhe wird ausgeliefert', x.status === 200, x.status)
    x = await holen('enchanted_golden_apple')
    t.chk('Verzauberter Apfel wird ausgeliefert', x.status === 200, x.status)

    // Kaputte oder bösartige Zuordnung wird ignoriert
    fs.writeFileSync(path.join(out, 'icons.json'), JSON.stringify({ version: 1, items: { boese: '../../users.json', boese2: 'made/../../users.json', oak_slab: 'block/oak_planks.png' } }))
    const neu = new Date(Date.now() + 5000)
    fs.utimesSync(path.join(out, 'icons.json'), neu, neu)
    await t.warte(31000)
    t.chk('Pfad-Tricks in icons.json: 404', (await holen('boese')).status === 404 && (await holen('boese2')).status === 404)
    t.chk('Gültige Einträge gehen weiter', (await holen('oak_slab')).status === 200)

    // Glitzern ohne Verzauberung
    const b = t.java('alpha')
    b.inventory.setzen(36, 'enchanted_golden_apple', 2)
    b.inventory.setzen(37, 'golden_apple', 2)
    r = await t.api('GET', '/api/inventory/alpha')
    t.chk('Verzauberter goldener Apfel glitzert', r.data.slots[36].glint === true && !r.data.slots[37].glint, [r.data.slots[36], r.data.slots[37]])
  },
}
