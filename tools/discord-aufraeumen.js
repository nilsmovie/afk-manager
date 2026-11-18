#!/usr/bin/env node
// Discord aufräumen: löscht Nachrichten, die der AFK-Manager (Bot oder seine Webhooks aus der .env)
// in einem Kanal in einem bestimmten Zeitraum geschickt hat - z.B. nach einer Nacht voller Kick-
// und "Alle wieder online"-Meldungen. Nachrichten von Menschen oder anderen Bots bleiben immer stehen.
//
//   npm run discord-aufraeumen -- --kanal 123456789012345678 --von "18.11.2026 00:01" --bis "18.11.2026 05:00"
//       zeigt nur an, was gelöscht würde (nichts wird gelöscht)
//   ... --loeschen         löscht wirklich (fragt vorher nach; mit --ja ohne Rückfrage)
//
// Zeiten in der Ortszeit des Rechners (TZ=Europe/Berlin davor setzen, falls nötig). Ohne Datum gilt
// heute ("--von 00:01"). Der Bot braucht "Nachrichten lesen/Verlauf anzeigen" im Kanal; mit dem
// Recht "Nachrichten verwalten" geht es in Hunderterpaketen, sonst einzeln (dauert länger).
'use strict';

const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { REST, Routes } = require('discord.js');

const DISCORD_EPOCH = 1420070400000;
const MAX_PAGES = 1000; // 100.000 Nachrichten - Sicherheitsgrenze
const BULK_MAX_AGE_MS = 13.9 * 24 * 60 * 60 * 1000; // Discord: Paket-Löschen nur bis 14 Tage

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(name);

// "18.11.2026 00:01", "2026-11-18 00:01" oder nur "00:01" (= heute)
function parseZeit(text) {
  if (!text) return null;
  const s = String(text).trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0);
  }
  return null;
}
const fmt = (ms) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const snowflakeAt = (ms) => String((BigInt(Math.max(0, ms - DISCORD_EPOCH)) << 22n));

function webhooksFromEnv() {
  const out = new Map();
  for (const name of ['DISCORD_WEBHOOK_URL', 'DISCORD_CHAT_WEBHOOK_URL']) {
    const m = /\/webhooks\/(\d{15,22})\/([\w-]{20,})/.exec(process.env[name] || '');
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function kurz(msg) {
  const e = Array.isArray(msg.embeds) && msg.embeds[0];
  const t = (msg.content || (e && (e.title || e.description)) || '').replace(/\s+/g, ' ').trim();
  return t.length > 70 ? `${t.slice(0, 67)}...` : t || '(ohne Text)';
}

async function frage(text) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(text, r));
  rl.close();
  return /^j(a)?$/i.test(a.trim());
}

