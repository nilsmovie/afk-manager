#!/usr/bin/env node
// Holt die Item-Bilder (und die deutschen Item-Namen) aus Minecraft fuer das Inventar im
// Dashboard. Die Bilder gehoeren Mojang: Sie werden direkt von Mojang geladen (bzw. aus deiner
// eigenen client.jar gelesen), landen nur im Ordner item-icons/ auf deinem Rechner und kommen
// nie ins Repository (.gitignore). Bitte nicht weitergeben.
//
//   npm run bilder                        neueste Minecraft-Version von Mojang laden
//   npm run bilder -- --version 1.21.4    bestimmte Version
//   npm run bilder -- --jar ~/client.jar  aus deiner eigenen Minecraft-Datei lesen
//   ... --ja                              EULA-Hinweis ohne Rueckfrage bestaetigen
//   ... --keine-namen                     deutsche Namen nicht laden

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');
const png = require('./png-klein');

const OUT = process.env.ITEM_ICONS_DIR || path.join(__dirname, '..', 'item-icons');
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = 'https://resources.download.minecraft.net';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(name);

function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'afk-manager' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url}: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}
const getJson = async (url) => JSON.parse((await get(url)).toString('utf8'));
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Minimaler ZIP-Leser (eine .jar ist ein ZIP): liefert { name -> () => Buffer }
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige .jar/.zip-Datei');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries[name] = () => {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Packart ${method} wird nicht unterstützt`);
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- Bilder für Items ohne eigenes Bild (aus den Modellen des Spiels) ----------
// Stufen, Mauern, Zäune, Knöpfe, Teppiche ... zeigen im Spiel die Textur ihres Blocks;
// Truhen, Betten, Köpfe, Banner und Schilde werden im Spiel als 3D-Modell gezeichnet - für sie
// wird hier aus der Textur ein einfaches Bild (Vorderseite) gebaut.
const DYES = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f,
  pink: 0xf38baa, gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
// Welche Textur eines Block-Modells am ehesten wie das Item aussieht
const BLOCK_KEYS = ['front', 'side', 'wall', 'texture', 'wool', 'all', 'end', 'north', 'top', 'up', 'cross', 'plant', 'pattern', 'body', 'particle'];
const HEADS = {
  skeleton_skull: [['entity/skeleton/skeleton'], 8, 8, 8, 8],
  wither_skeleton_skull: [['entity/skeleton/wither_skeleton'], 8, 8, 8, 8],
  zombie_head: [['entity/zombie/zombie'], 8, 8, 8, 8],
  creeper_head: [['entity/creeper/creeper'], 8, 8, 8, 8],
  piglin_head: [['entity/piglin/piglin'], 8, 8, 10, 8],
  player_head: [['entity/player/wide/steve', 'entity/steve'], 8, 8, 8, 8, true],
  dragon_head: [['entity/enderdragon/dragon'], 128, 46, 16, 16],
};
const SIMPLE_REL_RE = /^(item|block)\/[a-z0-9_]{1,64}$/;

function zipJson(zip, file) {
  const f = zip[file];
  if (!f) return null;
  try {
    return JSON.parse(f().toString('utf8'));
  } catch (e) {
    return null;
  }
}
function refPath(ref) {
  // "minecraft:block/oak_planks" -> "block/oak_planks"
  if (ref && typeof ref === 'object' && typeof ref.sprite === 'string') ref = ref.sprite;
  if (typeof ref !== 'string') return null;
  const r = ref.replace(/^minecraft:/, '');
  return /^[a-z0-9_/]{1,120}$/.test(r) ? r : null;
}
function hasTexture(zip, rel) {
  return !!(rel && zip[`assets/minecraft/textures/${rel}.png`]);
}
function readTexture(zip, rel) {
  const f = rel && zip[`assets/minecraft/textures/${rel}.png`];
  if (!f) return null;
  try {
    return firstFrame(png.decode(f()));
  } catch (e) {
    return null;
  }
}
// Animierte Texturen (Magma, Meereslaterne ...) sind ein Streifen aus Bildern - nur das erste nehmen
function firstFrame(img) {
  if (img.height > img.width && img.height % img.width === 0) return png.crop(img, 0, 0, img.width, img.width);
  return img;
}
// in die Mitte eines quadratischen Bildes setzen (sieht im Inventar-Platz besser aus)
function square(img) {
  const side = Math.max(img.width, img.height);
  const out = png.create(side, side);
  return png.blit(out, img, Math.floor((side - img.width) / 2), Math.floor((side - img.height) / 2));
}
function rotateLeft(img) {
  const out = png.create(img.height, img.width);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4, d = ((img.width - 1 - x) * img.height + y) * 4;
      for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
    }
  }
  return out;
}

