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

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');

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
    fs.writeFileSync(path.join(dir, m[2]), zip[name]());
    n++;
  }
  if (n === 0) throw new Error('In der Datei waren keine Item-Bilder');
  console.log(`${n} Bilder gespeichert in ${OUT}`);

  // Deutsche Namen (stehen nicht in der .jar, sondern in Mojangs Sprachdateien)
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

module.exports = { readZip };