async function main() {
  const kanal = arg('--kanal');
  const von = parseZeit(arg('--von'));
  const bis = parseZeit(arg('--bis'));
  if (!kanal || !/^\d{15,22}$/.test(kanal) || !von || !bis) {
    console.log('Aufruf: npm run discord-aufraeumen -- --kanal <Kanal-ID> --von "TT.MM.JJJJ HH:MM" --bis "TT.MM.JJJJ HH:MM" [--loeschen] [--ja]');
    process.exit(1);
  }
  if (bis.getTime() < von.getTime()) throw new Error('"--bis" liegt vor "--von"');
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN fehlt in der .env - zum Lesen des Kanals braucht es den Bot');

  const rest = new REST({ version: '10', ...(process.env.DISCORD_API_URL ? { api: process.env.DISCORD_API_URL } : {}) }).setToken(token);
  const me = await rest.get(Routes.user());
  const hooks = webhooksFromEnv();
  const vonMs = von.getTime();
  const bisMs = bis.getTime() + 59 * 1000 + 999; // "05:00" heißt bis einschließlich 05:00:59
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`Kanal ${kanal}, Zeitraum ${fmt(vonMs)} bis ${fmt(bisMs)} (${zone})`);
  console.log(`Gesucht: Nachrichten von ${me.username || 'dem Bot'}${hooks.size ? ` und ${hooks.size === 1 ? 'seinem Webhook' : `seinen ${hooks.size} Webhooks`}` : ''}`);

  // Nachrichten rückwärts ab dem Ende des Zeitraums holen
  const treffer = [];
  let before = snowflakeAt(bisMs + 1);
  let seiten = 0;
  let andere = 0;
  for (; seiten < MAX_PAGES; seiten++) {
    const page = await rest.get(Routes.channelMessages(kanal), { query: new URLSearchParams({ limit: '100', before }) });
    if (!Array.isArray(page) || page.length === 0) break;
    let fertig = false;
    for (const msg of page) {
      const ts = Date.parse(msg.timestamp);
      if (ts < vonMs) { fertig = true; continue; }
      if (ts > bisMs) continue;
      const vomBot = msg.author && msg.author.id === me.id && !msg.webhook_id;
      const vomHook = msg.webhook_id && hooks.has(msg.webhook_id);
      if (vomBot || vomHook) treffer.push({ id: msg.id, ts, hook: vomHook ? msg.webhook_id : null, text: kurz(msg) });
      else andere++;
    }
    before = page[page.length - 1].id;
    if (fertig || page.length < 100) break;
    if (seiten % 10 === 9) console.log(`  ... ${treffer.length} gefunden bisher`);
  }
  if (seiten >= MAX_PAGES) console.log(`Achtung: nach ${MAX_PAGES * 100} Nachrichten abgebrochen - für den Rest nochmal starten.`);

  treffer.sort((a, b) => a.ts - b.ts);
  console.log(`\n${treffer.length} Nachricht(en) vom AFK-Manager gefunden${andere ? ` (${andere} andere Nachrichten im Zeitraum bleiben stehen)` : ''}.`);
  if (!treffer.length) return;
  console.log(`  erste:  ${fmt(treffer[0].ts)}  ${treffer[0].text}`);
  console.log(`  letzte: ${fmt(treffer[treffer.length - 1].ts)}  ${treffer[treffer.length - 1].text}`);

  if (!has('--loeschen')) {
    console.log('\nNichts gelöscht. Zum Löschen den gleichen Befehl mit --loeschen am Ende ausführen.');
    return;
  }
  if (!has('--ja') && !(await frage(`\n${treffer.length} Nachricht(en) wirklich löschen? (ja/nein) `))) {
    console.log('Abgebrochen, nichts gelöscht.');
    return;
  }

  let geloescht = 0;
  let fehler = 0;
  const zeige = () => { if (geloescht % 100 === 0 || geloescht === treffer.length) console.log(`  ${geloescht} von ${treffer.length} gelöscht`); };

  // 1) Paketweise (schnell, braucht "Nachrichten verwalten", nur jünger als 14 Tage)
  let rest100 = treffer.filter((t) => Date.now() - t.ts < BULK_MAX_AGE_MS);
  const einzeln = treffer.filter((t) => Date.now() - t.ts >= BULK_MAX_AGE_MS);
  let paketOk = rest100.length >= 2;
  while (paketOk && rest100.length >= 2) {
    const chunk = rest100.slice(0, 100);
    try {
      await rest.post(Routes.channelBulkDelete(kanal), { body: { messages: chunk.map((t) => t.id) } });
      geloescht += chunk.length;
      rest100 = rest100.slice(chunk.length);
      zeige();
    } catch (e) {
      if (e && (e.status === 403 || e.code === 50013)) {
        console.log('  Der Bot darf keine Nachrichten verwalten - lösche einzeln (dauert länger) ...');
      } else {
        console.log(`  Paket-Löschen ging nicht (${e.message}) - lösche einzeln ...`);
      }
      paketOk = false;
    }
  }
  einzeln.push(...rest100);

  // 2) Einzeln: eigene Nachrichten darf der Bot immer löschen, Webhook-Nachrichten über den Webhook
  for (const t of einzeln) {
    try {
      if (t.hook) await rest.delete(Routes.webhookMessage(t.hook, hooks.get(t.hook), t.id), { auth: false });
      else await rest.delete(Routes.channelMessage(kanal, t.id));
      geloescht++;
      zeige();
    } catch (e) {
      if (e && e.status === 404) { geloescht++; continue; } // war schon weg
      fehler++;
      if (fehler <= 5) console.log(`  Nachricht ${t.id} (${fmt(t.ts)}) ging nicht: ${e.message}`);
    }
  }
  console.log(`\nFertig: ${geloescht} gelöscht${fehler ? `, ${fehler} gingen nicht` : ''}.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`Fehler: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseZeit, snowflakeAt };