// Modell auflösen: Texturen über alle "parent" sammeln, "#name" auflösen
function resolveModel(zip, ref) {
  const textures = {};
  let generated = false;
  let cur = ref;
  for (let depth = 0; cur && depth < 15; depth++) {
    const r = refPath(cur);
    if (!r) break;
    if (r === 'builtin/generated' || r === 'item/generated') generated = true;
    const m = zipJson(zip, `assets/minecraft/models/${r}.json`);
    if (!m) break;
    for (const [k, v] of Object.entries(m.textures || {})) if (!(k in textures)) textures[k] = v;
    cur = m.parent;
  }
  const look = (v, n = 0) => (typeof v === 'string' && v.startsWith('#') && n < 10 ? look(textures[v.slice(1)], n + 1) : v);
  const out = {};
  for (const k of Object.keys(textures)) {
    const v = refPath(look(textures[k]));
    if (v) out[k] = v;
  }
  return { textures: out, generated: generated || 'layer0' in out };
}

// Aus der Item-Beschreibung (ab 1.21.4: assets/minecraft/items/<name>.json) das normale Modell holen
function findModel(m, depth = 0) {
  if (!m || typeof m !== 'object' || depth > 8) return null;
  const type = String(m.type || '').replace(/^minecraft:/, '');
  if (type === 'model' && typeof m.model === 'string') return { model: m.model };
  if (type === 'special') return { special: m.model && typeof m.model === 'object' ? m.model : {}, model: typeof m.base === 'string' ? m.base : null };
  const subs = [m.on_false, m.fallback, m.on_true];
  if (Array.isArray(m.cases)) for (const c of m.cases) subs.push(c && c.model);
  if (Array.isArray(m.entries)) for (const e of m.entries) subs.push(e && e.model);
  if (Array.isArray(m.models)) subs.push(...m.models);
  for (const sub of subs) {
    const r = findModel(sub, depth + 1);
    if (r) return r;
  }
  return null;
}
function itemModel(zip, name) {
  const def = zipJson(zip, `assets/minecraft/items/${name}.json`);
  if (def && def.model) {
    const r = findModel(def.model);
    if (r) return r;
  }
  if (zip[`assets/minecraft/models/item/${name}.json`]) return { model: `minecraft:item/${name}` };
  return null;
}

// Truhe von vorne: Deckel, Unterteil, Schloss (Textur-Aufteilung ab Minecraft 1.15)
function chestIcon(t) {
  if (t.width !== 64 || t.height !== 64) return null;
  const c = png.create(16, 16);
  png.blit(c, png.flipV(png.crop(t, 42, 14, 14, 5)), 1, 1);
  png.blit(c, png.flipV(png.crop(t, 42, 33, 14, 10)), 1, 6);
  png.blit(c, png.flipV(png.crop(t, 1, 1, 2, 4)), 7, 4);
  return c;
}
// Bett von oben: Kopfteil mit Kissen links, Fußteil rechts
function bedIcon(t) {
  if (t.width !== 64 || t.height !== 64) return null;
  const c = png.create(16, 32);
  png.blit(c, png.crop(t, 6, 6, 16, 16), 0, 0);
  png.blit(c, png.crop(t, 6, 28, 16, 16), 0, 16);
  return square(rotateLeft(c));
}

function specialIcon(zip, name, model) {
  const special = model && model.special ? model.special : null;
  const kind = special ? String(special.type || '').replace(/^minecraft:/, '') : '';
  const specialTex = special && typeof special.texture === 'string' ? refPath(special.texture) : null;
  // Truhen (auch Kupfertruhen)
  const copper = /^(?:waxed_)?(?:(exposed|weathered|oxidized)_)?copper_chest$/.exec(name);
  let chest = { chest: 'normal', trapped_chest: 'trapped', ender_chest: 'ender' }[name] || (copper ? (copper[1] ? `copper_${copper[1]}` : 'copper') : null);
  if (kind === 'chest' && specialTex) chest = specialTex.replace(/^.*\//, '');
  if (chest) {
    const t = readTexture(zip, `entity/chest/${chest}`);
    if (t) return chestIcon(t);
  }
  const bed = /^([a-z_]+)_bed$/.exec(name);
  if (bed && DYES[bed[1]]) {
    const t = readTexture(zip, `entity/bed/${bed[1]}`);
    if (t) return bedIcon(t);
  }
  const banner = /^([a-z_]+)_banner$/.exec(name);
  if (banner && DYES[banner[1]]) {
    const t = readTexture(zip, 'entity/banner_base');
    if (t && t.width === 64) return square(png.tint(png.crop(t, 1, 1, 20, 40), DYES[banner[1]]));
  }
  if (name === 'shield') {
    const t = readTexture(zip, 'entity/shield_base_nopattern');
    if (t && t.width === 64) return square(png.crop(t, 1, 1, 12, 22));
  }
  if (HEADS[name]) {
    const [files, x, y, w, h, hat] = HEADS[name];
    for (const f of files) {
      const t = readTexture(zip, f);
      if (!t || t.width < x + w || t.height < y + h) continue;
      const face = png.crop(t, x, y, w, h);
      if (hat && t.width >= 48) png.blit(face, png.crop(t, 40, 8, 8, 8), 0, 0);
      return square(face);
    }
  }
  if (name === 'decorated_pot') {
    const t = readTexture(zip, 'entity/decorated_pot/decorated_pot_side');
    if (t) return t;
  }
  return null;
}

// Liefert { items: { name -> "block/x.png" | "made/name.png" }, made: { name -> PNG-Daten } }
function buildIconMap(zip) {
  let names = Object.keys(zip).map((f) => /^assets\/minecraft\/items\/([a-z0-9_]+)\.json$/.exec(f)).filter(Boolean).map((m) => m[1]);
  if (!names.length) names = Object.keys(zip).map((f) => /^assets\/minecraft\/models\/item\/([a-z0-9_]+)\.json$/.exec(f)).filter(Boolean).map((m) => m[1]);
  const items = {};
  const made = {};
  const make = (name, img) => {
    made[name] = png.encode(img);
    items[name] = `made/${name}.png`;
  };
  for (const name of names.sort()) {
    if (hasTexture(zip, `item/${name}`)) continue; // eigenes Bild reicht
    const model = itemModel(zip, name);
    let img = null;
    try {
      img = specialIcon(zip, name, model);
    } catch (e) {
      img = null;
    }
    if (img) { make(name, img); continue; }
    if (!model || !model.model) continue;
    const res = resolveModel(zip, model.model);
    let rels;
    if (res.generated) {
      rels = Object.keys(res.textures).filter((k) => /^layer\d+$/.test(k)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).map((k) => res.textures[k]);
    } else {
      const key = BLOCK_KEYS.find((k) => hasTexture(zip, res.textures[k]));
      rels = key ? [res.textures[key]] : [];
    }
    rels = rels.filter((r) => hasTexture(zip, r));
    if (!rels.length) continue;
    if (rels.length === 1 && SIMPLE_REL_RE.test(rels[0])) {
      items[name] = `${rels[0]}.png`;
      continue;
    }
    // mehrere Ebenen (z.B. Pfeil mit Spitze) oder Bild aus einem Unterordner -> eigenes Bild
    const layers = rels.map((r) => readTexture(zip, r)).filter(Boolean);
    if (!layers.length) continue;
    const out = png.create(layers[0].width, layers[0].height);
    for (const l of layers) png.blit(out, l, 0, 0);
    make(name, out);
  }
  return { items, made };
}

async function confirmEula() {
  console.log('Die Item-Bilder und Namen gehören Mojang. Sie werden nur für dich lokal in den Ordner');
  console.log('item-icons/ gelegt (nicht ins Repository, nicht weitergeben).');
  console.log('Mit dem Herunterladen akzeptierst du die Minecraft-EULA: https://aka.ms/MinecraftEULA');
  if (has('--ja')) return true;
  if (!process.stdin.isTTY) {
    console.log('Zum Bestätigen mit --ja aufrufen.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question('Einverstanden? (ja/nein) ', r));
  rl.close();
  return /^j(a)?$/i.test(answer.trim());
}

async function main() {
  const jarPath = arg('--jar');
  const wanted = arg('--version');
  if (!jarPath && !(await confirmEula())) {
    console.log('Abgebrochen.');
    process.exit(1);
  }

  let jar;
  let versionJson = null;
  if (jarPath) {
    const p = jarPath.replace(/^~(?=\/|$)/, process.env.HOME || '~');
    console.log(`Lese ${p} ...`);
    jar = fs.readFileSync(p);
  } else {
    console.log('Frage Mojang nach den Versionen ...');
    const manifest = await getJson(MANIFEST);
    const id = wanted || manifest.latest.release;
    const entry = manifest.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Version ${id} gibt es nicht`);
    versionJson = await getJson(entry.url);
    const client = versionJson.downloads && versionJson.downloads.client;
    if (!client) throw new Error('Keine client.jar für diese Version');
    console.log(`Lade Minecraft ${id} (${Math.round(client.size / 1e6)} MB) ...`);
    jar = await get(client.url);
    if (client.sha1 && sha1(jar) !== client.sha1) throw new Error('Download beschädigt (Prüfsumme passt nicht) - bitte nochmal versuchen');
  }

  const zip = readZip(jar);
  let n = 0;
  for (const name of Object.keys(zip)) {
    const m = name.match(/^assets\/minecraft\/textures\/(item|block)\/([a-z0-9_]+\.png)$/);
    if (!m) continue;
    const dir = path.join(OUT, m[1]);
    fs.mkdirSync(dir, { recursive: true });
    let data = zip[name]();
    if (zip[`${name}.mcmeta`]) {
      // animiert (z.B. Magma): nur das erste Bild speichern
      try {
        data = png.encode(firstFrame(png.decode(data)));
      } catch (e) {
        // so lassen
      }
    }
    fs.writeFileSync(path.join(dir, m[2]), data);
    n++;
  }
  if (n === 0) throw new Error('In der Datei waren keine Item-Bilder');
  console.log(`${n} Bilder gespeichert in ${OUT}`);

  // Items ohne eigenes Bild (Stufen, Truhen, Betten ...): Zuordnung + gebaute Bilder
  const { items, made } = buildIconMap(zip);
  const madeDir = path.join(OUT, 'made');
  fs.rmSync(madeDir, { recursive: true, force: true });
  fs.mkdirSync(madeDir, { recursive: true });
  for (const [name, data] of Object.entries(made)) fs.writeFileSync(path.join(madeDir, `${name}.png`), data);
  fs.writeFileSync(path.join(OUT, 'icons.json'), JSON.stringify({ version: 1, items }));
  console.log(`${Object.keys(items).length} weitere Items über die Modelle zugeordnet (${Object.keys(made).length} Bilder gebaut).`);

  // Deutsche Namen (stehen nicht in der .jar, sondern in Mojangs Sprachdateien)
  if (has('--keine-namen')) {
    console.log('Fertig (ohne deutsche Namen).');
    return;
  }
  try {
    if (!versionJson) {
      const manifest = await getJson(MANIFEST);
      const id = wanted || manifest.latest.release;
      const entry = manifest.versions.find((v) => v.id === id);
      if (entry) versionJson = await getJson(entry.url);
    }
    if (versionJson && versionJson.assetIndex) {
      const index = await getJson(versionJson.assetIndex.url);
      const obj = index.objects && index.objects['minecraft/lang/de_de.json'];
      if (obj) {
        const data = await get(`${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`);
        if (sha1(data) === obj.hash) {
          fs.writeFileSync(path.join(OUT, 'de_de.json'), data);
          console.log('Deutsche Item-Namen gespeichert.');
        }
      }
    }
  } catch (e) {
    console.log(`Deutsche Namen konnten nicht geladen werden (${e.message}) - es bleiben die englischen.`);
  }
  console.log('Fertig. Im Dashboard die Seite neu laden (ein Neustart des Managers ist nicht nötig).');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`Fehler: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { readZip, buildIconMap, resolveModel, findModel };
