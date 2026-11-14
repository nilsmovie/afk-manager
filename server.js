require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const crypto = require('crypto');
const net = require('net');
const v8 = require('v8');
const { promisify } = require('util');
const { monitorEventLoopDelay } = require('perf_hooks');

// bedrock-protocol: optional, nur geladen wenn verfuegbar.
// Wird mit "npm install" automatisch mitinstalliert.
let bedrockProtocol = null;
try {
  bedrockProtocol = require('bedrock-protocol');
} catch (e) {
  console.warn('bedrock-protocol nicht verfuegbar - Bedrock-Accounts werden nicht unterstuetzt. npm install bedrock-protocol ausfuehren.');
}

// bedrock-protocol entpackt JEDES empfangene Datenpaket mit einem 500-KB-Puffer (zlib chunkSize
// 512000). Bei den vielen kleinen Paketen pro Sekunde ist das rund 5x langsamer als der normale
// Puffer und erzeugt jede Menge Speichermuell - das Ergebnis ist mit kleinem Puffer identisch.
// Abschalten (falls je noetig): MC_BEDROCK_FAST_INFLATE=0 in der .env
const bedrockTuning = require('./bedrock-tuning');
const MC_BEDROCK_FAST_INFLATE = !/^(0|false|nein|no|aus)$/i.test(process.env.MC_BEDROCK_FAST_INFLATE || '');
if (bedrockProtocol && MC_BEDROCK_FAST_INFLATE) bedrockTuning.enableFastInflate();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const minecraftFolderPath = require('minecraft-folder-path');

const app = express();
// Fuer eigene Erweiterungen (siehe "Schnittstelle fuer eigene Erweiterungen" weiter unten):
// wer jede Chat-Zeile des primaeren Accounts mitlesen will, und Zusatz-Skripte fuer die
// Verwaltungsseite (bekommt nur der Owner)
const chatListeners = [];
const extAdminScripts = [];
const server = http.createServer(app);
const io = new Server(server);

// Sicherheitsnetz: verhindert, dass ein einzelner unerwarteter Fehler
// (z.B. von einem einzelnen Bot) den kompletten Server abstuerzen laesst.
process.on('uncaughtException', (err) => {
  console.error('UNERWARTETER FEHLER (Server laeuft trotzdem weiter):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNBEHANDELTE PROMISE-ABLEHNUNG (Server laeuft trotzdem weiter):', reason);
});

const PORT = process.env.PORT || 3000;

// ---------- Schutz gegen einen doppelt laufenden AFK-Manager ----------
// Ist der Port schon belegt, laeuft der Manager bereits (oder ein anderes Programm nutzt
// den Port). Frueher lief die zweite Instanz trotzdem weiter: ohne Webseite und ohne
// Bots, aber MIT Discord-Verbindung - und hat dann auf jeden Discord-Klick mitgeantwortet
// (z.B. "Account nicht online, Befehl NICHT gesendet"). Jetzt bleibt sie komplett still.
let serverListening = false;
let instanceIdle = false;
const afterListenQueue = [];
function whenServerListening(fn) {
  if (serverListening) fn();
  else afterListenQueue.push(fn);
}
server.once('listening', () => {
  serverListening = true;
  for (const fn of afterListenQueue.splice(0)) {
    try { fn(); } catch (e) { console.error('Startfehler:', e); }
  }
});
server.on('error', (err) => {
  if (serverListening) {
    console.error('Webserver-Fehler:', err.message);
    return;
  }
  instanceIdle = true;
  const grund = err.code === 'EADDRINUSE'
    ? `Port ${PORT} ist schon belegt - der AFK-Manager laeuft bereits (oder ein anderes Programm nutzt diesen Port)`
    : `Der Webserver konnte nicht starten (${err.message})`;
  const meldung = `[Diagnose] ${grund}. Diese Instanz bleibt UNTAETIG (keine Bots, kein Discord), damit nichts doppelt passiert. Beenden: "pm2 stop afk-manager" bzw. "sudo systemctl stop afk-manager".`;
  console.error(meldung);
  setInterval(() => console.error(meldung), 10 * 60 * 1000);
});

// Standardserver: kommt immer aus der .env (MC_SERVER_HOST, MC_SERVER_PORT, MC_BEDROCK_PORT)
const MC_SERVER_HOST = String(process.env.MC_SERVER_HOST || '').trim();
// Name in den Seitentiteln des Dashboards (Standard: Adresse des Minecraft-Servers)
const DASHBOARD_TITLE = (process.env.DASHBOARD_TITLE || MC_SERVER_HOST || 'AFK-Manager').trim();
const MC_SERVER_PORT = parseInt(process.env.MC_SERVER_PORT || '25565', 10);
const MC_BEDROCK_PORT = parseInt(process.env.MC_BEDROCK_PORT || '19132', 10);
// Sichtweite der Bots in Chunks. AFK-Bots brauchen keine Welt um sich herum - mit dem
// Standard (Java: 12) laedt und entpackt JEDER Bot bis zu 625 Chunks und haelt sie im RAM,
// dazu kommen alle Entity-Updates im weiten Umkreis. Das ist die Hauptlast des Prozesses.
// Bei Bedarf in der .env aenderbar (MC_VIEW_DISTANCE / MC_BEDROCK_VIEW_DISTANCE).
const MC_VIEW_DISTANCE = Math.max(2, parseInt(process.env.MC_VIEW_DISTANCE || '2', 10) || 2);
const MC_BEDROCK_VIEW_DISTANCE = Math.max(2, parseInt(process.env.MC_BEDROCK_VIEW_DISTANCE || '4', 10) || 4);
// Wie sich Bedrock-Accounts verbinden: 'auto' (Standard: NetherNet, wenn der Server es anbietet,
// sonst RakNet), 'nethernet' oder 'raknet'. Seit Bedrock 26.60 nutzen Spieler NetherNet.
const MC_BEDROCK_TRANSPORT = ['auto', 'nethernet', 'raknet'].includes(String(process.env.MC_BEDROCK_TRANSPORT || '').toLowerCase())
  ? String(process.env.MC_BEDROCK_TRANSPORT).toLowerCase() : 'auto';
// Optional feste Bedrock-Version (z.B. 1.26.60) - leer = neueste, die die Bibliothek kennt
const MC_BEDROCK_VERSION = process.env.MC_BEDROCK_VERSION || '';
// NetherNet standardmaessig nur ueber IPv4 (siehe nethernet-http.js: sonst antwortet der Server
// teils ueber IPv6, und die Router-Firewall laesst das nach ein paar Minuten nicht mehr durch)
// MC_BEDROCK_NETHERNET_IPV6=only: NUR IPv6 (beide Richtungen) - wenn der Server ueber IPv4 nicht antwortet
const MC_BEDROCK_NETHERNET_IPV6 = /^(only|nur|ipv6|v6)$/i.test(process.env.MC_BEDROCK_NETHERNET_IPV6 || '')
  ? 'only'
  : /^(1|true|ja|yes|beide|both)$/i.test(process.env.MC_BEDROCK_NETHERNET_IPV6 || '');
// WebRTC-Umsetzung fuer NetherNet: 'auto' (Standard: nativ ueber @roamhq/wrtc, wenn installiert,
// sonst werift in reinem JavaScript), 'wrtc' oder 'werift'. Das native WebRTC arbeitet in eigenen
// Threads und bestaetigt empfangene Daten auch, wenn der Manager-Prozess gerade ausgelastet ist.
const MC_BEDROCK_NETHERNET_WEBRTC = ['auto', 'wrtc', 'werift'].includes(String(process.env.MC_BEDROCK_NETHERNET_WEBRTC || '').toLowerCase())
  ? String(process.env.MC_BEDROCK_NETHERNET_WEBRTC).toLowerCase() : 'auto';
// Paketfilter: Ein AFK-Bot braucht von den 800-1500 Paketen pro Sekunde, die der Server schickt
// (Bewegungen, Entities, Chunks, Inventar ...), nur eine Handvoll. Alle anderen werden direkt am
// Paketkopf erkannt und verworfen, statt sie aufwendig zu entschluesseln - das ist der groesste
// Teil der Rechenlast. Abschalten: MC_BEDROCK_PACKET_FILTER=0. Weitere Pakete behalten (Namen
// aus minecraft-data, durch Komma getrennt): MC_BEDROCK_KEEP_PACKETS=text,transfer
const MC_BEDROCK_PACKET_FILTER = !/^(0|false|nein|no|aus)$/i.test(process.env.MC_BEDROCK_PACKET_FILTER || '');
const BEDROCK_KEEP_PACKETS = bedrockTuning.keepPacketNames(process.env.MC_BEDROCK_KEEP_PACKETS);
const bedrockPacketTotals = { read: 0, dropped: 0 }; // alle Bedrock-Bots zusammen (fuer die Diagnose-Zeile)

// Filter im Haupt-Thread (RakNet bzw. NetherNet ohne eigenen Thread) - Code in bedrock-tuning.js
function installBedrockPacketFilter(client, counters) {
  if (!MC_BEDROCK_PACKET_FILTER) return false;
  return bedrockTuning.installPacketFilter(client, {
    names: BEDROCK_KEEP_PACKETS,
    counters,
    onCount: (read) => { if (read) bedrockPacketTotals.read++; else bedrockPacketTotals.dropped++; },
  });
}

// Jeder NetherNet-Account in einem eigenen Thread (bedrock-worker.js), damit die Arbeit auf
// mehrere Prozessorkerne verteilt wird. Nur mit werift (das native WebRTC laeuft nicht in
// Threads). Abschalten: MC_BEDROCK_THREADS=0 - dann wie frueher alles im Haupt-Thread.
const MC_BEDROCK_THREADS = !/^(0|false|nein|no|aus)$/i.test(process.env.MC_BEDROCK_THREADS || '');
let BedrockThreadClient = null;
try {
  ({ BedrockThreadClient } = require('./bedrock-thread'));
} catch (e) {
  console.warn('bedrock-thread.js fehlt - Bedrock-Accounts laufen im Haupt-Thread:', e.message);
}
function bedrockUsesThreads() {
  return MC_BEDROCK_THREADS && !!BedrockThreadClient && MC_BEDROCK_NETHERNET_WEBRTC !== 'wrtc';
}
// Nur fuer die eigenen Tests: Bedrock-Accounts ohne Microsoft-Login (gegen einen Testserver)
const BEDROCK_TEST_OFFLINE = process.env.AFK_TEST_BEDROCK_OFFLINE === '1';

function nativeWebrtcAvailable() {
  // So suchen, wie es das NetherNet-Paket selbst tut (von seinem Ordner aus)
  try {
    const bp = path.dirname(require.resolve('bedrock-protocol'));
    const nnDir = path.dirname(require.resolve('nethernet/package.json', { paths: [bp] }));
    require.resolve('@roamhq/wrtc', { paths: [nnDir] });
    return true;
  } catch (_) {
    return false;
  }
}
const HIDE_DELAY_MS = parseInt(process.env.HIDE_DELAY_MS || '60000', 10);
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
// Name des Owner-Benutzers, der beim allerersten Start angelegt wird (danach egal)
const DASHBOARD_OWNER = /^[A-Za-z0-9_.-]{1,32}$/.test(process.env.DASHBOARD_OWNER || '')
  ? process.env.DASHBOARD_OWNER
  : 'admin';
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const ACCOUNTS_BACKUP_FILE = path.join(__dirname, 'accounts.backup.json');
const CHAT_HISTORY_MS = 10 * 60 * 1000; // 10 Minuten

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_CHAT_WEBHOOK_URL = process.env.DISCORD_CHAT_WEBHOOK_URL || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '';
const DISCORD_COMMAND_PREFIX = process.env.DISCORD_COMMAND_PREFIX || '!mc';
const DISCORD_SUMMARY_HOUR = parseInt(process.env.DISCORD_SUMMARY_HOUR || '23', 10);
const DISCORD_SUMMARY_MINUTE = parseInt(process.env.DISCORD_SUMMARY_MINUTE || '55', 10);
const DISCORD_ALLOWED_ROLE_IDS = (process.env.DISCORD_ALLOWED_ROLE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function hasAllowedRole(member) {
  if (DISCORD_ALLOWED_ROLE_IDS.length === 0) return true; // keine Einschraenkung konfiguriert
  if (!member || !member.roles) return false;
  return member.roles.cache.some((role) => DISCORD_ALLOWED_ROLE_IDS.includes(role.id));
}


// ---------- Mehrbenutzer-Login (Owner / Admin / User, per Cookie-Sitzung) ----------
const USERS_FILE = path.join(__dirname, 'users.json');
const USERS_BACKUP_FILE = path.join(__dirname, 'users.backup.json');
const SESSION_COOKIE = 'afk_session';
// Session-Token -> { id, username, ip, device, ua, createdAt, lastSeen, lastIp }
// (im Speicher, geht bei Neustart verloren - ein Neustart meldet also alle Geraete ab)
const sessions = new Map();
const audit = require('./audit');

// ---- Passwort-Hashing: Node's eingebautes crypto.scrypt, keine zusaetzliche Abhaengigkeit ----
// Synchrone Variante: nur fuer die einmalige Migration beim Start (vor dem Hochfahren des
// Servers). Im laufenden Betrieb IMMER die async-Varianten unten benutzen - scryptSync
// blockiert den ganzen Prozess (alle Bots, Discord, Webseite) fuer die Dauer der Berechnung.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
// Gleiche Parameter wie scryptSync -> erzeugt/prueft exakt dieselben Hashes wie bisher,
// bestehende Passwoerter in users.json funktionieren also weiter.
const scryptAsync = promisify(crypto.scrypt);
async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}
async function verifyPasswordAsync(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = await scryptAsync(password, salt, 64);
  const a = Buffer.from(hash, 'hex');
  if (a.length !== check.length) return false;
  return crypto.timingSafeEqual(a, check);
}

// ---- Bremse gegen Passwort-Raten: Die Seite ist ueber das Internet erreichbar, und jede
// Passwortpruefung kostet Rechenzeit. Nach zu vielen Fehlversuchen von derselben IP wird
// eine Zeit lang gar nicht mehr gerechnet. ----
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginFails = new Map(); // IP -> Zeitstempel der letzten Fehlversuche
function loginClientIp(req) {
  // Hinter dem Cloudflare-Tunnel steht die echte Besucher-IP in diesem Header
  return String(req.headers['cf-connecting-ip'] || req.ip || 'unbekannt');
}
// ---------- Protokoll (audit.js): wer hat was gemacht ----------
// Webseite: Eintrag mit Benutzer, Rolle, IP-Adresse, Geraet und Sitzung
function auditWeb(req, action, target = null, detail = '', extra = {}) {
  const user = extra.user || req.user;
  const sess = extra.session || req.sessionInfo;
  const ua = String(req.headers['user-agent'] || '');
  return audit.write({
    src: 'web',
    who: extra.who || (user ? user.username : '(nicht angemeldet)'),
    role: user ? user.role : undefined,
    ip: loginClientIp(req),
    device: audit.deviceFromUA(ua),
    ua,
    session: sess ? sess.id : undefined,
    action,
    target: target || undefined,
    detail: detail || undefined,
  });
}

// Discord: Eintrag mit Discord-Name und -ID und Kanal
function discordWho(u) {
  if (!u) return '?';
  const name = u.globalName && u.globalName !== u.username ? `${u.globalName} (@${u.username})` : `@${u.username || u.tag || '?'}`;
  return `${name} [${u.id}]`;
}
function auditDiscord(user, channel, action, target = null, detail = '') {
  return audit.write({
    src: 'discord',
    who: discordWho(user),
    discordId: user && user.id,
    channel: channel ? (channel.name || channel.id || String(channel)) : undefined,
    action,
    target: target || undefined,
    detail: detail || undefined,
  });
}

// Sicherheitsrelevantes optional zusaetzlich sofort nach Discord (Kanal fuer Benachrichtigungen).
// Standard: AUS - das Protokoll gibt es nur im Dashboard (nur fuer den Owner).
// Einschalten: AUDIT_DISCORD=1 in der .env
const AUDIT_DISCORD = /^(1|true|ja|yes|an)$/i.test(process.env.AUDIT_DISCORD || '');
function securityNotice(text, ip, device) {
  if (!AUDIT_DISCORD) return;
  try {
    sendDiscordEmbed({
      title: '🛡️ Protokoll',
      description: `${text}\n\nIP-Adresse: \`${ip || '?'}\` · Gerät: ${device || '?'}\n_Nicht du? Dashboard → Admin → Aktive Anmeldungen, Passwort ändern._`,
      color: DISCORD_COLOR_WARN,
    });
  } catch (e) {
    console.error('[Protokoll] Discord-Meldung fehlgeschlagen:', e.message);
  }
}

// Alle Sitzungen eines Benutzers beenden (ausser exceptToken). Gibt die Anzahl zurueck.
function endSessionsOf(username, exceptToken = null) {
  let n = 0;
  for (const [token, sess] of sessions.entries()) {
    if (sess.username === username && token !== exceptToken) {
      sessions.delete(token);
      n++;
    }
  }
  return n;
}

function loginRecentFails(ip) {
  const now = Date.now();
  const list = (loginFails.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (list.length > 0) loginFails.set(ip, list);
  else loginFails.delete(ip);
  return list;
}
setInterval(() => {
  for (const ip of [...loginFails.keys()]) loginRecentFails(ip);
}, LOGIN_WINDOW_MS).unref();

// ---- Benutzer laden/speichern (gleiches atomisches Muster wie bei accounts.json) ----
function loadUsers() {
  for (const file of [USERS_FILE, USERS_BACKUP_FILE]) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw)) continue;
      if (raw.length === 0 && file === USERS_FILE && fs.existsSync(USERS_BACKUP_FILE)) continue;
      if (file === USERS_BACKUP_FILE) console.warn('users.json nicht lesbar/leer - Backup wird verwendet!');
      return raw.map((u) => ({
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role === 'owner' || u.role === 'admin' ? u.role : 'user',
        // Nur fuer role 'user' relevant: welche Minecraft-Accounts sichtbar/bedienbar sind
        allowedAccounts: Array.isArray(u.allowedAccounts) ? u.allowedAccounts : [],
      }));
    } catch (e) {
      console.error(`Fehler beim Laden von ${file}:`, e.message);
    }
  }
  return [];
}

function saveUsers() {
  if (users.length === 0) {
    try {
      const existing = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(existing) && existing.length > 0) {
        console.error('saveUsers: Versuch, users.json mit leerer Liste zu ueberschreiben - abgebrochen!');
        return;
      }
    } catch (_) { /* Datei existiert noch nicht - leere Liste ist ok */ }
  }
  const tmp = USERS_FILE + '.tmp';
  const data = JSON.stringify(users, null, 2);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, USERS_FILE);
  try {
    fs.writeFileSync(USERS_BACKUP_FILE, data);
  } catch (e) {
    console.error('Backup-Schreiben (users) fehlgeschlagen (nicht kritisch):', e.message);
  }
}

let users = loadUsers();

// Migration: beim allerersten Start (noch keine users.json) automatisch einen Owner-Account
// aus dem bisherigen DASHBOARD_PASSWORD anlegen, damit niemand ausgesperrt wird.
if (users.length === 0 && DASHBOARD_PASSWORD) {
  users.push({
    username: DASHBOARD_OWNER,
    passwordHash: hashPassword(DASHBOARD_PASSWORD),
    role: 'owner',
    allowedAccounts: [],
  });
  saveUsers();
  console.log(`Erster Start: Owner-Benutzer "${DASHBOARD_OWNER}" mit dem Passwort aus DASHBOARD_PASSWORD angelegt.`);
}

function findUser(username) {
  if (!username) return null;
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
}

// Pseudo-Nutzer fuer den Fall, dass gar kein DASHBOARD_PASSWORD gesetzt ist - das Dashboard
// ist dann komplett ungeschuetzt (wie bisher), jeder Besucher hat vollen Owner-Zugriff.
const NO_AUTH_USER = { username: '(kein Login)', role: 'owner', allowedAccounts: [] };

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  });
  return cookies;
}

// Liefert den eingeloggten Benutzer (mit role + allowedAccounts) oder null.
function getUserFromReq(req) {
  if (!DASHBOARD_PASSWORD) return NO_AUTH_USER;
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  const sess = token ? sessions.get(token) : null;
  if (!sess) return null;
  const user = findUser(sess.username);
  if (!user) return null;
  // Fuer das Protokoll: zuletzt gesehen + von welcher Adresse
  sess.lastSeen = Date.now();
  sess.lastIp = loginClientIp(req);
  req.sessionInfo = sess;
  req.sessionToken = token;
  return user;
}

function isAuthenticated(req) {
  return !!getUserFromReq(req);
}

function checkAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) {
    req.user = NO_AUTH_USER;
    return next();
  }
  // Login-Seite und Login-Endpunkt sind immer erreichbar, auch ohne Sitzung
  if (req.path === '/login' || req.path === '/api/login') return next();

  const user = getUserFromReq(req);
  if (user) {
    req.user = user;
    return next();
  }

  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }
  return res.redirect('/login');
}

// Middleware: nur Owner darf weiter (Admins anlegen/loeschen/befoerdern)
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Das darf nur der Owner.' });
  }
  next();
}

// Middleware: Owner ODER Admin duerfen weiter (Nutzerverwaltung, Minecraft-Account-Verwaltung)
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Keine Berechtigung.' });
  }
  next();
}

// Darf dieser Nutzer auf diesen einen Minecraft-Account zugreifen (starten/chatten/steuern)?
function canAccessAccount(user, mcUsername) {
  if (!user) return false;
  if (user.role !== 'user') return true; // Owner/Admin duerfen alles
  // Rechte gelten pro Account - fuer alle seine Verbindungen (alpha und alpha@lobby)
  return user.allowedAccounts.includes(connUser(String(mcUsername || '')));
}

// Middleware-Fabrik: prueft canAccessAccount fuer req.params.username
function requireAccountAccess(req, res, next) {
  if (!canAccessAccount(req.user, req.params.username)) {
    return res.status(403).json({ error: 'Kein Zugriff auf diesen Account.' });
  }
  next();
}

// Middleware: Minecraft-Accounts VERWALTEN (anlegen, umbenennen, loeschen, Auto-Chat
// bearbeiten, Chat-Quelle per Stern festlegen) duerfen nur Owner/Admin - normale
// User-Rollen bekommen nur Start/Stop, Chat und Steuerung (siehe canAccessAccount oben).
function requireManageRights(req, res, next) {
  if (!req.user || req.user.role === 'user') {
    return res.status(403).json({ error: 'Keine Berechtigung.' });
  }
  next();
}

io.use((socket, next) => {
  if (!DASHBOARD_PASSWORD) {
    socket.user = NO_AUTH_USER;
    return next();
  }
  const cookies = parseCookies({ headers: { cookie: socket.handshake.headers.cookie } });
  const token = cookies[SESSION_COOKIE];
  const sess = token ? sessions.get(token) : null;
  const user = sess ? findUser(sess.username) : null;
  if (user) {
    socket.user = user;
    return next();
  }
  next(new Error('unauthorized'));
});

app.use(checkAuth);
app.use(express.json());

// Die HTML-Seiten enthalten Platzhalter fuer den Servernamen, die hier ersetzt werden
const PAGE_VALUES = {
  '{{TITEL}}': htmlText(DASHBOARD_TITLE),
  '{{SERVER}}': htmlText(MC_SERVER_HOST),
};
function htmlText(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function sendPage(res, file) {
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Seite fehlt: ' + path.basename(file));
    for (const [key, value] of Object.entries(PAGE_VALUES)) html = html.split(key).join(value);
    res.type('html').set('Cache-Control', 'no-cache').send(html);
  });
}

app.get('/login', (req, res) => {
  sendPage(res, path.join(__dirname, 'login.html'));
});

app.get('/admin', (req, res) => {
  if (!req.user || (req.user.role !== 'owner' && req.user.role !== 'admin')) {
    return res.redirect('/');
  }
  sendPage(res, path.join(__dirname, 'admin.html'));
});

app.post('/api/login', async (req, res) => {
  if (!DASHBOARD_PASSWORD) return res.json({ ok: true });
  const ip = loginClientIp(req);
  if (loginRecentFails(ip).length >= LOGIN_MAX_FAILS) {
    return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.' });
  }
  try {
    const { username, password } = req.body || {};
    const user = findUser(username);
    const passwordText = typeof password === 'string' ? password : '';
    if (user && (await verifyPasswordAsync(passwordText, user.passwordHash))) {
      loginFails.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      const ua = String(req.headers['user-agent'] || '');
      const sess = {
        id: crypto.randomBytes(6).toString('hex'),
        username: user.username,
        ip,
        ua,
        device: audit.deviceFromUA(ua),
        createdAt: Date.now(),
        lastSeen: Date.now(),
        lastIp: ip,
      };
      sessions.set(token, sess);
      const newIp = audit.isNewIpFor(user.username, ip);
      auditWeb(req, 'Anmeldung', null, newIp ? 'erste Anmeldung von dieser IP-Adresse' : '', { user, session: sess });
      if (newIp) {
        securityNotice(`🔑 **${user.username}** hat sich im Dashboard von einer neuen IP-Adresse angemeldet`, sess.ip, sess.device);
      }
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      );
      return res.json({ ok: true });
    }
    loginFails.set(ip, [...loginRecentFails(ip), Date.now()]);
    auditWeb(req, 'Anmeldung fehlgeschlagen', null, `Benutzername "${String(username || '').slice(0, 40)}"${user ? '' : ' (gibt es nicht)'}`, { who: '(nicht angemeldet)' });
    return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  } catch (e) {
    console.error('Login-Fehler:', e.message);
    return res.status(500).json({ error: 'Login fehlgeschlagen (Serverfehler)' });
  }
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE] && sessions.has(cookies[SESSION_COOKIE])) {
    auditWeb(req, 'Abmeldung');
    sessions.delete(cookies[SESSION_COOKIE]);
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({
    username: req.user.username,
    role: req.user.role,
    allowedAccounts: req.user.allowedAccounts,
  });
});

// ---------- Benutzerverwaltung (nur Owner/Admin) ----------

// Owner sieht alle Benutzer (Owner, Admins, Users). Admin sieht nur normale User-Accounts,
// nicht andere Admins oder den Owner.
// Eigenes Passwort aendern (jeder angemeldete Benutzer, auch Owner und Admins)
app.post('/api/me/password', async (req, res) => {
  if (!req.user || !req.user.passwordHash) return res.status(400).json({ error: 'Ohne Benutzerkonto nicht moeglich' });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen haben' });
  }
  const ok = await verifyPasswordAsync(typeof currentPassword === 'string' ? currentPassword : '', req.user.passwordHash).catch(() => false);
  if (!ok) {
    auditWeb(req, 'Passwortänderung abgelehnt', req.user.username, 'aktuelles Passwort falsch');
    return res.status(403).json({ error: 'Das aktuelle Passwort stimmt nicht' });
  }
  try {
    req.user.passwordHash = await hashPasswordAsync(newPassword);
  } catch (e) {
    return res.status(500).json({ error: 'Passwort konnte nicht verarbeitet werden' });
  }
  saveUsers();
  const ended = endSessionsOf(req.user.username, req.sessionToken);
  auditWeb(req, 'Eigenes Passwort geändert', req.user.username, ended ? `${ended} andere(s) Gerät(e) abgemeldet` : '');
  securityNotice(`🔒 **${req.user.username}** hat das eigene Dashboard-Passwort geändert${ended ? ` (${ended} andere(s) Gerät(e) abgemeldet)` : ''}`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true, ended });
});

app.get('/api/users', requireAdmin, (req, res) => {
  // Admin sieht ALLE Benutzer (auch andere Admins und den Owner) - darf sie aber ueber
  // PUT/DELETE unten nicht bearbeiten oder loeschen, nur normale User-Accounts.
  res.json(
    users.map((u) => ({
      username: u.username,
      role: u.role,
      allowedAccounts: u.allowedAccounts,
    }))
  );
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role, allowedAccounts } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Benutzername fehlt' });
  }
  // Nur einfache Zeichen - der Name erscheint auf der Admin-Seite und im Protokoll
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(username.trim())) {
    return res.status(400).json({ error: 'Benutzername: nur Buchstaben, Ziffern, _ . - (hoechstens 32 Zeichen)' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
  }
  if (findUser(username)) {
    return res.status(400).json({ error: 'Benutzername existiert schon' });
  }

  // Admins duerfen nur normale User-Accounts anlegen, keine Admins
  let finalRole = role === 'admin' ? 'admin' : 'user';
  if (req.user.role === 'admin') {
    finalRole = 'user';
  }

  let newPasswordHash;
  try {
    newPasswordHash = await hashPasswordAsync(password);
  } catch (e) {
    return res.status(500).json({ error: 'Passwort konnte nicht verarbeitet werden' });
  }
  // Waehrend der Berechnung kann ein anderer Request denselben Namen angelegt haben
  if (findUser(username)) {
    return res.status(400).json({ error: 'Benutzername existiert schon' });
  }

  const newUser = {
    username: username.trim(),
    passwordHash: newPasswordHash,
    role: finalRole,
    allowedAccounts: finalRole === 'user' && Array.isArray(allowedAccounts)
      ? allowedAccounts.filter((a) => typeof a === 'string')
      : [],
  };
  users.push(newUser);
  saveUsers();
  auditWeb(req, 'Benutzer angelegt', newUser.username, `Rolle ${newUser.role}${newUser.allowedAccounts.length ? `, Accounts: ${newUser.allowedAccounts.join(', ')}` : ''}`);
  securityNotice(`👤 Neuer Dashboard-Benutzer **${newUser.username}** (Rolle ${newUser.role}) angelegt von **${req.user.username}**`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true, username: newUser.username, role: newUser.role, allowedAccounts: newUser.allowedAccounts });
});

app.put('/api/users/:username', requireAdmin, async (req, res) => {
  const target = findUser(req.params.username);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  // Admins duerfen ausschliesslich normale User-Accounts bearbeiten - keine anderen
  // Admins und nicht den Owner.
  if (req.user.role === 'admin' && target.role !== 'user') {
    return res.status(403).json({ error: 'Keine Berechtigung fuer diesen Benutzer.' });
  }

  const { password, allowedAccounts, role } = req.body || {};
  const changes = [];
  const roleBefore = target.role;

  if (password) {
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
    }
    try {
      target.passwordHash = await hashPasswordAsync(password);
    } catch (e) {
      return res.status(500).json({ error: 'Passwort konnte nicht verarbeitet werden' });
    }
    changes.push('Passwort geändert');
    // Ein neues Passwort meldet alle anderen Geraete dieses Benutzers ab
    const ended = endSessionsOf(target.username, req.sessionToken);
    if (ended) changes.push(`${ended} Gerät(e) abgemeldet`);
  }

  if (Array.isArray(allowedAccounts) && target.role === 'user') {
    const before = target.allowedAccounts.join(', ');
    target.allowedAccounts = allowedAccounts.filter((a) => typeof a === 'string');
    const after = target.allowedAccounts.join(', ');
    if (before !== after) changes.push(`Accounts: ${after || '(keine)'}`);
  }

  // Nur der Owner darf Rollen aendern (admin <-> user), und nie zu/von "owner"
  if (role && req.user.role === 'owner' && (role === 'admin' || role === 'user') && target.role !== 'owner') {
    target.role = role;
    if (role === 'admin') target.allowedAccounts = []; // Admins brauchen keine Einschraenkung
  }
  if (target.role !== roleBefore) changes.push(`Rolle ${roleBefore} -> ${target.role}`);

  saveUsers();
  if (changes.length) {
    auditWeb(req, 'Benutzer geändert', target.username, changes.join(', '));
    if (changes.some((c) => c.startsWith('Passwort') || c.startsWith('Rolle'))) {
      securityNotice(`👤 Dashboard-Benutzer **${target.username}** geändert von **${req.user.username}**: ${changes.join(', ')}`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
    }
  }
  res.json({ ok: true, username: target.username, role: target.role, allowedAccounts: target.allowedAccounts });
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const target = findUser(req.params.username);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (target.role === 'owner') {
    return res.status(403).json({ error: 'Der Owner-Account kann nicht geloescht werden.' });
  }
  if (req.user.role === 'admin' && target.role !== 'user') {
    return res.status(403).json({ error: 'Keine Berechtigung fuer diesen Benutzer.' });
  }
  if (target.username === req.user.username) {
    return res.status(403).json({ error: 'Du kannst dich nicht selbst loeschen.' });
  }

  users = users.filter((u) => u.username !== target.username);
  saveUsers();
  // Alle bestehenden Sitzungen dieses Benutzers sofort ungueltig machen
  endSessionsOf(target.username);
  auditWeb(req, 'Benutzer gelöscht', target.username, `Rolle ${target.role}`);
  securityNotice(`👤 Dashboard-Benutzer **${target.username}** wurde von **${req.user.username}** gelöscht`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true });
});

// ---------- Protokoll und aktive Anmeldungen (Admin-Seite, nur fuer den Owner) ----------
app.get('/api/audit', requireOwner, (req, res) => {
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  res.json({ entries: audit.readRecent(limit) });
});

// Nur der Owner sieht (und beendet) Anmeldungen - dann alle
function visibleSessions() {
  return [...sessions.entries()].map(([token, sess]) => ({ token, sess }));
}

app.get('/api/sessions', requireOwner, (req, res) => {
  res.json({
    sessions: visibleSessions()
      .map(({ token, sess }) => ({
        id: sess.id,
        username: sess.username,
        ip: sess.ip,
        lastIp: sess.lastIp,
        device: sess.device,
        createdAt: sess.createdAt,
        lastSeen: sess.lastSeen,
        current: token === req.sessionToken,
      }))
      .sort((a, b) => b.lastSeen - a.lastSeen),
  });
});

app.delete('/api/sessions/:id', requireOwner, (req, res) => {
  const hit = visibleSessions().find(({ sess }) => sess.id === req.params.id);
  if (!hit) return res.status(404).json({ error: 'Anmeldung nicht gefunden' });
  sessions.delete(hit.token);
  auditWeb(req, 'Gerät abgemeldet', hit.sess.username, `${hit.sess.device}, IP ${hit.sess.lastIp || hit.sess.ip}`);
  res.json({ ok: true });
});

app.post('/api/sessions/end-others', requireOwner, (req, res) => {
  let n = 0;
  for (const { token } of visibleSessions()) {
    if (token === req.sessionToken) continue;
    sessions.delete(token);
    n++;
  }
  auditWeb(req, 'Alle anderen Geräte abgemeldet', null, `${n} Anmeldung(en) beendet`);
  res.json({ ok: true, ended: n });
});

// Skripte, die Erweiterungen fuer die Verwaltungsseite mitbringen - nur fuer den Owner
app.get('/erweiterungen/admin.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  if (!req.user || req.user.role !== 'owner') return res.send('');
  res.send(extAdminScripts.map((code) => `;(function () {\n${code}\n})();`).join('\n'));
});

app.get(['/', '/index.html'], (req, res) => {
  sendPage(res, path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Accounts laden/speichern ----------
function loadAccounts() {
  // Versuche zuerst die Hauptdatei zu laden, bei Fehler automatisch das Backup verwenden
  for (const file of [ACCOUNTS_FILE, ACCOUNTS_BACKUP_FILE]) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw)) continue; // Leere oder kaputte Datei -> naechste versuchen
      if (raw.length === 0 && file === ACCOUNTS_FILE && fs.existsSync(ACCOUNTS_BACKUP_FILE)) {
        // Hauptdatei ist leer aber Backup existiert -> sicherheitshalber Backup bevorzugen
        console.warn('accounts.json ist leer - versuche accounts.backup.json...');
        continue;
      }
      if (file === ACCOUNTS_BACKUP_FILE) {
        console.warn('accounts.json nicht lesbar oder leer - Backup wird verwendet!');
      }
      // Migration: alte Eintraege bereinigen
      const result = raw.map((a) => ({
        username: a.username,
        authType: 'premium',
        // Wurde dieser Account schon mindestens einmal erfolgreich verbunden?
        // Wichtig, damit /hide auch nach einem Serverneustart (also einem "Reconnect" aus
        // Sicht des Minecraft-Servers) korrekt gesendet wird, nicht nur bei einem echten
        // ersten Join seit dem letzten Programmstart.
        everJoined: a.everJoined === true,
        // Welcher Account SOLL eigentlich die Chat-Quelle sein (unabhaengig davon, ob er
        // gerade temporaer verdraengt wurde, weil er woanders eingeloggt ist).
        preferredChatSource: a.preferredChatSource === true,
        // Fester, NIE veraenderlicher Schluessel, mit dem sich prismarine-auth die
        // Microsoft-Zugangsdaten merkt. Bleibt beim Umbenennen unangetastet, damit man
        // sich nach einem Rename nicht neu per Microsoft anmelden muss.
        authCacheId: a.authCacheId || a.username,
        // Liste von Auto-Chat-Aktionen nach jedem Reconnect.
        // Format: [{ text: '/hide', delaySeconds: 60 }, ...]
        // Leer = keine automatischen Nachrichten.
        autoChat: Array.isArray(a.autoChat) ? a.autoChat : [],
        // Soll bei "anderswo eingeloggt" eine Discord-Nachricht kommen? Neue Accounts bekommen
        // beim Anlegen "aus"; aeltere Eintraege ohne diese Angabe bleiben wie bisher "an".
        notifyElsewhere: a.notifyElsewhere !== false,
        // Offene "anderswo eingeloggt"-Meldung mit Start-Knopf (wird beim naechsten Start aktualisiert)
        elsewhereNotice: a.elsewhereNotice && a.elsewhereNotice.channelId && a.elsewhereNotice.messageId
          ? { channelId: String(a.elsewhereNotice.channelId), messageId: String(a.elsewhereNotice.messageId) }
          : undefined,
      }));
      // Falls (z.B. nach einem Update) noch niemand als bevorzugte Chat-Quelle markiert ist,
      // ist das per Definition der erste Account in der Liste.
      if (result.length > 0 && !result.some((a) => a.preferredChatSource)) {
        result[0].preferredChatSource = true;
      }
      return result;
    } catch (e) {
      console.error(`Fehler beim Laden von ${file}:`, e.message);
    }
  }
  return [];
}

// Bedrock-Accounts erkennt man am fuehrenden Punkt im Namen (Geyser-Konvention).
// Der echte Xbox-Gamertag hat keinen Punkt - der wird beim Auth-Flow ohne Punkt verwendet.
function isBedrockAccount(username) {
  return typeof username === 'string' && username.startsWith('.');
}

function saveAccounts() {
  // Sicherheits-Check: NIE eine leere Liste speichern wenn zuvor Accounts vorhanden waren.
  // Verhindert, dass ein Bug oder Race-Condition die accounts.json leer ueberschreibt.
  if (accounts.length === 0) {
    try {
      const existing = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (Array.isArray(existing) && existing.length > 0) {
        console.error('saveAccounts: Versuch, accounts.json mit leerer Liste zu ueberschreiben obwohl noch Eintraege vorhanden sind - abgebrochen!');
        return;
      }
    } catch (_) { /* Datei existiert noch nicht - leere Liste ist ok */ }
  }

  // Atomisches Schreiben: erst in eine Temp-Datei, dann umbenennen.
  // Verhindert eine halbgeschriebene/korrupte Datei wenn der Prozess mitten im Schreiben stirbt.
  const tmp = ACCOUNTS_FILE + '.tmp';
  const data = JSON.stringify(accounts, null, 2);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, ACCOUNTS_FILE);

  // Backup separat schreiben - wird verwendet wenn die Hauptdatei kuenftig leer/korrupt ist
  try {
    fs.writeFileSync(ACCOUNTS_BACKUP_FILE, data);
  } catch (e) {
    console.error('Backup-Schreiben fehlgeschlagen (nicht kritisch):', e.message);
  }
}

// Loescht die von prismarine-auth gespeicherten Microsoft-Zugangsdaten fuer einen Account.
// Die Bibliothek benennt die Cache-Dateien nach einem SHA1-Hash (erste 6 Zeichen) des
// uebergebenen Cache-Schluessels, z.B. "a1b2c3_xbl-cache.json", "a1b2c3_live-cache.json" usw.
function deleteAuthCacheFiles(authCacheId) {
  try {
    const cacheDir = path.join(minecraftFolderPath, 'nmp-cache');
    if (!fs.existsSync(cacheDir)) return;
    const hash = crypto.createHash('sha1').update(authCacheId ?? '', 'binary').digest('hex').substring(0, 6);
    const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith(`${hash}_`) && f.endsWith('-cache.json'));
    files.forEach((f) => {
      fs.unlinkSync(path.join(cacheDir, f));
      console.log(`Login-Cache-Datei geloescht: ${f}`);
    });
    if (files.length > 0) {
      console.log(`${files.length} Login-Cache-Datei(en) fuer Account geloescht (Cache-Schluessel: ${authCacheId})`);
    }
  } catch (e) {
    console.error('Fehler beim Loeschen der Login-Cache-Dateien:', e.message);
  }
}

function deleteBedrockCacheFiles(username) {
  // Bedrock-protocol speichert seinen Auth-Cache in einem eigenen Unterordner.
  // Der Cache-Schluessel ist ein SHA1-Hash des Xbox-Gamertags (ohne fuehrenden Punkt).
  try {
    const bedrockCacheDir = path.join(minecraftFolderPath, 'nmp-cache', 'bedrock');
    if (!fs.existsSync(bedrockCacheDir)) return;
    const gamertag = username.startsWith('.') ? username.slice(1) : username;
    const hash = crypto.createHash('sha1').update(gamertag ?? '', 'binary').digest('hex').substring(0, 6);
    const files = fs.readdirSync(bedrockCacheDir).filter((f) => f.startsWith(`${hash}_`));
    files.forEach((f) => {
      fs.unlinkSync(path.join(bedrockCacheDir, f));
      console.log(`Bedrock-Cache-Datei geloescht: ${f}`);
    });
    if (files.length > 0) {
      console.log(`${files.length} Bedrock-Cache-Datei(en) fuer ${username} geloescht`);
    }
  } catch (e) {
    console.error('Fehler beim Loeschen der Bedrock-Cache-Dateien:', e.message);
  }
}

let accounts = loadAccounts(); // [{ username, authType: 'premium', everJoined: bool, preferredChatSource: bool }]

// ---------- Mehrere Server: Schalter (.env) ----------
// Java-Accounts auf weiteren Servern: Standard AN (ohne weitere Server merkt man davon nichts)
const MULTI_SERVER_JAVA = !/^(0|false|nein|no|aus|off)$/i.test(String(process.env.MULTI_SERVER_JAVA || '').trim());
// Bedrock-Accounts auf weiteren Servern: Standard AUS (mehr Last, erst testen), plus Obergrenze
const MULTI_SERVER_BEDROCK = /^(1|true|ja|yes|an|on)$/i.test(String(process.env.MULTI_SERVER_BEDROCK || '').trim());
const MULTI_SERVER_BEDROCK_MAX = Math.max(0, Math.min(50, parseInt(process.env.MULTI_SERVER_BEDROCK_MAX || '2', 10) || 0));

// ---------- Serverliste (servers.json) ----------
// Der Standardserver steht NICHT in der Datei, er kommt immer aus der .env. In servers.json
// stehen nur die weiteren Server und die Auto-Chat-Vorlagen. Aeltere Versionen kennen die
// Datei nicht und ignorieren sie - ein Zurueck zur alten Version ist also jederzeit moeglich.
const SERVERS_FILE = path.join(__dirname, 'servers.json');
const SERVERS_BACKUP_FILE = path.join(__dirname, 'servers.backup.json');
// Unveraenderte Kopie der accounts.json vom ersten Start der Mehrserver-Version
const ACCOUNTS_PREMULTI_FILE = path.join(__dirname, 'accounts.vor-mehrserver.json');
const SERVER_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;
// "standard" ist der Standardserver, "alle" steht in Discord fuer alle Server
const RESERVED_SERVER_IDS = new Set(['standard', 'default', 'alle', 'all']);
const SERVER_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._#()+-]{0,31}$/u;
const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const MAX_EXTRA_SERVERS = 20;
const AUTOCHAT_TEMPLATE_MAX = 10;
const AUTOCHAT_TEXT_MAX = 256;
const AUTOCHAT_DELAY_MAX = 24 * 60 * 60;

// Erste Sicherung vor der Mehrserver-Version: accounts.json einmalig unveraendert kopieren
function backupAccountsBeforeMultiServer() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE) && !fs.existsSync(ACCOUNTS_PREMULTI_FILE)) {
      fs.copyFileSync(ACCOUNTS_FILE, ACCOUNTS_PREMULTI_FILE, fs.constants.COPYFILE_EXCL);
      console.log('[Server] Sicherung angelegt: accounts.vor-mehrserver.json (Stand vor der Mehrserver-Version)');
    }
  } catch (e) {
    console.error('[Server] Sicherung accounts.vor-mehrserver.json fehlgeschlagen:', e.message);
  }
}

function cleanText(v) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
}
function parsePort(v) {
  if (v === undefined || v === null || v === '') return { value: null };
  const str = String(v).trim();
  if (str === '') return { value: null };
  if (!/^\d{1,5}$/.test(str)) return { error: 'Port muss eine Zahl von 1 bis 65535 sein' };
  const n = parseInt(str, 10);
  if (n < 1 || n > 65535) return { error: 'Port muss eine Zahl von 1 bis 65535 sein' };
  return { value: n };
}
function normalizeHost(v) {
  let h = cleanText(v).toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // [IPv6]
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}
function hostProblem(h) {
  if (!h) return 'Adresse fehlt';
  if (net.isIP(h)) return null;
  if (/:\d+$/.test(h)) return 'Bitte die Adresse ohne Port eintragen - der Port kommt ins eigene Feld';
  if (!HOSTNAME_RE.test(h)) return 'Ungültige Adresse (erlaubt: z.B. play.example.net oder 192.168.1.20)';
  return null;
}
// Eine Auto-Chat-Aktion pruefen (fuer Vorlagen)
function cleanAutoChatEntry(e) {
  const text = cleanText(e && e.text);
  if (!text) return { error: 'Text fehlt' };
  if (text.length > AUTOCHAT_TEXT_MAX) return { error: `Text zu lang (max. ${AUTOCHAT_TEXT_MAX} Zeichen)` };
  const str = String(e && e.delaySeconds !== undefined ? e.delaySeconds : '').trim();
  if (!/^\d{1,6}$/.test(str)) return { error: 'Wartezeit muss eine ganze Zahl (Sekunden) sein' };
  const delay = parseInt(str, 10);
  if (delay > AUTOCHAT_DELAY_MAX) return { error: 'Wartezeit höchstens 24 Stunden' };
  return { value: { text, delaySeconds: delay } };
}
function cleanTemplate(list) {
  if (!Array.isArray(list)) return [];
  return list.map(cleanAutoChatEntry).filter((r) => r.value).map((r) => r.value).slice(0, AUTOCHAT_TEMPLATE_MAX);
}

// Kuerzel aus dem Namen bauen: "Mein Lobby-Server" -> "mein-lobby-server"
function serverIdFromName(name, taken) {
  let base = String(name).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 20).replace(/-+$/, '');
  if (!base || RESERVED_SERVER_IDS.has(base)) base = base ? `${base}-1` : 'server';
  let id = base;
  for (let i = 2; taken.has(id) || RESERVED_SERVER_IDS.has(id); i++) id = `${base}-${i}`;
  return id;
}

// Eingaben fuer einen weiteren Server pruefen. others = alle anderen Server (inkl. Standardserver).
// Gibt { value } oder { error } zurueck.
function validateServerInput(body, { others, existing = null }) {
  const b = body || {};
  const name = cleanText(b.name !== undefined ? b.name : existing && existing.name);
  if (!name) return { error: 'Name fehlt' };
  if (!SERVER_NAME_RE.test(name)) return { error: 'Name: 1-32 Zeichen, Buchstaben, Ziffern, Leerzeichen und . _ # ( ) + -' };
  if (others.some((o) => o.name.toLowerCase() === name.toLowerCase())) return { error: 'Einen Server mit diesem Namen gibt es schon' };

  let id = existing ? existing.id : cleanText(b.id).toLowerCase();
  const taken = new Set(others.map((o) => o.id));
  if (!existing) {
    if (!id) id = serverIdFromName(name, taken);
    if (!SERVER_ID_RE.test(id)) return { error: 'Kürzel: 1-24 Zeichen, nur a-z, 0-9 und - (nicht am Anfang/Ende)' };
    if (RESERVED_SERVER_IDS.has(id)) return { error: `Das Kürzel "${id}" ist reserviert` };
    if (taken.has(id)) return { error: 'Dieses Kürzel ist schon vergeben' };
  }

  const host = normalizeHost(b.host !== undefined ? b.host : existing && existing.host);
  const hp = hostProblem(host);
  if (hp) return { error: hp };
  const jp = parsePort(b.javaPort !== undefined ? b.javaPort : existing && existing.javaPort);
  if (jp.error) return { error: `Java-${jp.error}` };
  const bp = parsePort(b.bedrockPort !== undefined ? b.bedrockPort : existing && existing.bedrockPort);
  if (bp.error) return { error: `Bedrock-${bp.error}` };
  if (!jp.value && !bp.value) return { error: 'Mindestens einen Port eintragen (Java und/oder Bedrock)' };
  // Gleicher Server zweimal -> derselbe Account wuerde sich selbst rauswerfen ("anderswo eingeloggt")
  const same = others.find((o) => o.host && o.host.toLowerCase() === host &&
    ((jp.value && o.javaPort === jp.value) || (bp.value && o.bedrockPort === bp.value)));
  if (same) return { error: `Diese Adresse mit diesem Port ist schon als "${same.name}" eingetragen` };

  return {
    value: {
      id,
      name,
      host,
      javaPort: jp.value,
      bedrockPort: bp.value,
      autoChatTemplate: existing ? existing.autoChatTemplate : cleanTemplate(b.autoChatTemplate),
    },
  };
}

function loadServerFile() {
  const empty = { defaultTemplate: [], servers: [] };
  for (const file of [SERVERS_FILE, SERVERS_BACKUP_FILE]) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.servers)) continue;
      if (file === SERVERS_BACKUP_FILE) console.warn('[Server] servers.json nicht lesbar - Sicherung wird verwendet!');
      const list = [];
      const others = [{ id: DEFAULT_SERVER_ID, name: DASHBOARD_TITLE, host: MC_SERVER_HOST.toLowerCase(), javaPort: MC_SERVER_PORT, bedrockPort: MC_BEDROCK_PORT }];
      for (const entry of raw.servers) {
        if (!entry || typeof entry !== 'object') continue;
        const r = validateServerInput({ ...entry, id: entry && entry.id }, { others: [...others, ...list] });
        if (r.error) {
          console.warn(`[Server] Eintrag in servers.json übersprungen (${r.error}):`, JSON.stringify(entry).slice(0, 200));
          continue;
        }
        if (r.value.id !== cleanText(entry.id).toLowerCase()) {
          console.warn(`[Server] Eintrag ohne gültiges Kürzel übersprungen: ${JSON.stringify(entry).slice(0, 200)}`);
          continue;
        }
        list.push(r.value);
      }
      return {
        defaultTemplate: cleanTemplate(raw.defaultServer && raw.defaultServer.autoChatTemplate),
        servers: list.slice(0, MAX_EXTRA_SERVERS),
      };
    } catch (e) {
      console.error(`[Server] Fehler beim Laden von ${path.basename(file)}:`, e.message);
    }
  }
  return empty;
}

function saveServers() {
  const data = JSON.stringify({
    version: 1,
    defaultServer: { autoChatTemplate: defaultServer.autoChatTemplate || [] },
    servers: servers.filter((sv) => !sv.isDefault).map((sv) => ({
      id: sv.id,
      name: sv.name,
      host: sv.host,
      javaPort: sv.javaPort,
      bedrockPort: sv.bedrockPort,
      autoChatTemplate: sv.autoChatTemplate || [],
    })),
  }, null, 2);
  const tmp = SERVERS_FILE + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, SERVERS_FILE);
  try {
    fs.writeFileSync(SERVERS_BACKUP_FILE, data);
  } catch (e) {
    console.error('[Server] Sicherung servers.backup.json fehlgeschlagen (nicht kritisch):', e.message);
  }
}

backupAccountsBeforeMultiServer();

// ---------- Server und Verbindungen ----------
// Eine Verbindung = ein Account auf einem Server. Alles, was pro Verbindung gilt (Bot, Status,
// Reconnect, Statistik, everJoined, Auto-Chat ...), haengt am Verbindungs-Schluessel:
//  - Standardserver: einfach der Accountname (wie vor der Mehrserver-Version)
//  - weitere Server: "Accountname@serverId"
// Accountnamen enthalten nie ein "@" (siehe ACCOUNT_NAME_RE), der Schluessel ist also eindeutig.
// Der Microsoft-Login (authCacheId) gehoert dem Account und wird von allen seinen
// Verbindungen geteilt; die Warteschlange (eine Verbindung nach der anderen) gilt fuer alle.
const DEFAULT_SERVER_ID = 'standard';
const defaultServer = {
  id: DEFAULT_SERVER_ID,
  name: DASHBOARD_TITLE,
  host: MC_SERVER_HOST,
  javaPort: MC_SERVER_PORT,
  bedrockPort: MC_BEDROCK_PORT,
  isDefault: true,
};
// Weitere Server (servers.json) + Auto-Chat-Vorlagen; siehe "Serverliste" weiter unten
const serverFile = loadServerFile();
defaultServer.autoChatTemplate = serverFile.defaultTemplate;
let servers = [defaultServer, ...serverFile.servers];
// Verbindungen zu weiteren Servern: [{ username, server, everJoined, autoChat, ... }]
// (verbindungen.json - aeltere Versionen kennen die Datei nicht und ignorieren sie)
const CONNECTIONS_FILE = path.join(__dirname, 'verbindungen.json');
const CONNECTIONS_BACKUP_FILE = path.join(__dirname, 'verbindungen.backup.json');
let invalidConnections = []; // Eintraege, die gerade nicht passen (bleiben in der Datei erhalten)
let extraConnections = loadExtraConnections();

function connKey(username, serverId) {
  return !serverId || serverId === DEFAULT_SERVER_ID ? username : `${username}@${serverId}`;
}
function connUser(key) {
  const i = String(key).lastIndexOf('@');
  return i > 0 ? key.slice(0, i) : key;
}
function connServerId(key) {
  const i = String(key).lastIndexOf('@');
  return i > 0 ? key.slice(i + 1) : DEFAULT_SERVER_ID;
}
function isDefaultConn(key) {
  return connServerId(key) === DEFAULT_SERVER_ID;
}
function getServer(id) {
  return servers.find((s) => s.id === id) || null;
}
function serverOf(key) {
  return getServer(connServerId(key));
}
function accountOf(key) {
  const u = connUser(key);
  return accounts.find((a) => a.username === u) || null;
}
// Einstellungen genau dieser Verbindung (everJoined, autoChat, preferredChatSource,
// notifyElsewhere, elsewhereNotice). Beim Standardserver stehen sie direkt am Account.
function connSettings(key) {
  if (isDefaultConn(key)) return accountOf(key);
  const u = connUser(key);
  const sid = connServerId(key);
  return extraConnections.find((c) => c.username === u && c.server === sid) || null;
}
function connectionExists(key) {
  return !!(accountOf(key) && serverOf(key) && connSettings(key));
}
function saveConnSettings(key) {
  if (isDefaultConn(key)) saveAccounts();
  else saveExtraConnections();
}
function cleanConnEntry(e) {
  if (!e || typeof e !== 'object') return { error: 'kein Eintrag' };
  const username = typeof e.username === 'string' ? e.username : '';
  const server = typeof e.server === 'string' ? e.server : '';
  if (!accounts.some((a) => a.username === username)) return { error: `Account "${username}" gibt es nicht` };
  const sv = getServer(server);
  if (!sv || sv.isDefault) return { error: `Server "${server}" gibt es nicht` };
  return {
    value: {
      username,
      server,
      everJoined: e.everJoined === true,
      preferredChatSource: e.preferredChatSource === true,
      autoChat: Array.isArray(e.autoChat) ? e.autoChat.map(cleanAutoChatEntry).filter((r) => r.value).map((r) => r.value) : [],
      notifyElsewhere: e.notifyElsewhere !== false,
      elsewhereNotice: e.elsewhereNotice && e.elsewhereNotice.channelId && e.elsewhereNotice.messageId
        ? { channelId: String(e.elsewhereNotice.channelId), messageId: String(e.elsewhereNotice.messageId) }
        : undefined,
    },
  };
}

function loadExtraConnections() {
  for (const file of [CONNECTIONS_FILE, CONNECTIONS_BACKUP_FILE]) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.connections)) continue;
      if (file === CONNECTIONS_BACKUP_FILE) console.warn('[Server] verbindungen.json nicht lesbar - Sicherung wird verwendet!');
      const list = [];
      invalidConnections = [];
      for (const entry of raw.connections) {
        const r = cleanConnEntry(entry);
        const dup = r.value && list.some((c) => c.username === r.value.username && c.server === r.value.server);
        if (r.error || dup) {
          console.warn(`[Server] Verbindung wird nicht benutzt (${r.error || 'doppelt'}): ${JSON.stringify(entry).slice(0, 200)}`);
          if (!dup) invalidConnections.push(entry);
          continue;
        }
        list.push(r.value);
      }
      return list;
    } catch (e) {
      console.error(`[Server] Fehler beim Laden von ${path.basename(file)}:`, e.message);
    }
  }
  return [];
}

function saveExtraConnections() {
  const data = JSON.stringify({ version: 1, connections: [...extraConnections, ...invalidConnections] }, null, 2);
  const tmp = CONNECTIONS_FILE + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, CONNECTIONS_FILE);
  try {
    fs.writeFileSync(CONNECTIONS_BACKUP_FILE, data);
  } catch (e) {
    console.error('[Server] Sicherung verbindungen.backup.json fehlgeschlagen (nicht kritisch):', e.message);
  }
}

// Anzeigename einer Verbindung fuer Meldungen: "alpha" bzw. "alpha (Lobby)"
function connLabel(key) {
  if (isDefaultConn(key)) return key;
  const sv = serverOf(key);
  return `${connUser(key)} (${sv ? sv.name : connServerId(key)})`;
}
// Warum kann diese Verbindung gerade nicht starten? (null = alles in Ordnung)
function connectionTargetProblem(key) {
  const target = serverOf(key);
  if (!target) return 'Server gibt es nicht mehr';
  if (!target.host) return 'Kein Server eingetragen (MC_SERVER_HOST in der .env)';
  const bedrock = isBedrockAccount(connUser(key));
  if (bedrock && !target.bedrockPort) return 'Server hat keinen Bedrock-Port';
  if (!bedrock && !target.javaPort) return 'Server hat keinen Java-Port';
  if (!target.isDefault && !bedrock && !MULTI_SERVER_JAVA) return 'Java auf weiteren Servern ist ausgeschaltet (MULTI_SERVER_JAVA in der .env)';
  if (!target.isDefault && bedrock && !MULTI_SERVER_BEDROCK) return 'Bedrock auf weiteren Servern ist ausgeschaltet (MULTI_SERVER_BEDROCK in der .env)';
  if (!target.isDefault && bedrock) {
    // Obergrenze (falls sie nachtraeglich gesenkt wurde): die obersten in der Liste duerfen
    const extraBedrock = allConnKeys().filter((k) => !isDefaultConn(k) && isBedrockAccount(connUser(k)));
    if (extraBedrock.indexOf(key) >= MULTI_SERVER_BEDROCK_MAX) return `Über der Obergrenze für Bedrock auf weiteren Servern (MULTI_SERVER_BEDROCK_MAX=${MULTI_SERVER_BEDROCK_MAX})`;
  }
  return null;
}

// Auto-Chat-Vorlage eines Servers als Startwert fuer eine neue Verbindung (Kopie)
function templateFor(serverId) {
  const sv = getServer(serverId);
  return sv && Array.isArray(sv.autoChatTemplate) ? sv.autoChatTemplate.map((e) => ({ ...e })) : [];
}

// Alle Verbindungen eines Accounts, Standardserver zuerst
function connKeysOfAccount(username) {
  return [username, ...extraConnections.filter((c) => c.username === username).map((c) => connKey(username, c.server))];
}
// Ist irgendeine Verbindung dieses Accounts gerade verbunden (oder mitten im Verbinden)?
function accountConnected(username) {
  return connKeysOfAccount(username).some((k) => bots[k] && (bots[k].bot || bots[k].pendingStart));
}

// Alle Verbindungen in der Reihenfolge der Account-Liste (oben nach unten)
function allConnKeys() {
  return accounts.flatMap((a) => connKeysOfAccount(a.username));
}

const bots = {}; // Verbindung -> { bot, status, hideTimer, manualStop }
const reconnectTimers = {}; // Verbindung -> Timeout (Verzoegerung vor einem Reconnect-Versuch)
const reconnectFailCount = {}; // Verbindung -> Anzahl aufeinanderfolgender Fehlschlaege

// Bedrock-Schutz gegen Dauer-Neuverbindungen (Erklaerung bei bedrockRetryAfterFailure / im close-Handler)
const BEDROCK_PAUSE_AFTER_FAILS = Math.max(2, parseInt(process.env.MC_BEDROCK_PAUSE_AFTER_FAILS || '5', 10) || 5);
const BEDROCK_PAUSE_MS = Math.max(1, parseInt(process.env.MC_BEDROCK_PAUSE_MIN || '15', 10) || 15) * 60 * 1000;
// Pro Server: ein Server, der gerade keine Bedrock-Verbindungen annimmt, pausiert nur SEINE
// Bedrock-Accounts. fails = Fehlschlaege vor dem Spawn seit dem letzten Spawn auf diesem Server.
const bedrockPauses = {}; // serverId -> { until, timer, waiting: Set, probe, fails, unreachableNoticeAt }
function bpOf(serverId) {
  const sid = serverId || DEFAULT_SERVER_ID;
  return bedrockPauses[sid] || (bedrockPauses[sid] = { until: 0, timer: null, waiting: new Set(), probe: null, fails: 0, unreachableNoticeAt: 0 });
}
// Pause-Zustand der Verbindung (ueber ihren Server)
function bpFor(key) {
  return bpOf(connServerId(key));
}
// Verbindungen, die kurz nach dem Spawn wieder abbrechen: ab 3 in Folge laengere Pause
const SHORT_SESSION_MS = 5 * 60 * 1000;
const shortSessionCount = {}; // username -> Anzahl Verbindungen hintereinander, die kuerzer als 5 min hielten

// Berechnet Wartezeit mit exponentiellem Backoff:
// 1. Fehlschlag: 10s, 2.: 30s, 3.: 60s, 4.: 2min, 5.+: 5min (Maximum)
function getBackoffDelay(username) {
  const fails = reconnectFailCount[username] || 0;
  const delays = [10, 30, 60, 120, 300]; // Sekunden
  return (delays[Math.min(fails, delays.length - 1)] || 300) * 1000;
}
const RECONNECT_DELAY_MS = 10 * 1000; // 10 Sekunden

// ---------- Sequentieller Start/Reconnect ----------
// Egal ob "Alle starten", Autostart nach einem Neustart, oder alle Accounts wurden
// gleichzeitig vom Server gekickt: es wird IMMER strikt einer nach dem anderen abgearbeitet,
// in der Reihenfolge der Account-Liste (oben nach unten):
//   1. Account 1 versucht sich zu verbinden.
//      - Klappt es nicht -> nach 10s wird GENAU DERSELBE Account nochmal versucht (nicht der naechste).
//      - Klappt es -> nach 10s ist der naechste Account in der Liste dran.
// Es ist also nie mehr als EIN Account gleichzeitig "am Verbinden", was die 429-Fehler
// durch gleichzeitige Microsoft/Xbox-Logins verhindert.
//
// Wichtig: Wer "als naechstes dran ist" wird IMMER frisch aus der echten Account-Liste (oben
// nach unten) ermittelt, NICHT danach, in welcher Reihenfolge Accounts zufaellig (je nach
// Netzwerk-Timing der Kick-Events) eingereiht wurden. Ein Set speichert nur WER wartet, die
// tatsaechliche Reihenfolge kommt immer aus accounts.find(...).
let pendingReconnectSet = new Set(); // Usernamen, die auf ihren naechsten Verbindungsversuch warten
let currentlyProcessing = null; // Username, der gerade versucht sich zu verbinden (oder null)
let sequentialWatchdogTimer = null;
const SEQUENTIAL_STEP_DELAY_MS = 10 * 1000; // Pause nach einem ERFOLGREICHEN Login, bevor der naechste startet
const SEQUENTIAL_RETRY_DELAY_MS = 60 * 1000; // Pause nach einem FEHLGESCHLAGENEN Versuch, bevor derselbe Account nochmal versucht wird
const SEQUENTIAL_WATCHDOG_MS = 45 * 1000; // Sicherheitsnetz, falls mal weder login noch end kommt (haengender Login-Versuch)
// Microsoft-Login-Codes: Ein Code gilt so lange, wie Microsoft es vorgibt (meist 15 Minuten).
// Laeuft er ab, fordert die Login-Bibliothek selbst einen neuen an. Bleiben MSA_MAX_CODES Codes
// hintereinander unbenutzt, wird der Login fuer diesen Account pausiert (bis jemand auf Start
// drueckt), statt endlos weiter neue Codes zu schicken.
const MSA_MAX_CODES = 4;
const MSA_CODE_GRACE_MS = parseInt(process.env.MSA_CODE_GRACE_MS || '30000', 10); // Puffer nach Ablauf eines Codes
// Der Microsoft-Login gehoert dem ACCOUNT (alle seine Verbindungen teilen sich den Login-Cache):
// Zaehler und Pause gelten deshalb pro Account, die Discord-Nachricht pro Verbindung.
// Waehrend eine Verbindung auf die Code-Eingabe wartet, warten die anderen Verbindungen
// desselben Accounts in der Warteschlange - nie zwei Logins fuer denselben Cache gleichzeitig.
const msaCodeCount = {};      // Account -> Anzahl gezeigter Codes seit dem letzten Login/Start
const msaPaused = new Set();  // Accounts, deren Login wegen unbenutzter Codes pausiert ist
const msaCodeMessages = {};   // Verbindung -> { msg, label }: Discord-Nachricht mit dem aktuellen Code

// Wartet gerade eine ANDERE Verbindung desselben Accounts auf die Code-Eingabe?
function loginBusySibling(key) {
  for (const k of connKeysOfAccount(connUser(key))) {
    if (k === key) continue;
    const st = bots[k];
    if (st && st.bot && st.msaTimer) return k;
  }
  return null;
}
// Andere Verbindungen desselben Accounts, die in der Warteschlange warten, wieder anstossen
function wakeLoginSiblings(key) {
  const waiting = connKeysOfAccount(connUser(key)).some((k) => k !== key && pendingReconnectSet.has(k));
  if (waiting) setTimeout(() => advanceSequentialQueue(), SEQUENTIAL_STEP_DELAY_MS);
}

// opts.manual: jemand hat auf Start gedrueckt (Webseite, Discord) - auch waehrend einer Bedrock-Pause
// opts.probe:  der eine Probe-Versuch am Ende einer Bedrock-Pause
function requestBotStart(username, opts = {}) {
  // Wer einen pausierten Login (zu viele unbenutzte Codes) wieder startet, faengt neu an zu zaehlen.
  // Automatische Starts (z.B. einer anderen Verbindung desselben Accounts) heben die Pause nicht auf.
  const msaAccount = connUser(username);
  if (msaPaused.has(msaAccount)) {
    if (opts.manual || isDefaultConn(username) && connKeysOfAccount(msaAccount).length === 1) {
      msaPaused.delete(msaAccount);
      msaCodeCount[msaAccount] = 0;
    } else {
      if (bots[username] && !bots[username].bot) {
        bots[username].status = 'Login nötig – Start drücken';
        bots[username].msaSkipped = true;
        broadcastAccountList();
      }
      return;
    }
  }
  if (bots[username]) bots[username].msaSkipped = false;
  if (bots[username] && bots[username].bot) return; // laeuft schon
  if (bots[username] && bots[username].pendingStart) return; // Bedrock: wartet gerade auf die Transport-Wahl
  if (currentlyProcessing === username) return; // wird gerade schon versucht
  const targetProblem = connectionTargetProblem(username);
  if (targetProblem) {
    console.warn(`[Server] ${username} startet nicht: ${targetProblem}`);
    if (bots[username] && !bots[username].bot) {
      bots[username].status = targetProblem;
      broadcastAccountList();
    }
    return;
  }
  // Wer/was startet? Steht spaeter in der aktualisierten "anderswo eingeloggt"-Meldung
  if (opts.source) startSources[username] = opts.source;
  else delete startSources[username];
  if (isBedrockAccount(username)) {
    if (opts.manual) {
      bpFor(username).waiting.delete(username);
      if (reconnectTimers[username]) { clearTimeout(reconnectTimers[username]); delete reconnectTimers[username]; }
      if (shortSessionCount[username]) shortSessionCount[username] = 0; // Start-Klick hebt die Kurzverbindungs-Pause auf
    } else if (!opts.probe && bedrockPauseActive(connServerId(username))) {
      parkBedrockAccount(username); // waehrend der Bedrock-Pause nicht anklopfen
      return;
    }
  }
  pendingReconnectSet.add(username);
  // Status sofort auf "Warteschlange" setzen damit es auf der Webseite sichtbar ist
  if (bots[username] && bots[username].status !== 'online') {
    bots[username].status = 'Warteschlange...';
    broadcastAccountList();
  }
  advanceSequentialQueue();
}

// Ein gemeinsamer Timer fuer ALLE Accounts, die (fast) gleichzeitig rausgeflogen sind.
// Dadurch werden bei einem Server-Neustart erst alle Kicks gesammelt und danach strikt in
// Listenreihenfolge (oben nach unten) abgearbeitet - statt dass der Account zuerst startet,
// dessen individueller Timer zufaellig als Erster ablief.
let groupedReconnectTimer = null;

function scheduleGroupedReconnect(username) {
  if (bots[username] && bots[username].bot) return; // laeuft schon wieder
  if (currentlyProcessing === username) return;
  pendingReconnectSet.add(username);
  // Status auf "Warteschlange" setzen damit es auf der Webseite sichtbar ist
  if (bots[username]) {
    bots[username].status = 'Warteschlange...';
    broadcastAccountList();
  }

  if (groupedReconnectTimer) return; // Timer laeuft schon - dieser Account faehrt einfach mit
  groupedReconnectTimer = setTimeout(() => {
    groupedReconnectTimer = null;
    advanceSequentialQueue();
  }, RECONNECT_DELAY_MS);
}

function advanceSequentialQueue() {
  if (currentlyProcessing) return; // es ist schon jemand dran
  if (pendingReconnectSet.size === 0) return;

  // IMMER von oben nach unten durch die echte Account-Liste gehen und den ersten warteneden
  // Account nehmen - so ist die Reihenfolge garantiert, egal wann wer eingereiht wurde.
  const keys = allConnKeys();
  for (const k of pendingReconnectSet) {
    if (!keys.includes(k)) pendingReconnectSet.delete(k); // Karteileichen (z.B. geloeschte Accounts)
  }
  let nextKey = null;
  for (const k of keys) {
    if (!pendingReconnectSet.has(k)) continue;
    if (msaPaused.has(connUser(k))) {
      // Login dieses Accounts ist pausiert (zu viele unbenutzte Codes) -> nicht anklopfen
      pendingReconnectSet.delete(k);
      if (bots[k] && !bots[k].bot) {
        bots[k].status = 'Login nötig – Start drücken';
        bots[k].msaSkipped = true;
        broadcastAccountList();
      }
      continue;
    }
    const busy = loginBusySibling(k);
    if (busy) {
      if (bots[k] && !bots[k].bot && !/^Wartet auf den Microsoft-Login/.test(bots[k].status)) {
        bots[k].status = `Wartet auf den Microsoft-Login (${connLabel(busy)})`;
        broadcastAccountList();
      }
      continue;
    }
    nextKey = k;
    break;
  }
  if (!nextKey) return;

  const username = nextKey;
  pendingReconnectSet.delete(username);
  if (bots[username] && bots[username].bot) {
    advanceSequentialQueue();
    return;
  }

  attemptSequentialStart(username);
}

function forceKillBot(username) {
  const state = bots[username];
  if (state) state.pendingStart = null; // ein Bedrock-Start, der noch auf die Transport-Wahl wartet, entfaellt
  if (state && state.msaTimer) {
    clearTimeout(state.msaTimer);
    state.msaTimer = null;
  }
  if (state && state.bot) {
    const oldBot = state.bot;
    try {
      if (typeof oldBot.quit === 'function') oldBot.quit('Erzwungener Abbruch');
      else if (typeof oldBot.close === 'function') oldBot.close(); // Bedrock-Client
      else if (typeof oldBot.end === 'function') oldBot.end();
      else if (oldBot._client && typeof oldBot._client.end === 'function') oldBot._client.end();
    } catch (e) {
      console.error(`Fehler beim erzwungenen Abbruch von ${username}:`, e.message);
    }
    neutralizeLoginAttempt(username, oldBot);
    state.bot = null;
  }
}

// Sorgt dafuer, dass ein abgebrochener Verbindungsversuch wirklich tot ist. Die Microsoft-
// Anmeldung laeuft in den Bibliotheken unabhaengig vom Bot weiter. Ohne das hier hat ein
// abgebrochener Versuch noch bis zu einer Stunde lang neue Login-Codes angefordert (die in
// Discord landeten, auch wenn der Account laengst eingeloggt war) und sich nach einer spaeten
// Code-Eingabe sogar unsichtbar mit dem Server verbunden.
function neutralizeLoginAttempt(username, botObj) {
  if (!botObj) return;
  try {
    if (isBedrockAccount(username)) {
      // bedrock-protocol verbindet erst nach 'connect_allowed' bzw. nach der Anmeldung ('session')
      if (typeof botObj.removeAllListeners === 'function') {
        botObj.removeAllListeners('connect_allowed');
        botObj.removeAllListeners('session');
      }
      return;
    }
    const client = botObj._client;
    if (!client) return;
    const msa = client.authflow && client.authflow.msa;
    if (msa) {
      msa.polling = false; // laufendes Warten auf die Code-Eingabe beenden
      msa.authDeviceCode = async () => { throw new Error('Login-Versuch wurde abgebrochen'); };
    }
    // Falls die Anmeldung trotzdem noch durchgeht: keine Verbindung mehr aufbauen
    client.setSocket = (socket) => {
      try { socket.destroy(); } catch (_) { /* egal */ }
    };
  } catch (e) {
    console.error(`Fehler beim Abklemmen eines alten Login-Versuchs von ${username}:`, e.message);
  }
}

// ---------- Microsoft-Login-Codes ----------
// Wird von der Login-Bibliothek aufgerufen, wenn fuer einen Account ein Code eingegeben werden
// muss. "attempt" gehoert zu genau EINEM Verbindungsversuch (attempt.ref = Bot/Client-Objekt).
function handleMsaCode(username, attempt, data, label) {
  const state = bots[username];
  // Codes aus einem bereits abgebrochenen Versuch oder fuer einen inzwischen eingeloggten
  // Account werden verworfen.
  if (!state || (attempt.ref && state.bot !== attempt.ref) || state.status === 'online') {
    console.log(`[${username}] Microsoft-Code ${data.user_code} aus einem alten Login-Versuch verworfen`);
    return;
  }
  const msaAccount = connUser(username);
  msaCodeCount[msaAccount] = (msaCodeCount[msaAccount] || 0) + 1;
  const lifetimeSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : 900;
  const expiresAt = Date.now() + lifetimeSec * 1000;
  console.log(`[${username}] Microsoft-Login noetig: ${data.user_code} auf ${msaDirectLink(data)} (Code ${msaCodeCount[msaAccount]}/${MSA_MAX_CODES}, gueltig ${Math.round(lifetimeSec / 60)} Min.)`);

  state.status = 'Login nötig (Code eingeben)';
  broadcastAccountList();
  io.emit('msa-code', {
    username,
    label: connLabel(username),
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    directUri: msaDirectLink(data),
    message: data.message,
  });
  queueMsaDiscord(username, () => announceMsaCode(username, label, data, expiresAt));

  // Das Warten auf die Code-Eingabe blockiert die Warteschlange nicht mehr: die anderen
  // Accounts verbinden sich in der Zwischenzeit ganz normal.
  if (currentlyProcessing === username) {
    if (sequentialWatchdogTimer) {
      clearTimeout(sequentialWatchdogTimer);
      sequentialWatchdogTimer = null;
    }
    currentlyProcessing = null;
    setTimeout(() => advanceSequentialQueue(), SEQUENTIAL_STEP_DELAY_MS);
  }

  // Eigene Frist fuer GENAU diesen Code: so lange, wie Microsoft ihn gelten laesst (+ Puffer).
  // Vorher wurde der Versuch schon nach 10 Minuten abgebrochen, obwohl der Code noch 5 Minuten
  // gueltig war - wer ihn dann noch eingab, bekam trotzdem einen neuen.
  if (state.msaTimer) clearTimeout(state.msaTimer);
  const ref = attempt.ref;
  state.msaTimer = setTimeout(() => msaCodeExpired(username, ref), lifetimeSec * 1000 + MSA_CODE_GRACE_MS);
}

function msaCodeExpired(username, ref) {
  const state = bots[username];
  if (!state || state.bot !== ref || state.status === 'online') return;
  state.msaTimer = null;
  io.emit('msa-code-clear', { username });
  forceKillBot(username);
  if ((msaCodeCount[connUser(username)] || 0) >= MSA_MAX_CODES) {
    msaPaused.add(connUser(username));
    state.status = 'Login nötig – Start drücken';
    state.msaSkipped = true;
    broadcastAccountList();
    wakeLoginSiblings(username); // wartende Verbindungen desselben Accounts sehen jetzt die Pause
    logChat(username, `--- ${MSA_MAX_CODES} Login-Codes nicht eingegeben, Login pausiert (zum Fortsetzen auf Start druecken) ---`);
    updateMsaCodeMessage(username, 'paused');
    return;
  }
  updateMsaCodeMessage(username, 'expired');
  logChat(username, '--- Login-Code abgelaufen, neuer Versuch ---');
  requestBotStart(username);
}

function msaLoginSucceeded(username) {
  const state = bots[username];
  if (state && state.msaTimer) {
    clearTimeout(state.msaTimer);
    state.msaTimer = null;
  }
  const msaAccount = connUser(username);
  if (msaCodeMessages[username]) updateMsaCodeMessage(username, 'ok');
  msaCodeCount[msaAccount] = 0;
  msaPaused.delete(msaAccount);
  // Andere Verbindungen desselben Accounts, die wegen des Logins warten mussten, duerfen jetzt
  for (const k of connKeysOfAccount(msaAccount)) {
    if (k !== username && bots[k] && bots[k].msaSkipped && !bots[k].manualStop) requestBotStart(k);
  }
  wakeLoginSiblings(username);
}

// Discord-Nachrichten zu Login-Codes pro Account strikt nacheinander abarbeiten - sonst kann
// z.B. "angemeldet" ankommen, bevor die Code-Nachricht selbst verschickt ist.
const msaDiscordQueue = {};
function queueMsaDiscord(username, fn) {
  const next = (msaDiscordQueue[username] || Promise.resolve())
    .then(fn)
    .catch((e) => console.error(`Discord: Login-Code-Nachricht fuer ${username} fehlgeschlagen:`, e.message));
  msaDiscordQueue[username] = next;
  return next;
}

function updateMsaCodeMessage(username, how) {
  return queueMsaDiscord(username, () => updateMsaCodeMessageNow(username, how));
}

// Microsoft-Link, in dem der Code schon steckt (".../link?otc=CODE") - ein Klick genuegt.
// So baut ihn auch die verbreitete Bibliothek MinecraftAuth. Unterstuetzt eine Seite das
// nicht, fragt sie einfach wie gewohnt nach dem Code.
function msaDirectLink(data) {
  if (data && data.verification_uri_complete) return String(data.verification_uri_complete);
  const base = String((data && data.verification_uri) || 'https://www.microsoft.com/link');
  if (!data || !data.user_code || /[?&]otc=/.test(base)) return base;
  return `${base}${base.includes('?') ? '&' : '?'}otc=${encodeURIComponent(data.user_code)}`;
}

function msaLoginButtonRow(link) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link).setLabel('🔑 Jetzt anmelden (Code ist schon drin)')
  );
}

async function announceMsaCode(username, label, data, expiresAt) {
  await updateMsaCodeMessageNow(username, 'replaced');
  const unix = Math.floor(expiresAt / 1000);
  const n = msaCodeCount[connUser(username)] || 1;
  const link = msaDirectLink(data);
  const msg = await discordSend('notify', {
    embeds: [{
      title: `🔑 Login nötig für ${label}`,
      description:
        `**[👉 Hier klicken und anmelden](${link})** – der Code ist im Link schon eingetragen.\n` +
        `Falls doch nach einem Code gefragt wird: \`${data.user_code}\` (auf ${data.verification_uri})\n` +
        `Gültig bis <t:${unix}:t> (<t:${unix}:R>). Ältere Codes für diesen Account gelten nicht mehr.` +
        (n > 1 ? `\nCode ${n} von ${MSA_MAX_CODES} – danach wird der Login pausiert.` : ''),
      color: DISCORD_COLOR_INFO,
      timestamp: new Date().toISOString(),
    }],
    components: [msaLoginButtonRow(link)],
  });
  if (msg) msaCodeMessages[username] = { msg, label };
}

// Aktualisiert die Discord-Nachricht mit dem letzten Code, statt neue Nachrichten zu stapeln.
async function updateMsaCodeMessageNow(username, how) {
  const entry = msaCodeMessages[username];
  const label = entry ? entry.label : username;
  const texts = {
    ok: { title: `✅ ${label} ist angemeldet`, description: 'Der Login hat geklappt, der Code wird nicht mehr gebraucht.', color: DISCORD_COLOR_OK },
    replaced: { title: `⌛ Code für ${label} abgelaufen`, description: 'Es gibt einen neuen Code (nächste Nachricht).', color: DISCORD_COLOR_WARN },
    expired: { title: `⌛ Code für ${label} abgelaufen`, description: 'Gleich kommt ein neuer Code.', color: DISCORD_COLOR_WARN },
    stopped: { title: `⏹️ Login für ${label} abgebrochen`, description: 'Der Account wurde gestoppt, der Code wird nicht mehr gebraucht.', color: DISCORD_COLOR_WARN },
    paused: { title: `⏸️ Login für ${label} pausiert`, description: `${MSA_MAX_CODES} Codes hintereinander wurden nicht eingegeben. Klick auf Start, wenn du dich anmelden willst.`, color: DISCORD_COLOR_WARN },
  };
  const t = texts[how];
  if (!t) return;
  if (!entry) {
    // Keine Code-Nachricht zum Aendern (z.B. per Webhook gesendet) - nur die Pause ist wichtig genug
    if (how === 'paused') {
      await notifyDiscordChannelWithStartButton(username, `⏸️ **Login für ${label} pausiert:** ${MSA_MAX_CODES} Codes hintereinander wurden nicht eingegeben. Klick unten, wenn du dich anmelden willst:`);
    }
    return;
  }
  delete msaCodeMessages[username];
  const payload = { embeds: [{ ...t, timestamp: new Date().toISOString() }], components: [] };
  if (how === 'paused') payload.components = [startButtonRow(username)];
  try {
    await entry.msg.edit(payload);
  } catch (e) {
    console.error(`Discord: Code-Nachricht fuer ${username} konnte nicht aktualisiert werden:`, e.message);
    if (how === 'paused') await notifyDiscordChannelWithStartButton(username, `⏸️ **Login für ${label} pausiert.** Klick unten, wenn du dich anmelden willst:`);
  }
}

function scheduleSequentialRetry(username) {
  if (bots[username]) {
    bots[username].status = `Erneuter Versuch in ${SEQUENTIAL_RETRY_DELAY_MS / 1000}s...`;
    broadcastAccountList();
  }
  reconnectTimers[username] = setTimeout(() => {
    delete reconnectTimers[username];
    attemptSequentialStart(username);
  }, SEQUENTIAL_RETRY_DELAY_MS);
}

function attemptSequentialStart(username) {
  currentlyProcessing = username;
  if (bots[username]) {
    bots[username].status = 'verbinde...';
    broadcastAccountList();
  }
  startBot(username);

  if (sequentialWatchdogTimer) clearTimeout(sequentialWatchdogTimer);
  sequentialWatchdogTimer = setTimeout(() => {
    if (currentlyProcessing === username) {
      console.log(`Sequenz-Sicherheitsnetz ausgeloest fuer ${username} (kein login/end-Event erhalten)`);
      if (isBedrockAccount(username)) {
        // Bedrock: Client erst abhaengen, dann schliessen (sonst behandelt der close-Handler den
        // Abbruch ein zweites Mal) - und die Warteschlange nicht blockieren
        const s = bots[username];
        const client = s && s.bot;
        if (s) { s.bot = null; s.pendingStart = null; }
        if (client) {
          try { client.close(); } catch (_) { /* egal */ }
          neutralizeLoginAttempt(username, client);
        }
        markOffline(username);
        const step = s && s.nnStep ? `, zuletzt: ${s.nnStep}` : '';
        bedrockRetryAfterFailure(username, `keine Antwort nach ${SEQUENTIAL_WATCHDOG_MS / 1000}s${step}`, s && s.transport);
        return;
      }
      forceKillBot(username);
      currentlyProcessing = null;
      scheduleSequentialRetry(username);
    }
  }, SEQUENTIAL_WATCHDOG_MS);
}
let chatHistory = []; // [{ username, text, ts }] - nur vom primaeren Account

// ---------- Uptime-Tracking (wie lange ein Account heute schon online war) ----------
const accountStats = {}; // username -> { totalMs, sessionStart, day }

function getTodayStr(date) {
  // Bewusst LOKALE Zeit statt toISOString() (=UTC): sonst wird der Tageszaehler mitten in
  // der Nacht um 02:00 lokaler Zeit zurueckgesetzt (Sommerzeit = UTC+2).
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureStats(username) {
  if (!accountStats[username]) {
    accountStats[username] = { totalMs: 0, sessionStart: null, day: getTodayStr() };
  }
  return accountStats[username];
}

// Setzt alle Tageszaehler auf 0 zurueck (laufende Sitzungen bleiben aktiv).
// Wird explizit um Mitternacht aufgerufen, NACHDEM die Zusammenfassung gesendet wurde.
function resetDailyStats() {
  const today = getTodayStr();
  for (const username of Object.keys(accountStats)) {
    const s = accountStats[username];
    s.totalMs = 0;
    s.day = today;
    if (s.sessionStart) s.sessionStart = Date.now();
  }
}

function markOnline(username) {
  const s = ensureStats(username);
  if (!s.sessionStart) s.sessionStart = Date.now();
}

function markOffline(username) {
  const s = ensureStats(username);
  if (s.sessionStart) {
    s.totalMs += Date.now() - s.sessionStart;
    s.sessionStart = null;
  }
}

function getUptimeMs(username) {
  const s = ensureStats(username);
  let total = s.totalMs;
  if (s.sessionStart) total += Date.now() - s.sessionStart;
  return total;
}

function formatDurationServer(ms) {
  const totalMin = Math.floor((ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m === 0) return `${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Discord: Benachrichtigungen per Webhook ----------
const DISCORD_COLOR_INFO = 0x4f8cff;
const DISCORD_COLOR_OK = 0x52e08a;
const DISCORD_COLOR_WARN = 0xf6b94f;
const DISCORD_COLOR_DANGER = 0xef5b5b;

async function postToDiscordWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Discord-Webhook Fehler:', e.message);
  }
}

// ---------- Discord: alle Meldungen laufen ueber den Bot ----------
// Ist ein Discord-Bot eingerichtet, schickt ER alle Meldungen (Login-Codes, Kicks, Online/
// Offline, Start, Tageszusammenfassung, Chat-Spiegel) - und zwar in dieselben Kanaele, in die
// bisher die Webhooks geschrieben haben (die Kanal-ID wird aus der Webhook-Adresse ermittelt).
// Die Webhooks dienen nur noch als Rueckfall: wenn kein Bot eingerichtet ist, er (noch) nicht
// verbunden ist oder im Kanal nicht schreiben darf.
// Optional in der .env, um die Kanaele fest vorzugeben:
//   DISCORD_NOTIFY_CHANNEL_ID  Kanal fuer alle Meldungen
//   DISCORD_CHAT_CHANNEL_ID    Kanal fuer den Chat-Spiegel
const DISCORD_NOTIFY_CHANNEL_ID = process.env.DISCORD_NOTIFY_CHANNEL_ID || '';
const DISCORD_CHAT_CHANNEL_ID = process.env.DISCORD_CHAT_CHANNEL_ID || '';
const DISCORD_READY_WAIT_MS = 45 * 1000;        // so lange werden Meldungen beim Start aufgehoben
const DISCORD_BOT_RETRY_MS = 10 * 60 * 1000;    // nach einem Sendefehler so lange per Webhook
let discordClient = null;                       // wird gesetzt, wenn der Bot eingerichtet ist
let discordReady = false;
let discordStartedAt = 0;
const discordTargets = { notify: null, chat: null };
const discordBotBrokenSince = { notify: 0, chat: 0 };
const discordPending = [];

async function webhookChannelId(url) {
  if (!url) return null;
  try {
    const res = await fetch(url.split('?')[0], { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const info = await res.json();
    return info.channel_id || null;
  } catch (e) {
    return null;
  }
}

async function resolveDiscordTargets() {
  discordTargets.notify = DISCORD_NOTIFY_CHANNEL_ID || (await webhookChannelId(DISCORD_WEBHOOK_URL)) || DISCORD_CHANNEL_ID || null;
  discordTargets.chat = DISCORD_CHAT_CHANNEL_ID || (await webhookChannelId(DISCORD_CHAT_WEBHOOK_URL)) || null;
  console.log(`Discord: Meldungen kommen vom Bot in Kanal ${discordTargets.notify || '-'}, Chat-Spiegel in Kanal ${discordTargets.chat || '- (aus)'}`);
}

// Rueckgabe: gesendete Bot-Nachricht, null (nichts zu senden) oder undefined (Bot nicht nutzbar)
async function sendViaBot(kind, payload) {
  if (!discordClient || !discordReady) return undefined;
  const channelId = discordTargets[kind];
  if (!channelId) return undefined;
  if (Date.now() - discordBotBrokenSince[kind] < DISCORD_BOT_RETRY_MS) return undefined;
  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function') throw new Error('Kanal nicht gefunden');
    return await channel.send({ allowedMentions: { parse: [] }, ...payload });
  } catch (e) {
    discordBotBrokenSince[kind] = Date.now();
    console.error(`Discord: Bot kann nicht in Kanal ${channelId} schreiben (${e.message}) - nutze 10 Minuten lang den Webhook. Hat der Bot dort die Rechte "Kanal ansehen", "Nachrichten senden" und "Links einbetten"?`);
    return undefined;
  }
}

async function sendViaWebhook(kind, payload) {
  const url = kind === 'chat' ? DISCORD_CHAT_WEBHOOK_URL : DISCORD_WEBHOOK_URL;
  if (!url) return;
  const body = { allowed_mentions: { parse: [] } };
  if (payload.content) body.content = payload.content;
  if (payload.embeds) body.embeds = payload.embeds;
  const hasActionButtons = (payload.components || []).some((row) => {
    const r = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
    return ((r && r.components) || []).some((c) => c.style !== ButtonStyle.Link);
  });
  if (hasActionButtons) {
    // Webhooks koennen keine Knoepfe
    body.content = `${body.content || ''}\n_(Ohne Discord-Bot gibt es hier keinen Start-Knopf: bitte im Dashboard auf Start drücken.)_`.trim();
  }
  await postToDiscordWebhook(url, body);
}

// kind: 'notify' (Meldungen) oder 'chat' (Chat-Spiegel)
async function discordSend(kind, payload) {
  if (instanceIdle) return null; // doppelt gestartete Instanz: nichts nach Discord schicken
  if (discordClient && !discordReady && Date.now() - discordStartedAt < DISCORD_READY_WAIT_MS) {
    // Bot verbindet sich gerade (z.B. direkt nach dem Programmstart) -> kurz aufheben
    return new Promise((resolve) => discordPending.push({ kind, payload, resolve }));
  }
  const sent = await sendViaBot(kind, payload);
  if (sent !== undefined) return sent;
  await sendViaWebhook(kind, payload);
  return null;
}

async function flushDiscordPending() {
  const items = discordPending.splice(0);
  for (const item of items) {
    const sent = await sendViaBot(item.kind, item.payload);
    if (sent === undefined) await sendViaWebhook(item.kind, item.payload);
    item.resolve(sent === undefined ? null : sent);
  }
}

function sendDiscordEmbed(embed) {
  return discordSend('notify', { embeds: [{ ...embed, timestamp: new Date().toISOString() }] });
}

function startButtonRow(username) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`start_${username}`)
      .setLabel(`▶️ ${connLabel(username)} starten`.slice(0, 80))
      .setStyle(ButtonStyle.Primary)
  );
}

// Manche Server (z.B. bei "Server startet neu") schicken den Kick-Grund als tief
// verschachteltes Chat-Komponenten-Objekt statt als einfachen Text - und das sogar in
// unterschiedlichen Formaten je nach Situation. Das hier zieht per rekursivem Durchlauf
// nur den eigentlich lesbaren Text raus, egal wie die Struktur im Detail aussieht.
const CHAT_META_KEYS = new Set([
  'color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated',
  'clickEvent', 'hoverEvent', 'insertion', 'font',
]);

function extractChatText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(extractChatText).join('');
  if (typeof node !== 'object') return '';

  // Sonderfall eines aelteren Formats: {"type":"string","value":"..."} -> value ist der Text
  if (node.type === 'string' && typeof node.value === 'string') {
    return node.value;
  }

  let result = '';
  for (const key of Object.keys(node)) {
    if (key === 'type' || CHAT_META_KEYS.has(key)) continue;
    result += extractChatText(node[key]);
  }
  return result;
}

function extractReadableKickReason(raw) {
  try {
    const parsed = JSON.parse(raw);
    const text = extractChatText(parsed).replace(/\n{2,}/g, '\n').trim();
    return text || raw;
  } catch (e) {
    return raw;
  }
}

// ---------- Discord: Kick-Benachrichtigungen sammeln ----------
// Wenn z.B. der Server neu startet oder das Internet kurz weg ist, werden oft ALLE
// Accounts gleichzeitig gekickt. Statt dafuer eine einzelne Nachricht pro Account zu
// schicken, werden Kicks kurz gesammelt: kommen mehrere im selben Zeitfenster,
// gibt's nur EINE gemeinsame Nachricht.
// Pro Server gesammelt: ein Neustart von Server A soll nicht mit Kicks auf Server B vermischt werden
const kickBatches = {}; // serverId -> { list: [{ username, readableReason }], timer }
const KICK_BATCH_WINDOW_MS = 6000; // etwas grosszuegiger, falls Kicks leicht gestaffelt reinkommen
const lastMassKickAt = {}; // serverId -> Zeitpunkt; damit "Alle offline" nicht doppelt kommt

// Verhindert Dauerspam, wenn EIN Account (z.B. der vorderste in der Warteschlange bei
// einer laengeren Wartung) alle 60s erneut versucht und dabei immer wieder gekickt wird.
const kickNotifyThrottle = {}; // username -> Zeitpunkt der letzten Einzelmeldung
const KICK_NOTIFY_THROTTLE_MS = 5 * 60 * 1000; // 5 Minuten

function queueKickNotification(username, readableReason) {
  const sid = connServerId(username);
  lastMassKickAt[sid] = Date.now();
  const b = kickBatches[sid] || (kickBatches[sid] = { list: [], timer: null });
  b.list.push({ username, readableReason });
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => flushKickBatch(sid), KICK_BATCH_WINDOW_MS);
}

function flushKickBatch(sid) {
  const b = kickBatches[sid];
  if (!b) return;
  b.timer = null;
  const batch = b.list;
  b.list = [];
  if (batch.length === 0) return;
  const sv = getServer(sid);
  const where = sid === DEFAULT_SERVER_ID || !sv ? '' : ` (${sv.name})`;

  if (batch.length > 1) {
    // Mehrere gleichzeitig -> eine gemeinsame Nachricht statt Einzelspam
    const reason = batch[0].readableReason;
    const usernames = batch.map((x) => connUser(x.username)).join(', ');
    sendDiscordEmbed({
      title: `⚠️ ${batch.length} Accounts wurden gekickt${where}`,
      description: `${reason.length > 300 ? reason.slice(0, 300) + '...' : reason}\n\nBetroffen: ${usernames}`,
      color: DISCORD_COLOR_DANGER,
    });
    batch.forEach((x) => (kickNotifyThrottle[x.username] = Date.now()));
    markNotableOutage(sid);
  } else {
    const { username, readableReason } = batch[0];
    const now = Date.now();
    if (kickNotifyThrottle[username] && now - kickNotifyThrottle[username] < KICK_NOTIFY_THROTTLE_MS) {
      // Derselbe Account wurde erst vor Kurzem schon gemeldet (z.B. wiederholte
      // Reconnect-Versuche waehrend einer laengeren Wartung) - nicht nochmal spammen
      return;
    }
    kickNotifyThrottle[username] = now;
    sendDiscordEmbed({
      title: `⚠️ ${connLabel(username)} wurde gekickt`,
      description: readableReason.length > 300 ? readableReason.slice(0, 300) + '...' : readableReason,
      color: DISCORD_COLOR_DANGER,
    });
  }
}

// Meldung mit Start-Knopf (ueber den Bot; ohne Bot per Webhook, dann ohne Knopf)
function notifyDiscordChannelWithStartButton(username, text) {
  return discordSend('notify', { content: text, components: [startButtonRow(username)] });
}

// ---------- "anderswo eingeloggt"-Meldung aktualisieren ----------
// Die Meldung (mit Start-Knopf) wird pro Account gemerkt - auch ueber einen Neustart hinweg
// (accounts.json). Startet der Account danach auf irgendeinem Weg (Dashboard, !start,
// Neustart des Managers ...), wird sie bearbeitet wie bei einem Klick auf den Knopf.
const startSources = {}; // username -> z.B. "über das Dashboard (nils)"
const discordReadyWaiters = []; // laufen, sobald der Discord-Bot verbunden ist

function rememberElsewhereNotice(username, sent) {
  const acc = connSettings(username);
  if (!acc || !sent || !sent.id || !sent.channelId) return;
  acc.elsewhereNotice = { channelId: String(sent.channelId), messageId: String(sent.id) };
  saveConnSettings(username);
}

function forgetElsewhereNotice(username, onlyMessageId) {
  const acc = connSettings(username);
  if (!acc || !acc.elsewhereNotice) return null;
  if (onlyMessageId && acc.elsewhereNotice.messageId !== String(onlyMessageId)) return null;
  const notice = acc.elsewhereNotice;
  delete acc.elsewhereNotice;
  saveConnSettings(username);
  return notice;
}

function resolveElsewhereNotice(username) {
  const source = startSources[username];
  delete startSources[username];
  const acc = connSettings(username);
  if (!acc || !acc.elsewhereNotice || !discordClient || instanceIdle) return;
  const notice = forgetElsewhereNotice(username);
  const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const edit = async () => {
    try {
      const channel = await discordClient.channels.fetch(notice.channelId);
      const msg = await channel.messages.fetch(notice.messageId);
      await msg.edit({
        content: `${msg.content}\n\n▶️ **${connLabel(username)}** wurde${source ? ` ${source}` : ''} wieder gestartet (${time} Uhr).`,
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      console.warn(`Discord: "anderswo eingeloggt"-Meldung von ${username} konnte nicht aktualisiert werden (${e.message})`);
    }
  };
  if (discordReady) edit();
  else discordReadyWaiters.push(edit);
}

// ---------- Discord: Chat-Spiegel (Minecraft-Chat -> eigener Discord-Kanal) ----------
let discordChatBuffer = [];

function discordChatEnabled() {
  return !!(DISCORD_CHAT_WEBHOOK_URL || DISCORD_CHAT_CHANNEL_ID);
}

function queueDiscordChatLine(text, ts) {
  if (!discordChatEnabled()) return;
  const time = new Date(ts).toLocaleTimeString('de-DE');
  const safeText = text.replace(/`/g, "'");
  discordChatBuffer.push(formatDiscordChatLine(safeText, time));
}

// Packt nur Uhrzeit + Spielername in einen Code-Kasten (schuetzt vor Markdown-Verzerrung
// durch Unterstriche im Namen), der Rest der Nachricht bleibt normaler Text.
// Bekannte Vanilla-Mob-/Entity-Namen, die NICHT geboxt werden sollen (sind keine Spielernamen).
// Ein Spieler, der zufaellig genauso heisst, ist ein extrem seltener Grenzfall - dafuer gibt
// es keine 100%ig sichere Unterscheidung, daher wird das bewusst in Kauf genommen.
const MOB_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave spider', 'enderman', 'witch', 'slime',
  'magma cube', 'blaze', 'ghast', 'wither skeleton', 'wither', 'ender dragon', 'piglin',
  'piglin brute', 'zombified piglin', 'hoglin', 'zoglin', 'drowned', 'husk', 'stray',
  'phantom', 'vex', 'vindicator', 'evoker', 'pillager', 'ravager', 'guardian',
  'elder guardian', 'shulker', 'silverfish', 'endermite', 'iron golem', 'snow golem',
  'polar bear', 'wolf', 'warden', 'breeze', 'bogged', 'camel', 'sniffer',
  'arrow', 'fireball', 'lightning bolt', 'lightning', 'falling block', 'anvil', 'tnt',
  'skeleton horse', 'zombie horse', 'trader llama',
]);

// Boxt bei Todesnachrichten auch den "Verursacher" nach "by"/"to hurt" (z.B. den Killer),
// laesst aber eingeklammerte Todesursachen wie "[Intentional Game Design]" UND bekannte
// Mob-Namen (z.B. "Skeleton", "Cave Spider") unangetastet - das sind keine Spielernamen.
// Satzzeichen werden nur am ENDE abgeschnitten, nicht am Anfang - Bedrock/Crossplay-Spieler
// haben einen fuehrenden Punkt im Namen (z.B. ".Wolfi3871").
function boxSecondaryName(rest) {
  return rest.replace(/\b(by|to hurt)\s+(?!\[)(.+)$/i, (m, kw, tail) => {
    const words = tail.trim().split(/\s+/);
    const twoWord = words.slice(0, 2).join(' ').toLowerCase().replace(/[.,!?]+$/, '');
    const oneWord = (words[0] || '').toLowerCase().replace(/[.,!?]+$/, '');
    if (MOB_NAMES.has(twoWord) || MOB_NAMES.has(oneWord)) {
      return m; // Mob-Name -> unveraendert lassen
    }
    const rawName = words[0] || '';
    const remainder = tail.slice(rawName.length);
    const cleaned = rawName.replace(/[.,!?]+$/, '');
    const trailing = rawName.slice(cleaned.length);
    return `${kw} \`${cleaned}\`${trailing}${remainder}`;
  });
}

function formatDiscordChatLine(text, time) {
  const boxedTime = `\`[${time}]\``;

  // Zeilenumbrueche werden als echte Umbrueche in Discord dargestellt (kein Glaetten mehr).
  const flat = text.trim();

  // Chatnachricht mit optionalem Rang-Tag, z.B. "[Spieler] xMrMax67: ja bi" oder "xMrMax67: ja bi".
  // Alles zwischen Name und Doppelpunkt (z.B. das Boost-Blitz-Symbol ⚡) bleibt normaler Text.
  const chatMatch = flat.match(/^(\[[^\]]+\]\s*)?(\S+)([^:]*):\s*(.*)$/);
  if (chatMatch) {
    const tag = chatMatch[1] ? chatMatch[1].trim() : '';
    const name = chatMatch[2];
    const extra = chatMatch[3];
    const rest = chatMatch[4];
    const tagPart = tag ? `${tag} ` : '';
    return `${boxedTime} ${tagPart}\`${name}\`${extra}: ${rest}`;
  }

  // Shop-Kauf-Ankuendigung, z.B. "ClashSMP | Name hat sich gerade den Rang [X] gekauft!..."
  const shopMatch = flat.match(/^ClashSMP\s*\|\s*(\S+)\s+hat sich\s+(.*)$/i);
  if (shopMatch) {
    return `${boxedTime} ClashSMP | \`${shopMatch[1]}\` hat sich ${shopMatch[2]}`;
  }

  // Tipp-Nachricht, z.B. "Hey Name, mit dem /auctionhouse kannst du..."
  const heyMatch = flat.match(/^Hey\s+(\S+),\s*(.*)$/);
  if (heyMatch) {
    return `${boxedTime} Hey \`${heyMatch[1]}\`, ${heyMatch[2]}`;
  }

  // Event-/Todesnachricht: Spielername am Anfang, dann beliebiger Text (kein Doppelpunkt
  // direkt nach dem ersten Wort, da das eine Chatnachricht waere).
  // Erfasst alle Minecraft-Todesmeldungen inkl. ungewoehnlicher wie
  // "didn't want to live in the same world as", "was doomed to fall", etc.
  // Ausgeschlossen: Zeilen mit [ am Anfang (Rang-Tags), ClashSMP-Nachrichten, Hey-Tipps.
  const deathMatch = flat.match(/^([.\w]\S*)\s+((?!\S*:).+)$/);
  if (deathMatch) {
    return `${boxedTime} \`${deathMatch[1]}\` ${boxSecondaryName(deathMatch[2])}`;
  }

  // Fallback fuer alles andere (z.B. /hide-Bestaetigung, generelle Server-Hinweise):
  // nur die Uhrzeit geboxt, kein zusaetzliches Boxen von Woertern
  return `${boxedTime} ${flat}`;
}

let discordChatChain = Promise.resolve(); // haelt die Reihenfolge der Chat-Bloecke ein
setInterval(() => {
  if (discordChatBuffer.length === 0 || !discordChatEnabled()) return;
  const lines = discordChatBuffer;
  discordChatBuffer = [];

  // In Bloecke unter 1900 Zeichen aufteilen (Discord-Limit pro Nachricht ist 2000)
  const chunks = [];
  let chunk = '';
  for (const line of lines) {
    const candidate = chunk ? `${chunk}\n${line}` : line;
    if (candidate.length > 1900) {
      if (chunk) chunks.push(chunk);
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);

  chunks.forEach((c) => {
    discordChatChain = discordChatChain.then(() => discordSend('chat', { content: c })).catch(() => {});
  });
}, 2000);

// ---------- Primaerer Account (dessen Chat angezeigt wird) ----------
// Die Chat-Quelle wird ueber eine EIGENE Variable verfolgt, NICHT ueber die Position in der
// Liste - so bleibt die Reihenfolge der anderen Accounts stabil, wenn die Chat-Quelle
// automatisch wechselt (z.B. weil ein Account woanders eingeloggt wurde und spaeter wieder
// zurueckkommt). Initial ist das der Account mit preferredChatSource=true aus der Datei.
let currentChatSourceUsername = (accounts.find((a) => a.preferredChatSource) || accounts[0] || {}).username || null;

function getPrimaryUsername() {
  // Falls der aktuell gemerkte Account nicht mehr existiert (z.B. geloescht), auf den ersten
  // verfuegbaren zurueckfallen
  if (currentChatSourceUsername && accounts.some((a) => a.username === currentChatSourceUsername)) {
    return currentChatSourceUsername;
  }
  return accounts.length > 0 ? accounts[0].username : null;
}

function isPrimaryRunning() {
  const primary = getPrimaryUsername();
  return !!(primary && bots[primary] && bots[primary].bot);
}

// Chat-Quelle eines weiteren Servers - wird jedes Mal neu bestimmt: die per Stern gewuenschte
// Verbindung, wenn sie online ist, sonst die oberste Java-Verbindung, die gerade online ist.
// (Bedrock-Accounts lesen den Chat nicht mit und koennen deshalb keine Chat-Quelle sein.)
function chatSourceOf(serverId) {
  if (!serverId || serverId === DEFAULT_SERVER_ID) return getPrimaryUsername();
  const keys = allConnKeys().filter((k) => connServerId(k) === serverId && !isBedrockAccount(connUser(k)));
  if (keys.length === 0) return null;
  const online = (k) => bots[k] && bots[k].status === 'online';
  const preferred = keys.find((k) => (connSettings(k) || {}).preferredChatSource);
  if (preferred && online(preferred)) return preferred;
  return keys.find(online) || preferred || keys[0];
}
function chatSourceRunning(serverId) {
  const k = chatSourceOf(serverId);
  return !!(k && bots[k] && bots[k].bot);
}
// Chat-Status aller Server fuers Dashboard: { standard: { primary, active }, lobby: {...} }
function chatStatusAll() {
  const out = {};
  for (const sv of servers) out[sv.id] = { primary: chatSourceOf(sv.id), active: chatSourceRunning(sv.id) };
  return out;
}

function pruneChatHistory() {
  const cutoff = Date.now() - CHAT_HISTORY_MS;
  chatHistory = chatHistory.filter((m) => m.ts >= cutoff);
}

function accountListForClient(viewerUser) {
  const truePrimary = getPrimaryUsername();
  let visibleAccounts = accounts;
  let effectivePrimary = truePrimary;

  if (viewerUser && viewerUser.role === 'user') {
    visibleAccounts = accounts.filter((acc) => viewerUser.allowedAccounts.includes(acc.username));
    if (!viewerUser.allowedAccounts.includes(truePrimary)) {
      // Die echte Chat-Quelle ist fuer diesen Nutzer nicht sichtbar -> stattdessen der
      // hoechste FUER IHN sichtbare Account wird als "seine" Chat-Quelle markiert
      // (nur fuer die Stern-Markierung/Vorauswahl - die echte Quelle bleibt unveraendert
      // und wird separat ueber 'chat-status' fuer alle sichtbar gemacht).
      effectivePrimary = visibleAccounts.length > 0 ? visibleAccounts[0].username : null;
    }
  }

  return visibleAccounts.map((acc) => ({
    username: acc.username,
    status: bots[acc.username] ? bots[acc.username].status : 'gestoppt',
    uptimeMs: getUptimeMs(acc.username),
    isPrimary: acc.username === effectivePrimary,
    autoChat: acc.autoChat || [],
    notifyElsewhere: acc.notifyElsewhere !== false,
    // Weitere Server dieses Accounts (der Standardserver ist der Eintrag selbst)
    connections: extraConnections.filter((c) => c.username === acc.username).map((c) => {
      const key = connKey(c.username, c.server);
      const sv = getServer(c.server);
      return {
        key,
        server: c.server,
        serverName: sv ? sv.name : c.server,
        status: bots[key] ? bots[key].status : 'gestoppt',
        uptimeMs: getUptimeMs(key),
        isPrimary: key === chatSourceOf(c.server),
        autoChat: c.autoChat || [],
        notifyElsewhere: c.notifyElsewhere !== false,
      };
    }),
  }));
}

// "Alle offline" / "Alle wieder online" pro Server. Ruhiger als frueher: "wieder online" kommt
// nur nach einem richtigen Ausfall - nach "Alle offline", nach einem Massen-Kick (Server-Neustart),
// nach dem Start des Managers oder wenn mindestens ein Account laenger als
// DISCORD_ALL_ONLINE_AFTER_MIN Minuten (Standard 10) weg war. Ein einzelner Account, der kurz
// die Verbindung verliert und gleich wieder da ist, loest keine Meldung mehr aus.
const ALL_ONLINE_AFTER_MS = Math.max(0, parseFloat(process.env.DISCORD_ALL_ONLINE_AFTER_MIN || '10') || 0) * 60 * 1000;
const onlineState = {}; // serverId -> { last, downSince, notable }
function markNotableOutage(serverId) {
  const st = onlineState[serverId];
  if (st) st.notable = true;
}
function checkAllOnlineMessages() {
  for (const sv of servers) {
    const keys = allConnKeys().filter((k) => connServerId(k) === sv.id);
    const total = keys.length;
    const online = keys.filter((k) => bots[k] && bots[k].status === 'online').length;
    // Neu: der Start des Managers zaehlt als Ausfall (-> "Alle wieder online", sobald alle da sind)
    const st = onlineState[sv.id] || (onlineState[sv.id] = { last: null, downSince: null, notable: true });
    const where = sv.isDefault ? '' : ` (${sv.name})`;
    if (online < total && st.downSince === null) st.downSince = Date.now();
    if (st.last !== null && total > 0) {
      if (online === 0 && st.last > 0) {
        const causedByRecentKicks = Date.now() - (lastMassKickAt[sv.id] || 0) < KICK_BATCH_WINDOW_MS + 2000;
        if (!causedByRecentKicks) {
          sendDiscordEmbed({
            title: `🔴 Alle Accounts offline${where}`,
            description: sv.isDefault ? 'Kein Account ist gerade mit dem Server verbunden.' : `Kein Account ist gerade mit ${sv.name} verbunden.`,
            color: DISCORD_COLOR_DANGER,
          });
        }
        st.notable = true;
      } else if (online === total && st.last < total) {
        const longOutage = st.downSince !== null && Date.now() - st.downSince >= ALL_ONLINE_AFTER_MS;
        if (st.notable || longOutage) {
          sendDiscordEmbed({
            title: `🟢 Alle Accounts wieder online${where}`,
            description: `${online}/${total} Accounts sind verbunden.`,
            color: DISCORD_COLOR_OK,
          });
        }
        st.notable = false;
      }
    }
    if (online === total) st.downSince = null;
    st.last = online;
  }
}

function broadcastAccountList() {
  // Jeder verbundene Client bekommt seine EIGENE, nach seiner Rolle gefilterte Liste
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('accounts', accountListForClient(socket.user));
  }
  // Die echte, globale Chat-Quelle wird bewusst UNGEFILTERT an alle gesendet (Transparenz),
  // auch wenn sie fuer eingeschraenkte Nutzer nicht in ihrer eigenen Liste auftaucht.
  io.emit('chat-status', { primary: getPrimaryUsername(), active: isPrimaryRunning(), servers: chatStatusAll() });

  checkAllOnlineMessages();
}

function logChat(username, text) {
  console.log(`[${username}] ${text}`);
  const serverId = connServerId(username);
  if (serverId !== DEFAULT_SERVER_ID) {
    // Weiterer Server: nur ins Dashboard (Discord-Chat-Spiegel und Erweiterungen bekommen
    // weiterhin nur den Chat vom Standardserver)
    if (username === chatSourceOf(serverId)) {
      const entry = { username, text, ts: Date.now(), server: serverId };
      chatHistory.push(entry);
      pruneChatHistory();
      io.emit('chat', entry);
    }
    return;
  }
  // Nur Nachrichten des primaeren Accounts werden an die Clients gesendet/gespeichert
  if (username === getPrimaryUsername()) {
    const entry = { username, text, ts: Date.now(), server: DEFAULT_SERVER_ID };
    chatHistory.push(entry);
    pruneChatHistory();
    io.emit('chat', entry);
    queueDiscordChatLine(text, entry.ts);
    for (const fn of chatListeners) {
      try {
        fn({ account: username, text, ts: entry.ts, server: DEFAULT_SERVER_ID });
      } catch (e) {
        console.error('Erweiterung (Chat) Fehler:', e.message);
      }
    }
  }
}

// ---------- Bot-Steuerung ----------
function startBot(username) {
  // Haengt noch eine "anderswo eingeloggt"-Meldung mit Start-Knopf? Dann jetzt aktualisieren.
  if (!(bots[username] && bots[username].bot)) resolveElsewhereNotice(username);
  if (isBedrockAccount(username)) {
    startBedrockBot(username);
    return;
  }
  const acc = accountOf(username);
  const target = serverOf(username);
  if (!acc || !target || !connSettings(username)) return;
  if (bots[username] && bots[username].bot) return; // laeuft schon

  // Gehoert zu genau diesem Verbindungsversuch - damit Codes aus alten Versuchen erkannt werden
  const attempt = { ref: null };
  const options = {
    host: target.host,
    port: target.javaPort,
    // Wichtig: hier den FESTEN Cache-Schluessel verwenden, nicht den (aenderbaren)
    // Anzeigenamen - sonst denkt die Login-Bibliothek nach einem Umbenennen, es sei ein
    // komplett neuer Account, und verlangt einen neuen Microsoft-Login.
    username: acc.authCacheId,
    auth: 'microsoft',
    // Fest eingetragen statt ueber "prismarine-auth" importiert, damit unser eigener Code
    // KEINE eigene Versionsanforderung an diese Bibliothek stellt - die soll komplett von
    // mineflayer/minecraft-protocol vorgegeben werden. Sonst installiert npm zwei
    // widerspruechliche Versionen nebeneinander, und die alte (fehlerhafte) landet dort,
    // wo der eigentliche Login stattfindet (siehe: "device_code has already been used"-Bug).
    authTitle: '00000000441cc96b', // = Titles.MinecraftNintendoSwitch
    deviceType: 'Nintendo',
    flow: 'live',
    // Kleine Sichtweite (siehe MC_VIEW_DISTANCE oben): der Server schickt dem Bot dann nur
    // noch die Chunks und Entities direkt um ihn herum statt der halben Welt.
    viewDistance: MC_VIEW_DISTANCE,
    // Verhindert, dass die Bibliothek bei jedem nicht ganz lesbaren Paket den KOMPLETTEN
    // Paketinhalt (JSON + Hex-Dump, ~600 Zeichen) in die Konsole schreibt. Bei vielen Bots
    // sind das hunderte Zeilen pro Sekunde, die den Prozess ausbremsen (Konsolenausgabe
    // blockiert unter Linux) und die SD-Karte fuellen. Die Pakete selbst werden
    // weiterhin ganz normal verarbeitet.
    hideErrors: true,
    // Die Bibliothek liefert snake_case Felder (user_code, verification_uri, expires_in)
    onMsaCode: (data) => handleMsaCode(username, attempt, data, connLabel(username)),
  };

  if (reconnectTimers[username]) {
    clearTimeout(reconnectTimers[username]);
    delete reconnectTimers[username];
  }

  const bot = mineflayer.createBot(options);
  attempt.ref = bot;
  bots[username] = {
    bot,
    status: 'verbinde...',
    hideTimer: null, autoChatTimers: [],
    manualStop: false,
    // Merkt sich, ob es innerhalb DIESER Verbindung schon einen Spawn gab. Wichtig, weil
    // 'spawn' bei mineflayer nicht nur beim (Re-)Connect feuert, sondern auch bei jedem
    // Dimensionswechsel (Nether/End/Overworld) - /hide soll aber nur einmal pro echtem
    // Reconnect kommen, nicht bei jedem Dimensionswechsel.
    hasSpawnedThisConnection: false,
  };
  broadcastAccountList();

  bot.on('login', () => {
    if (bots[username]?.bot !== bot) return; // Event von einem bereits verworfenen alten Bot-Objekt
    bots[username].status = 'online';
    markOnline(username);
    delete kickNotifyThrottle[username]; // erfolgreich verbunden -> naechster Kick ist wieder eine "neue" Meldung wert

    // Falls dieser Account eigentlich die gewuenschte Chat-Quelle ist, aber gerade temporaer
    // verdraengt wurde (z.B. weil er woanders eingeloggt war) -> jetzt automatisch zurueckwechseln
    const acc = connSettings(username);
    if (!isDefaultConn(username)) {
      // Chat-Quelle gibt es bisher nur fuer den Standardserver
    } else if (acc && acc.preferredChatSource && getPrimaryUsername() !== username) {
      makeAccountPrimary(username);
      logChat(username, `--- ist wieder online, Chat-Quelle automatisch zurueck auf ${username} gewechselt ---`);
    } else {
      reevaluateChatSource();
    }

    broadcastAccountList();
    logChat(username, '--- eingeloggt ---');
    io.emit('msa-code-clear', { username });
    msaLoginSucceeded(username);

    if (currentlyProcessing === username) {
      if (sequentialWatchdogTimer) {
        clearTimeout(sequentialWatchdogTimer);
        sequentialWatchdogTimer = null;
      }
      currentlyProcessing = null;
      // Erfolgreich eingeloggt -> nach kurzer Pause ist der naechste Account in der Liste dran
      setTimeout(() => advanceSequentialQueue(), SEQUENTIAL_STEP_DELAY_MS);
    }
  });

  bot.on('spawn', () => {
    if (bots[username]?.bot !== bot) return;
    const state = bots[username];

    // Nur beim ERSTEN Spawn dieser Verbindung reagieren - weitere 'spawn'-Events (z.B. durch
    // einen Dimensionswechsel Nether/End/Overworld) sollen KEINE erneuten Auto-Chats ausloesen.
    if (state.hasSpawnedThisConnection) return;
    state.hasSpawnedThisConnection = true;
    logChat(username, '--- gespawnt (steht jetzt tatsaechlich in der Welt) ---');

    const acc = connSettings(username);

    if (acc && acc.everJoined && Array.isArray(acc.autoChat) && acc.autoChat.length > 0) {
      // Auto-Chat-Aktionen ausfuehren: fuer jede Aktion einen eigenen Timer setzen
      if (state.autoChatTimers) state.autoChatTimers.forEach(clearTimeout);
      state.autoChatTimers = acc.autoChat.map(({ text, delaySeconds }) =>
        setTimeout(() => {
          const s = bots[username];
          if (s && s.bot && s.bot === bot) {
            s.bot.chat(text);
            logChat(username, `${text} (Auto-Chat nach ${delaySeconds}s)`);
          }
        }, (delaySeconds || 0) * 1000)
      );
    }

    if (acc && !acc.everJoined) {
      acc.everJoined = true;
      saveConnSettings(username);
    }
  });

  bot.on('message', (jsonMsg) => {
    if (bots[username]?.bot !== bot) return;
    // Alle Accounts sind auf demselben Server und sehen denselben Chat. logChat wertet
    // aber nur den Chat der Chat-Quelle aus (Webseite, Verlauf, Discord-Spiegel) - bei allen
    // anderen blieb nur eine doppelte Zeile in der Konsole uebrig. Bei vielen Accounts war
    // das jede Chatnachricht 15-20x im Log. Statusmeldungen ("--- eingeloggt ---" usw.)
    // laufen weiterhin fuer jeden Account ueber logChat.
    if (username !== chatSourceOf(connServerId(username))) return;
    logChat(username, jsonMsg.toString());
  });

  // Server verlangt ein Ressourcenpaket (eigene Texturen o.ae.): annehmen, ohne es herunterzuladen -
  // ein AFK-Bot braucht keine Texturen. Ohne Antwort werfen manche Server den Account raus.
  // (Waehrend der Anmeldung/Konfiguration antwortet mineflayer ab 4.39 selbst.)
  bot.on('resourcePack', () => {
    if (bots[username]?.bot !== bot) return;
    if (!bot._client || bot._client.state !== 'play' || typeof bot.acceptResourcePack !== 'function') return;
    try {
      bot.acceptResourcePack();
      console.log(`[${username}] Server schickt ein Ressourcenpaket - angenommen (wird nicht heruntergeladen)`);
    } catch (e) {
      console.warn(`[${username}] Ressourcenpaket konnte nicht beantwortet werden:`, e.message);
    }
  });

  bot.on('kicked', (reason) => {
    if (bots[username]?.bot !== bot) return;
    const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
    const readableReason = extractReadableKickReason(reasonText);
    logChat(username, `--- gekickt: ${readableReason} ---`);

    // Wenn der Account woanders eingeloggt wurde (z.B. am PC), NICHT automatisch reconnecten -
    // sonst kaempft der Bot mit dem echten Spieler um die Verbindung.
    // Wichtig: Diese Pruefung laeuft weiterhin gegen den ROHEN Text, da manche Server das
    // z.B. als "translate":"multiplayer.disconnect.duplicate_login" schicken, was in der
    // lesbaren Kurzfassung ggf. gar nicht mehr vorkommt.
    const isDuplicateLogin = /duplicate_login|already_connected|logged in from another location/i.test(reasonText);
    if (isDuplicateLogin) {
      const state = bots[username];
      if (state) state.manualStop = true;
      logChat(username, '--- Account scheint anderswo eingeloggt zu sein, kein Auto-Reconnect (bitte manuell auf Start druecken, wenn du fertig bist) ---');
      if (isDefaultConn(username)) temporarilyDemotePrimary(username);

      // Pro Account abschaltbar (Dashboard, nur Owner/Admin). Standard: an.
      const accForNotify = connSettings(username);
      if (accForNotify && accForNotify.notifyElsewhere === false) {
        logChat(username, '--- Discord-Benachrichtigung "anderswo eingeloggt" ist fuer diesen Account deaktiviert ---');
      } else {
        // Ueber den Bot mit Start-Knopf (ohne Bot automatisch per Webhook, dann ohne Knopf)
        notifyDiscordChannelWithStartButton(
          username,
          `🔐 **${connLabel(username)}** ist anderswo eingeloggt. Kein Auto-Reconnect – klick unten, wenn du fertig gespielt hast:`
        ).then((sent) => rememberElsewhereNotice(username, sent)).catch(() => {});
      }
    } else {
      queueKickNotification(username, readableReason);
    }
  });

  bot.on('error', (err) => {
    if (bots[username]?.bot !== bot) return;
    logChat(username, `--- Fehler: ${err.message} ---`);

    // Manche Fehler (z.B. "array size is abnormally large" von minecraft-protocol)
    // schliessen die Verbindung NICHT automatisch - der Bot haengt dann als Zombie:
    // technisch tot, aber kein 'end'-Event kommt, weshalb der Reconnect nicht greift.
    // Loesung: nach Parse-/Netzwerk-Fehlern den Bot nach kurzer Verzoegerung hart abwuergen,
    // damit das 'end'-Event ausgeloest wird und der normale Reconnect-Ablauf greift.
    const isFatalParseError = (
      err.message.includes('abnormally large') ||
      err.message.includes('Parse error') ||
      err.message.includes('Read error') ||
      err.message.includes('Invalid') ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'EPIPE'
    );

    if (isFatalParseError) {
      logChat(username, `--- Fataler Fehler, erzwinge Reconnect... ---`);
      setTimeout(() => {
        if (bots[username]?.bot === bot) {
          forceKillBot(username);
        }
      }, 2000);
    }
  });

  bot.on('end', () => {
    if (bots[username]?.bot !== bot) return; // schon durch Stop/Watchdog abgeloest - ignorieren
    const state = bots[username];
    const wasManualStop = state ? state.manualStop : false;
    const accountStillExists = connectionExists(username);
    const wasBeingSequentiallyProcessed = currentlyProcessing === username;

    markOffline(username);

    if (wasBeingSequentiallyProcessed && sequentialWatchdogTimer) {
      clearTimeout(sequentialWatchdogTimer);
      sequentialWatchdogTimer = null;
    }

    if (state) {
      if (state.hideTimer) clearTimeout(state.hideTimer);
      if (state.autoChatTimers) state.autoChatTimers.forEach(clearTimeout);
      state.autoChatTimers = [];
      if (state.msaTimer) { clearTimeout(state.msaTimer); state.msaTimer = null; }
      state.bot = null;
    }

    if (wasManualStop || !accountStillExists) {
      if (state) state.status = 'gestoppt';
      broadcastAccountList();
      logChat(username, '--- Verbindung beendet ---');
      if (wasBeingSequentiallyProcessed) {
        currentlyProcessing = null;
        advanceSequentialQueue();
      }
      return;
    }

    if (wasBeingSequentiallyProcessed) {
      // War Teil der laufenden Sequenz und hat NICHT geklappt -> nach laengerer Pause
      // DENSELBEN Account nochmal versuchen, bevor der naechste in der Liste drankommt
      currentlyProcessing = null;
      logChat(username, `--- Verbindung beendet, erneuter Versuch in ${SEQUENTIAL_RETRY_DELAY_MS / 1000}s ---`);
      scheduleSequentialRetry(username);
      return;
    }

    // Einzelner oder gleichzeitiger Ausfall (z.B. Server-Neustart) -> Reconnect anmelden.
    // Wichtig: Der Account wird SOFORT in die Warteliste eingetragen, aber der eigentliche
    // Start laeuft ueber EINEN gemeinsamen Timer. So werden bei einem Massen-Kick erst alle
    // betroffenen Accounts gesammelt und danach strikt von OBEN NACH UNTEN abgearbeitet -
    // statt dass derjenige zuerst startet, dessen eigener Timer zufaellig zuerst ablief.
    if (state) state.status = `Reconnect-Versuch in ${RECONNECT_DELAY_MS / 1000}s...`;
    broadcastAccountList();
    logChat(username, `--- Verbindung beendet, Reconnect-Versuch in ${RECONNECT_DELAY_MS / 1000}s ---`);
    scheduleGroupedReconnect(username);
  });
}

// ---------- Chat/Befehle ueber Bedrock senden ----------
// Bedrock kennt zwei getrennte Pakete: normaler Chat laeuft ueber 'text', Befehle (/...)
// ueber 'command_request' (ein 'text'-Paket mit "/" kaeme nur als normale Chatnachricht an).
// Die Paketform haengt von der Protokollversion ab (siehe docs/API.md von bedrock-protocol):
//  - 'text': ab Bedrock 1.26 gibt es das Pflichtfeld 'category' ('authored' fuer
//    Spielerchat) und 'has_filtered_message'; aeltere Versionen kennen stattdessen
//    'filtered_message'. Unbekannte Felder werden beim Serialisieren ignoriert, deshalb
//    schicken wir ein Feld-Set, das fuer alle bekannten Versionen passt (geprueft fuer
//    1.18 bis 1.21.124 und 1.26.x). Ausnahme: Genau in 1.21.130 hat das Schema zusaetzliche
//    Textfelder - dort scheitert das Serialisieren, und wir melden einen Fehler, statt
//    etwas Unsicheres zu senden.
//    Achtung: Fehlt 'category', wird NICHT etwa ein Fehler geworfen - es wird still die
//    falsche Kategorie 'message_only' geschrieben (so lief der alte Auto-Chat).
//  - 'command_request': ab 1.21.130 ist 'version' ein Text und origin.player_entity_id
//    Pflicht. Dokumentiert und geprueft ist das fuer Bedrock 1.26.x ('latest'); falsche
//    Werte fuehren dort zum Rauswurf. Fuer aeltere Versionen kennen wir keinen sicheren
//    Wert fuer 'version' - dort werden Befehle deshalb NICHT gesendet (normaler Chat geht).
const BEDROCK_COMMAND_MIN_PROTOCOL = 924; // Bedrock 1.26.0

function sendBedrockMessage(client, text, fallbackName) {
  const message = String(text);
  if (!message.trim()) throw new Error('Leere Nachricht');
  const protocol = client.options && client.options.protocolVersion;
  const senderName = (client.profile && client.profile.name) || client.username || fallbackName;

  // queue() serialisiert sofort und wirft bei einer unpassenden Paketform, BEVOR etwas
  // gesendet wird - so wird ein Formfehler als Meldung statt als Rauswurf sichtbar.
  const queue = (name, params) => {
    try {
      client.queue(name, params);
    } catch (e) {
      const reason = String(e.message).split('\n')[0].slice(0, 80);
      throw new Error(`Paket konnte fuer diese Bedrock-Version nicht erstellt werden (${reason})`);
    }
  };

  if (message.startsWith('/')) {
    if (typeof protocol !== 'number' || protocol < BEDROCK_COMMAND_MIN_PROTOCOL) {
      throw new Error('Befehle (/...) werden ueber Bedrock erst ab Server-Version 1.26 unterstuetzt');
    }
    queue('command_request', {
      command: message,
      origin: { type: 'player', uuid: crypto.randomUUID(), request_id: '', player_entity_id: 0n },
      internal: false,
      version: 'latest',
    });
    return 'command';
  }

  queue('text', {
    needs_translation: false,
    category: 'authored',
    type: 'chat',
    source_name: senderName,
    message,
    xuid: '',
    platform_chat_id: '',
    has_filtered_message: false,
    filtered_message: '',
  });
  return 'text';
}

// Sendet Chat oder einen /Befehl ueber einen Account - Java ueber bot.chat(), Bedrock ueber
// Pakete. Gibt { ok: true } oder { ok: false, error: '...' } zurueck, wirft nie.
function sendChatMessage(username, text) {
  const state = bots[username];
  if (!state || !state.bot) return { ok: false, error: 'Bot laeuft nicht' };
  // Vor dem Login (Java) bzw. Spawn (Bedrock) geht nichts raus: Java wuerde die Nachricht
  // still verschlucken, Bedrock wuerde es als Protokollfehler werten.
  if (state.status !== 'online') return { ok: false, error: `Account ist gerade nicht verbunden (Status: ${state.status})` };
  try {
    if (state.isBedrock) {
      sendBedrockMessage(state.bot, text, username);
    } else {
      state.bot.chat(text);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- Bedrock: NetherNet oder RakNet? ----------
// Seit Bedrock 26.60 (Okt. 2026) treten Spieler ueber NetherNet bei (Anmeldung per HTTP auf dem
// Bedrock-Port, danach WebRTC ueber UDP); Geyser nimmt standardmaessig nur noch das an. Ob der
// Server NetherNet anbietet, wird per HTTP gefragt (nethernet-http.js) und 10 Minuten gemerkt.
let nnhttp = null;
try {
  nnhttp = require('./nethernet-http');
} catch (e) {
  console.warn('nethernet-http.js fehlt - Bedrock-Accounts verbinden nur ueber RakNet:', e.message);
}
const BEDROCK_ROUTE_TTL_MS = 10 * 60 * 1000;
const bedrockRoutes = {}; // serverId -> { value, at, pending, lastLogged }
function routeOf(serverId) {
  const sid = serverId || DEFAULT_SERVER_ID;
  return bedrockRoutes[sid] || (bedrockRoutes[sid] = { value: null, at: 0, pending: null, lastLogged: '' });
}
let weriftTuned = null; // Verbindungspruefung von werift wird nur einmal pro Prozess angepasst

function invalidateBedrockRoute(serverId) {
  routeOf(serverId).at = 0;
}

function resolveBedrockTransport(serverId) {
  const sv = getServer(serverId || DEFAULT_SERVER_ID) || defaultServer;
  const host = sv.host;
  const port = sv.bedrockPort;
  const bedrockRoute = routeOf(sv.id);
  if (MC_BEDROCK_TRANSPORT === 'raknet' || !nnhttp) return Promise.resolve({ transport: 'raknet' });
  if (bedrockRoute.value && Date.now() - bedrockRoute.at < BEDROCK_ROUTE_TTL_MS) return Promise.resolve(bedrockRoute.value);
  if (bedrockRoute.pending) return bedrockRoute.pending;
  // Im Modus 'auto' zuerst kurz per RakNet anklopfen: bietet der Server RakNet noch an
  // (Geyser "transport: both"), ist das der bewaehrte, schnelle Weg (nativer Code).
  const raknetFirst = MC_BEDROCK_TRANSPORT === 'auto' && bedrockProtocol && typeof bedrockProtocol.ping === 'function'
    ? bedrockProtocol.ping({ host, port, transport: 'raknet', timeout: 1500 })
      .then(() => ({ transport: 'raknet', viaPing: true }), () => null)
    : Promise.resolve(null);
  bedrockRoute.pending = raknetFirst
    .then((rak) => rak || nnhttp.probe({ host, port })
      .then((p) => ({ transport: 'nethernet', scheme: p.scheme, address: p.address })))
    .catch((err) => (MC_BEDROCK_TRANSPORT === 'nethernet'
      ? { transport: 'nethernet', scheme: null, probeError: err.message }
      : { transport: 'raknet', probeError: err.message }))
    .then((route) => {
      bedrockRoute.value = route;
      bedrockRoute.at = Date.now();
      bedrockRoute.pending = null;
      const key = `${route.transport}|${route.scheme || ''}`;
      if (key !== bedrockRoute.lastLogged) {
        bedrockRoute.lastLogged = key;
        if (route.transport === 'nethernet' && !route.probeError) {
          console.log(`[Bedrock] ${host}:${port} bietet NetherNet an - Bedrock-Accounts verbinden ueber NetherNet (Anmeldung per ${String(route.scheme).toUpperCase()} an ${route.address})`);
          const firstTune = !weriftTuned;
          const t = weriftTuned || (weriftTuned = nnhttp.tuneWerift());
          if (firstTune) {
          console.log(`[Bedrock] NetherNet ueber ${MC_BEDROCK_NETHERNET_IPV6 === 'only' ? 'nur IPv6' : MC_BEDROCK_NETHERNET_IPV6 ? 'IPv4 und IPv6' : 'nur IPv4 (MC_BEDROCK_NETHERNET_IPV6=only fuer nur IPv6)'}`);
          const nativ = MC_BEDROCK_NETHERNET_WEBRTC !== 'werift' && nativeWebrtcAvailable();
          console.log(bedrockUsesThreads()
            ? '[Bedrock] NetherNet-WebRTC: werift, jeder Bedrock-Account in einem eigenen Thread'
            : nativ
              ? '[Bedrock] NetherNet-WebRTC: nativ (@roamhq/wrtc), alles im Haupt-Thread'
              : '[Bedrock] NetherNet-WebRTC: werift, alles im Haupt-Thread');
          console.log(t.ok
            ? `[Bedrock] NetherNet-Verbindungspruefung tolerant: ${t.responseMs} ms Antwortzeit, Aufgabe nach ${t.consentTimeoutS} s ohne Antwort${t.delayedAck ? ', Empfangsbestaetigung fuer jedes 2. Paket statt jedes einzelne' : ''}`
            : `[Bedrock] NetherNet-Verbindungspruefung konnte nicht angepasst werden: ${t.error}`);
          }
        } else if (route.transport === 'nethernet') {
          console.log(`[Bedrock] NetherNet ist fest eingestellt, die Server-Abfrage ging aber nicht (${route.probeError})`);
        } else if (route.viaPing) {
          console.log(`[Bedrock] ${host}:${port} antwortet ueber RakNet - Bedrock-Accounts verbinden ueber RakNet`);
        } else {
          console.log(`[Bedrock] ${host}:${port}: kein NetherNet (${route.probeError}) - Bedrock-Accounts verbinden ueber RakNet`);
        }
      }
      return route;
    });
  return bedrockRoute.pending;
}

// ---------- Bedrock: Server antwortet gar nicht ----------
// Kommt keine Verbindung zustande, haengt der Account nicht in "verbinde..." und blockiert
// auch nicht die Warteschlange: er wird mit wachsender Pause neu eingereiht, die naechsten
// Accounts sind sofort dran.
const BEDROCK_UNREACHABLE_NOTICE_MS = 6 * 60 * 60 * 1000; // hoechstens alle 6 Stunden nach Discord (pro Server)

// Ist auf diesem Server gerade irgendein Bedrock-Account im Spiel?
function anyBedrockOnline(serverId) {
  const sid = serverId || DEFAULT_SERVER_ID;
  return Object.entries(bots).some(([k, st]) => st && st.isBedrock && st.bot && st.status === 'online' && connServerId(k) === sid);
}

// Bedrock-Pause: Scheitern mehrere Verbindungsversuche hintereinander und ist KEIN Bedrock-Account
// online, nimmt der Server (bzw. sein DDoS-Schutz) gerade keine Verbindungen von uns an. Dauernde
// neue Versuche machen das nur schlimmer (die IP wird laenger gesperrt). Dann warten alle Bedrock-
// Accounts BEDROCK_PAUSE_MIN Minuten; danach probiert es EIN Account. Klappt es, kommen die anderen
// nach, sonst wieder Pause. Ein Klick auf Start probiert es trotzdem sofort.
// (Einstellungen und Zustand stehen oben bei reconnectFailCount)
function bedrockPauseActive(serverId) {
  return bpOf(serverId).until > Date.now();
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function parkBedrockAccount(username) {
  const state = bots[username];
  const sid = connServerId(username);
  const bedrockPause = bpOf(sid);
  bedrockPause.waiting.add(username);
  pendingReconnectSet.delete(username);
  if (reconnectTimers[username]) { clearTimeout(reconnectTimers[username]); delete reconnectTimers[username]; }
  if (state) {
    state.status = `Bedrock-Pause bis ${clockTime(bedrockPause.until)} (Server nimmt gerade keine Verbindung an)`;
    broadcastAccountList();
  }
  if (!bedrockPause.timer) {
    bedrockPause.timer = setTimeout(() => endBedrockPause(sid), Math.max(1000, bedrockPause.until - Date.now()));
  }
}

function endBedrockPause(serverId) {
  const bedrockPause = bpOf(serverId);
  bedrockPause.timer = null;
  // Nur EIN Account (der oberste in der Liste) probiert es - die anderen warten auf sein Ergebnis
  const next = allConnKeys().find((k) => bedrockPause.waiting.has(k) && bots[k] && !bots[k].manualStop);
  if (!next) { bedrockPause.waiting.clear(); return; }
  bedrockPause.waiting.delete(next);
  bedrockPause.probe = next;
  console.log(`[Bedrock] Pause vorbei - ${next} probiert es (${bedrockPause.waiting.size} weitere warten auf das Ergebnis)`);
  requestBotStart(next, { probe: true });
}

// Ein Bedrock-Account ist ins Spiel gekommen: Pause beenden, alle Wartenden nachholen
// Der Probe-Account wurde gestoppt oder geloescht, bevor es ein Ergebnis gab: der naechste probiert es
function bedrockProbeEnded(username) {
  const sid = connServerId(username);
  const bedrockPause = bpOf(sid);
  if (bedrockPause.probe !== username) return;
  bedrockPause.probe = null;
  if (bedrockPause.waiting.size && !bedrockPause.timer) bedrockPause.timer = setTimeout(() => endBedrockPause(sid), 5000);
}

function bedrockSpawnSucceeded(serverId) {
  const bedrockPause = bpOf(serverId);
  bedrockPause.fails = 0;
  bedrockPause.probe = null;
  const wasPaused = bedrockPause.until > 0 || bedrockPause.waiting.size > 0;
  bedrockPause.until = 0;
  if (bedrockPause.timer) { clearTimeout(bedrockPause.timer); bedrockPause.timer = null; }
  if (!wasPaused) return;
  const waiting = allConnKeys().filter((k) => bedrockPause.waiting.has(k));
  bedrockPause.waiting.clear();
  if (waiting.length) console.log(`[Bedrock] Verbindung klappt wieder - ${waiting.length} wartende Bedrock-Account(s) verbinden der Reihe nach`);
  for (const u of waiting) {
    if (bots[u] && !bots[u].manualStop) requestBotStart(u);
  }
}

// Gemeinsamer Weg fuer jeden Bedrock-Verbindungsversuch, der VOR dem Spawn scheitert (Server
// antwortet nicht, UDP kommt nicht durch, Abbruch waehrend der Anmeldung ...). Der Bot ist hier
// schon getrennt (state.bot === null). Die Warteschlange wird NICHT blockiert: die naechsten
// Accounts sind sofort dran, dieser wird mit wachsender Pause neu eingereiht.
function bedrockRetryAfterFailure(username, detail, transport = 'raknet') {
  const state = bots[username];
  if (!state) return;
  const sid = connServerId(username);
  const bedrockPause = bpOf(sid);
  invalidateBedrockRoute(sid); // beim naechsten Versuch neu fragen, ob/wie der Server Bedrock annimmt
  if (state.msaTimer) { clearTimeout(state.msaTimer); state.msaTimer = null; }

  if (currentlyProcessing === username) {
    if (sequentialWatchdogTimer) { clearTimeout(sequentialWatchdogTimer); sequentialWatchdogTimer = null; }
    currentlyProcessing = null;
    setTimeout(() => advanceSequentialQueue(), 1000); // nicht auf diesen Account warten
  }
  if (state.manualStop || !connectionExists(username)) {
    state.status = 'gestoppt';
    broadcastAccountList();
    return;
  }

  reconnectFailCount[username] = (reconnectFailCount[username] || 0) + 1;
  bedrockPause.fails++;
  if (bedrockPause.probe === username) bedrockPause.probe = null;
  const fails = reconnectFailCount[username];
  state.lastFailure = detail;

  // Kommt gerade gar kein Bedrock-Account durch -> alle pausieren statt weiter anzuklopfen
  if (bedrockPause.fails >= BEDROCK_PAUSE_AFTER_FAILS && !anyBedrockOnline(sid)) {
    const starting = !bedrockPauseActive(sid);
    if (starting) {
      bedrockPause.until = Date.now() + BEDROCK_PAUSE_MS;
      const sv = getServer(sid);
      const where = sid === DEFAULT_SERVER_ID || !sv ? '' : ` auf ${sv.name}`;
      console.warn(`[Bedrock] ${bedrockPause.fails} Verbindungsversuche hintereinander gescheitert, kein Bedrock-Account online${where} (zuletzt ${username}: ${detail}) - alle Bedrock-Accounts${where} pausieren bis ${clockTime(bedrockPause.until)}`);
      // Bedrock-Accounts dieses Servers, die schon in der Warteschlange stehen, warten ebenfalls
      for (const u of [...pendingReconnectSet]) {
        if (u !== username && isBedrockAccount(connUser(u)) && connServerId(u) === sid) parkBedrockAccount(u);
      }
    }
    logChat(username, `--- Bedrock: keine Verbindung (${detail}) - Pause bis ${clockTime(bedrockPause.until)} ---`);
    parkBedrockAccount(username);
    maybeNotifyBedrockUnreachable(sid, detail, transport);
    return;
  }

  const delay = getBackoffDelay(username);
  const delaySec = Math.round(delay / 1000);
  if (fails <= 3 || fails % 10 === 0) {
    logChat(username, `--- Bedrock: keine Verbindung (${detail}), Fehlschlag ${fails}x, neuer Versuch in ${delaySec}s ---`);
  }
  state.status = `Keine Verbindung – neuer Versuch in ${delaySec}s`;
  broadcastAccountList();
  if (reconnectTimers[username]) clearTimeout(reconnectTimers[username]);
  reconnectTimers[username] = setTimeout(() => {
    delete reconnectTimers[username];
    requestBotStart(username);
  }, delay);
  if (fails >= 3) maybeNotifyBedrockUnreachable(sid, detail, transport);
}

function bedrockServerUnreachable(username, client, detail, transport = 'raknet') {
  const state = bots[username];
  if (!state || state.bot !== client) return;
  state.bot = null; // ab hier ignoriert der close-Handler dieses Objekt
  try { client.close(); } catch (_) { /* egal */ }
  neutralizeLoginAttempt(username, client);
  markOffline(username);
  bedrockRetryAfterFailure(username, detail, transport);
}

function maybeNotifyBedrockUnreachable(serverId, detail, transport) {
  // Kommt KEIN Bedrock-Account durch, liegt es am Server - einmal erklaeren, was zu tun ist.
  // (Sind andere Bedrock-Accounts online, ist es nur dieser eine - dann keine Meldung.)
  const sv = getServer(serverId) || defaultServer;
  const bp = bpOf(sv.id);
  if (!anyBedrockOnline(sv.id) && Date.now() - bp.unreachableNoticeAt > BEDROCK_UNREACHABLE_NOTICE_MS) {
    bp.unreachableNoticeAt = Date.now();
    const via = transport === 'nethernet' ? 'NetherNet' : 'RakNet';
    console.warn(`[Diagnose] Bedrock: keine Verbindung zu ${sv.host}:${sv.bedrockPort} ueber ${via} (${detail}).`);
    sendDiscordEmbed({
      title: `⚠️ Bedrock-Accounts kommen nicht auf den Server${sv.isDefault ? '' : ` (${sv.name})`}`,
      description:
        `Keine Verbindung zu ${sv.host}:${sv.bedrockPort} über **${via}**: ${detail}\n\n` +
        (transport === 'nethernet'
          ? 'Der Server nimmt die Anmeldung per NetherNet an, aber die Verbindung danach (UDP) kommt nicht zustande. ' +
            'Kommen normale Bedrock-Spieler gerade drauf? Wenn ja, bitte melden.'
          : 'Der Server antwortet weder über NetherNet noch über RakNet. Ist er gerade erreichbar ' +
            '(Neustart, Wartung)? Kommen normale Bedrock-Spieler drauf?') +
        `\n\nDie Accounts versuchen es automatisch weiter. Kommt gar keiner durch, pausieren sie und probieren es alle ${Math.round(BEDROCK_PAUSE_MS / 60000)} Minuten einmal (damit der Server uns nicht wegen zu vieler Versuche aussperrt). Start-Klick = sofort probieren.`,
      color: DISCORD_COLOR_WARN,
    });
  }
}

// ---------- Bedrock-Bot ----------
// Wo eine NetherNet-Verbindung zuletzt stand (fuer die Fehlermeldung, wenn sie scheitert)
// Kandidaten kurz fuer das Log: "udp 2001:db8::1 19132 (host), udp 51.195.37.70 19132 (srflx)"
function formatNnCandidates(list) {
  if (!Array.isArray(list)) return 'unbekannt (keine Antwort)';
  if (!list.length) return 'keine';
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = `${c.protocol} ${c.ip} ${c.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${key} (${c.type})`);
  }
  return out.length > 8 ? `${out.slice(0, 8).join(', ')} und ${out.length - 8} weitere` : out.join(', ');
}

const NN_STEP_LABELS = {
  angebot: 'Verbindungsangebot an den Server geschickt',
  antwort: 'Antwort vom Server, UDP-Verbindung wird aufgebaut',
  'webrtc-verbunden': 'UDP-Verbindung steht, Minecraft-Login laeuft',
};
const NN_ERROR_TEXT = {
  2: 'Zeitueberschreitung bei der Verhandlung',
  5: 'ICE-Fehler',
  9: 'keine Antwort ueber UDP',
  14: 'keine Antwort auf das Angebot',
};

function startBedrockBot(username) {
  if (!bedrockProtocol) {
    logChat(username, '--- Bedrock nicht verfuegbar: npm install bedrock-protocol ---');
    return;
  }
  const acc = accountOf(username);
  if (!acc || !serverOf(username) || !connSettings(username)) return;
  if (bots[username] && (bots[username].bot || bots[username].pendingStart)) return;
  bpFor(username).waiting.delete(username);

  const startToken = {};
  bots[username] = {
    bot: null,
    status: 'verbinde...',
    hideTimer: null,
    autoChatTimers: [],
    manualStop: false,
    hasSpawnedThisConnection: false,
    isBedrock: true,
    pendingStart: startToken, // wartet auf die Transport-Wahl (NetherNet oder RakNet)
  };
  broadcastAccountList();

  resolveBedrockTransport(connServerId(username)).then((route) => {
    const state = bots[username];
    if (!state || state.pendingStart !== startToken) return; // inzwischen gestoppt oder neu gestartet
    state.pendingStart = null;
    if (state.manualStop) return;
    connectBedrockClient(username, acc, route);
  }).catch((e) => {
    console.error(`[${username}] Bedrock-Start fehlgeschlagen:`, e);
    const state = bots[username];
    if (state && state.pendingStart === startToken) state.pendingStart = null;
  });
}

function connectBedrockClient(username, acc, route) {
  const useNethernet = route && route.transport === 'nethernet';
  // NetherNet mit werift laeuft in einem eigenen Thread (siehe bedrock-worker.js)
  const useThread = useNethernet && bedrockUsesThreads();
  bots[username].transport = useNethernet ? 'nethernet' : 'raknet';
  bots[username].threaded = useThread;
  // Echter Xbox-Gamertag = Accountname ohne fuehrenden Punkt (nicht der Verbindungs-Schluessel)
  const xboxGamertag = acc.username.startsWith('.') ? acc.username.slice(1) : acc.username;
  // Einstellungen dieser Verbindung (everJoined, Auto-Chat) und Zielserver
  const cs = connSettings(username);
  const target = serverOf(username);
  // WICHTIG: Separaten Cache-Ordner fuer Bedrock verwenden!
  // Ohne das wuerde der Cache ueber den Gamertag-Namen zugeordnet - wenn ein Bedrock-Account
  // denselben Namen wie ein Java-Account hat (z.B. ".NilsMovie" -> "NilsMovie"), wuerden
  // sie sich denselben Auth-Cache teilen und gegenseitig den jeweils anderen einloggen.
  const minecraftFolderPath = require('minecraft-folder-path');
  const bedrockCacheFolder = path.join(minecraftFolderPath, 'nmp-cache', 'bedrock');

  const attempt = { ref: null }; // gehoert zu genau diesem Verbindungsversuch
  let bedrockHasSpawned = false; // merkt sich ob dieser Client schon erfolgreich gespawnt hat
  let spawnedAt = 0;
  let lastDisconnectMessage = ''; // Grund, den der Server beim Trennen genannt hat
  const packetCounters = { read: 0, dropped: 0 }; // Paketfilter (siehe installBedrockPacketFilter)
  let client;
  const clientOptions = {
    host: target.host,
    port: target.bedrockPort,
    username: xboxGamertag,
    profilesFolder: bedrockCacheFolder,
    offline: BEDROCK_TEST_OFFLINE, // nur fuer die eigenen Tests (sonst immer false)
    ...(MC_BEDROCK_VERSION ? { version: MC_BEDROCK_VERSION } : {}),
    ...(useNethernet
      ? {
        // NetherNet: Anmeldung per HTTP (nethernet-http.js), danach WebRTC ueber UDP
        transport: 'nethernet',
        nethernet: { networkId: BigInt(nnhttp.randomNetworkId()), signalling: 'http', webrtcBackend: useThread ? 'werift' : MC_BEDROCK_NETHERNET_WEBRTC },
        skipPing: true,
      }
      : { transport: 'raknet' }),
    // Standard ist nur 9s - bei manchen Verbindungsversuchen (z.B. kurze Netzwerk-
    // Aussetzer, Server-Last) reicht das nicht, dann kommt "Connect timed out"
    // bevor der eigentliche Login ueberhaupt beginnt.
    connectTimeout: 30000,
  };
  // Xbox-Auth per Device-Code (gleicher Ablauf wie Java - Link + Code)
  const onMsaCode = (data) => handleMsaCode(username, attempt, data, `${connLabel(username)} (Bedrock)`);
  const attachOptions = {
    host: target.host,
    port: target.bedrockPort,
    scheme: (route && route.scheme) || undefined,
    ipv6: MC_BEDROCK_NETHERNET_IPV6,
  };
  const onStep = (name, info = {}) => {
    const st = bots[username];
    if (st && st.bot === client && NN_STEP_LABELS[name]) st.nnStep = NN_STEP_LABELS[name];
    // Adressen fuer die Diagnose-Zeile merken (welche bieten wir an, welche der Server)
    if (st && st.bot === client && name === 'angebot') { st.nnOwn = info.candidates; st.nnServer = null; }
    if (st && st.bot === client && name === 'antwort') st.nnServer = info.offered || info.candidates;
    if (name === 'signalisierung-fehler') {
      // z.B. Server lehnt ab (401/403/503) oder ist ueber TCP nicht erreichbar
      bedrockServerUnreachable(username, client, `NetherNet-Anmeldung: ${info.error.message}`, 'nethernet');
    } else if (name === 'webrtc-getrennt' && !bedrockHasSpawned) {
      // kommt (dank prependListener in nethernet-http.js) VOR dem close des Clients an
      const m = String(info.reason || '').match(/connecterror:(\d+)/);
      const codeText = m && NN_ERROR_TEXT[m[1]] ? `${NN_ERROR_TEXT[m[1]]}, ` : '';
      const nextFail = (reconnectFailCount[username] || 0) + 1;
      if (st && st.bot === client && (nextFail <= 2 || nextFail % 10 === 0)) {
        console.warn(`[Diagnose] [${username}] NetherNet-Aufbau gescheitert (${info.reason || 'ohne Grund'}) - Verlauf: ${(info.events || []).join(', ') || 'keine Zustandswechsel'} - zuletzt ICE ${info.iceState || '-'}, WebRTC ${info.pcState || '-'}`);
        console.warn(`[Diagnose] [${username}] Adressen - Server bietet: ${formatNnCandidates(st.nnServer)} | wir bieten: ${formatNnCandidates(st.nnOwn)}`);
      }
      bedrockServerUnreachable(username, client, m
        ? `NetherNet-Verbindung (UDP) kam nicht zustande (${codeText}Code ${m[1]})`
        : `NetherNet-Verbindung vor dem Spawn abgebrochen (${info.reason || 'ohne Grund'}${st && st.nnStep ? `, zuletzt: ${st.nnStep}` : ''})`, 'nethernet');
    } else if (name === 'webrtc-getrennt') {
      // Abbruch einer laufenden Verbindung: festhalten, wer zuerst aufgegeben hat
      const mins = info.connectedForMs != null ? (info.connectedForMs / 60000).toFixed(1) : '?';
      const lastData = info.lastDataAgoS != null ? `letzte Daten vor ${info.lastDataAgoS}s` : 'nie Daten';
      const pk = packetCounters.dropped ? `, Pakete gelesen/verworfen ${packetCounters.read}/${packetCounters.dropped}` : '';
      console.warn(`[Diagnose] [${username}] NetherNet (${bots[username] && bots[username].webrtcBackend || '?'}) getrennt nach ${mins} min (${info.reason}), ${lastData}, ${info.msgs || 0} Nachrichten${pk}, Weg ${info.pair || '?'} - Verlauf: ${(info.events || []).join(', ') || 'keine Zustandswechsel'} - zuletzt ICE ${info.iceState}, WebRTC ${info.pcState}`);
    } else if (name === 'webrtc-verbunden') {
      if (bots[username]) {
        bots[username].webrtcBackend = info.backend;
        // Ueber welche Adressfamilie die Verbindung laeuft (IPv6-Adressen haben mehrere ':')
        if (info.pair) bots[username].nnFamily = /->\s*\S*:\S*:/.test(info.pair) ? 'IPv6' : 'IPv4';
      }
    } else if (name === 'zusatz-kandidat') {
      console.log(`[${username}] NetherNet: Server nennt seine oeffentliche Adresse nicht - nehme ${info.ip}:${info.port} dazu`);
    }
  };
  try {
    if (useThread) {
      // Eigener Thread fuer diesen Account (bedrock-worker.js) - der Stellvertreter verhaelt sich
      // wie ein bedrock-protocol-Client
      const cfg = {
        label: username,
        client: clientOptions,
        attach: attachOptions,
        viewDistance: MC_BEDROCK_VIEW_DISTANCE,
        keepPackets: MC_BEDROCK_PACKET_FILTER ? BEDROCK_KEEP_PACKETS : null,
        fastInflate: MC_BEDROCK_FAST_INFLATE,
      };
      if (typeof global.__afkBedrockCreated === 'function') global.__afkBedrockCreated(clientOptions); // Testhaken
      client = new BedrockThreadClient(cfg, {
        // Im Haupt-Thread einmal melden, ob der Filter fuer diese Version greift
        onInfo: (opts) => { if (MC_BEDROCK_PACKET_FILTER && opts.version) bedrockTuning.keepIds(opts.version, BEDROCK_KEEP_PACKETS); },
        onMsaCode,
        onStep,
        onStats: (d) => {
          packetCounters.read += d.read;
          packetCounters.dropped += d.dropped;
          bedrockPacketTotals.read += d.read;
          bedrockPacketTotals.dropped += d.dropped;
        },
        onSendError: (name, err) => {
          if (bots[username]?.bot === client) logChat(username, `--- Bedrock: ${name === 'command_request' ? 'Befehl' : 'Nachricht'} konnte nicht gesendet werden (${String(err.message).split('\n')[0].slice(0, 100)}) ---`);
        },
      });
    } else {
      client = bedrockProtocol.createClient({ ...clientOptions, onMsaCode });
      if (useNethernet) nnhttp.attach(client, { ...attachOptions, onStep });
    }
  } catch (e) {
    logChat(username, `--- Bedrock-Verbindungsfehler: ${e.message} ---`);
    if (bots[username]) bots[username].status = 'Fehler';
    broadcastAccountList();
    scheduleGroupedReconnect(username);
    return;
  }

  bots[username].bot = client;
  bots[username].packetCounters = packetCounters;
  attempt.ref = client;
  broadcastAccountList();

  // Kleine Sichtweite auch fuer Bedrock: bedrock-protocol liest diesen Wert erst ~500 ms
  // nach dem Verbindungsaufbau (Paket "request_chunk_radius"), das Setzen hier kommt also
  // rechtzeitig. Weniger Chunks = weniger zu entpackende Daten pro Account.
  client.viewDistance = MC_BEDROCK_VIEW_DISTANCE;

  // Nur die Pakete lesen, die der Bot wirklich braucht (spart den Grossteil der Rechenzeit).
  // Lesefehler einzelner Pakete faengt bedrock-protocol selbst ab und meldet sie als 'error'
  // (siehe isSkippablePacketError unten) - mit dem Filter kommen die meisten gar nicht mehr vor.
  installBedrockPacketFilter(client, packetCounters);

  let violationWarnings = 0;
  client.on('packet_violation_warning', (p) => {
    if (bots[username]?.bot !== client || ++violationWarnings > 3) return;
    let text;
    try { text = JSON.stringify(p); } catch (_) { text = String(p && p.reason); }
    console.warn(`[Diagnose] [${username}] Server meldet ein fehlerhaftes Paket von uns: ${text}`);
  });

  client.on('spawn', () => {
    if (bots[username]?.bot !== client) return;
    const state = bots[username];
    if (state.hasSpawnedThisConnection) return;
    state.hasSpawnedThisConnection = true;
    state.status = 'online';
    state.nnStep = null;
    state.lastFailure = null;
    spawnedAt = Date.now();
    markOnline(username);
    broadcastAccountList();
    logChat(username, `--- eingeloggt (Bedrock, ${useNethernet ? `NetherNet${state.nnFamily ? ` ueber ${state.nnFamily}` : ''}` : 'RakNet'}) ---`);
    reconnectFailCount[username] = 0; // Erfolg -> Backoff-Zaehler zuruecksetzen
    bedrockSpawnSucceeded(connServerId(username)); // eine evtl. laufende Bedrock-Pause (dieses Servers) ist damit vorbei
    io.emit('msa-code-clear', { username });
    msaLoginSucceeded(username);

    if (currentlyProcessing === username) {
      if (sequentialWatchdogTimer) { clearTimeout(sequentialWatchdogTimer); sequentialWatchdogTimer = null; }
      currentlyProcessing = null;
      setTimeout(() => advanceSequentialQueue(), SEQUENTIAL_STEP_DELAY_MS);
    }

    // Auto-Chat-Aktionen ausfuehren
    if (cs.everJoined && Array.isArray(cs.autoChat) && cs.autoChat.length > 0) {
      if (state.autoChatTimers) state.autoChatTimers.forEach(clearTimeout);
      state.autoChatTimers = cs.autoChat.map(({ text, delaySeconds }) =>
        setTimeout(() => {
          const s = bots[username];
          if (s && s.bot === client) {
            // Bedrock: Chat als 'text'-Paket, Befehle (/...) als 'command_request'
            try {
              sendBedrockMessage(client, text, xboxGamertag);
              logChat(username, `${text} (Auto-Chat Bedrock nach ${delaySeconds}s)`);
            } catch (e) {
              logChat(username, `--- Auto-Chat Fehler: ${e.message} ---`);
            }
          }
        }, (delaySeconds || 0) * 1000)
      );
    }

    if (!cs.everJoined) {
      cs.everJoined = true;
      saveConnSettings(username);
    }
    if (isDefaultConn(username)) reevaluateChatSource();
  });

  client.on('kick_disconnect', (packet) => {
    if (bots[username]?.bot !== client) return;
    const reason = packet.message || 'Unbekannt';
    logChat(username, `--- Bedrock gekickt: ${reason} ---`);
  });

  client.on('disconnect', (packet) => {
    if (bots[username]?.bot !== client) return;
    lastDisconnectMessage = String(packet.message || '').replace(/§./g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    logChat(username, `--- Bedrock getrennt: ${packet.message || ''} ---`);
  });

  let bedrockErrorTimes = []; // Zeitstempel echter Fehler (Gleitfenster)
  let bedrockErrorKillScheduled = false;
  let bedrockSkippedPackets = 0; // einzelne nicht lesbare Pakete (harmlos, werden nur uebersprungen)
  const BEDROCK_ERROR_WINDOW_MS = 60 * 1000;

  // Fehler beim Entschluesseln EINZELNER Pakete (neue Felder in neueren Bedrock-Versionen,
  // die die Bibliothek noch nicht kennt). Jedes Bedrock-Paket ist einzeln verpackt, ein
  // kaputtes Paket beschaedigt den restlichen Datenstrom nicht - es wird einfach verworfen.
  // Das darf weder gezaehlt noch zum Verbindungsabbruch fuehren.
  const isSkippablePacketError = (err) => {
    if (!err) return false;
    const msg = String(err.message || '');
    return (
      err.name === 'PartialReadError' ||
      msg.includes('Missing characters in string') ||
      /^(Read|Parse) error for /.test(msg)
    );
  };

  client.on('error', (err) => {
    if (bots[username]?.bot !== client) return;

    // Server antwortet gar nicht -> sofort sauber neu einreihen (siehe bedrockServerUnreachable)
    if (!bedrockHasSpawned && /(Ping|Connect) timed out/i.test(String(err.message || ''))) {
      bedrockServerUnreachable(username, client, err.message, useNethernet ? 'nethernet' : 'raknet');
      return;
    }
    // Fehler der NetherNet-Anmeldung kommen schon ueber onStep (siehe oben)
    if (err && /^NN_/.test(String(err.code || ''))) return;

    if (isSkippablePacketError(err)) {
      bedrockSkippedPackets++;
      // Nur einmal pro Verbindung in die Server-Konsole (nicht in den Chat/Discord)
      if (bedrockSkippedPackets === 1) {
        console.log(`[${username}] Bedrock: nicht lesbares Paket uebersprungen (${err.message}) - weitere werden still ignoriert`);
      }
      return;
    }

    // Echte Fehler: Gleitfenster der letzten 60 Sekunden zaehlen
    const now = Date.now();
    bedrockErrorTimes.push(now);
    bedrockErrorTimes = bedrockErrorTimes.filter((t) => now - t <= BEDROCK_ERROR_WINDOW_MS);
    const recentErrors = bedrockErrorTimes.length;

    // Ersten Fehler loggen, dann nur noch jeden 50. damit die Logs nicht vollgespamt werden
    if (recentErrors === 1 || recentErrors % 50 === 0) {
      logChat(username, `--- Bedrock Fehler: ${err.message} (${recentErrors}x in 60s) ---`);
    }

    // Schwellwert: Vor dem Spawn grosszuegiger (20), da beim Verbindungsaufbau manchmal
    // mehrere Fehler kommen. Nach dem Spawn erst bei 50 echten Fehlern innerhalb von
    // 60 Sekunden trennen (echter Absturz, kein einzelner Aussetzer).
    const threshold = bedrockHasSpawned ? 50 : 20;

    if (recentErrors >= threshold && !bedrockErrorKillScheduled) {
      bedrockErrorKillScheduled = true;
      setTimeout(() => {
        if (bots[username]?.bot === client) {
          logChat(username, `--- Bedrock: zu viele Fehler (${recentErrors}x in 60s), Verbindung wird getrennt ---`);
          forceKillBot(username);
        }
      }, 500);
    }
  });

  // Fehler-Zaehler nach erfolgreichem Spawn zuruecksetzen - der Account hat sich stabilisiert
  const origSpawnHandler = () => {
    bedrockHasSpawned = true;
    bedrockErrorTimes = [];
    bedrockErrorKillScheduled = false;
  };
  client.once('spawn', origSpawnHandler);

  client.on('close', () => {
    if (bots[username]?.bot !== client) return;
    const state = bots[username];
    const wasManualStop = state ? state.manualStop : false;
    markOffline(username);
    if (currentlyProcessing === username && sequentialWatchdogTimer) {
      clearTimeout(sequentialWatchdogTimer); sequentialWatchdogTimer = null;
    }
    if (state) {
      if (state.autoChatTimers) state.autoChatTimers.forEach(clearTimeout);
      state.autoChatTimers = [];
      if (state.msaTimer) { clearTimeout(state.msaTimer); state.msaTimer = null; }
      state.bot = null;
    }
    const accountStillExists = connectionExists(username);
    if (wasManualStop || !accountStillExists) {
      if (state) state.status = 'gestoppt';
      broadcastAccountList();
      if (currentlyProcessing === username) {
        currentlyProcessing = null;
        advanceSequentialQueue();
      }
      return;
    }
    // Vor dem Spawn abgebrochen (Anmeldung, UDP-Aufbau, Login): gemeinsamer Bedrock-Weg. Frueher
    // wartete hier die ganze Warteschlange 60 s auf genau diesen Account - Minute fuer Minute,
    // waehrend alle anderen Bedrock-Accounts offline blieben.
    if (!bedrockHasSpawned) {
      neutralizeLoginAttempt(username, client);
      const why = lastDisconnectMessage
        ? `vom Server getrennt: ${lastDisconnectMessage}`
        : `Verbindung vor dem Spawn beendet${state && state.nnStep ? `, zuletzt: ${state.nnStep}` : ''}`;
      bedrockRetryAfterFailure(username, why, useNethernet ? 'nethernet' : 'raknet');
      return;
    }
    if (currentlyProcessing === username) {
      currentlyProcessing = null;
      setTimeout(() => advanceSequentialQueue(), 1000);
    }

    // Nach dem Spawn: Bricht die Verbindung immer wieder nach kurzer Zeit ab, NICHT im
    // 30-Sekunden-Takt neu verbinden (das waren ueber Nacht Hunderte Logins pro Account und kann
    // dazu fuehren, dass der Server bzw. sein DDoS-Schutz unsere IP sperrt). Ab der 3. kurzen
    // Verbindung in Folge 5 Minuten Pause, ab der 5. 15 Minuten.
    const sessionMs = spawnedAt ? Date.now() - spawnedAt : 0;
    shortSessionCount[username] = sessionMs < SHORT_SESSION_MS ? (shortSessionCount[username] || 0) + 1 : 0;
    const shorts = shortSessionCount[username];
    const mins = (sessionMs / 60000).toFixed(1);
    const why = lastDisconnectMessage ? ` (${lastDisconnectMessage})` : '';
    reconnectFailCount[username] = (reconnectFailCount[username] || 0) + 1;
    let delay = getBackoffDelay(username);
    if (shorts >= 3) {
      const pauseMin = shorts >= 5 ? 15 : 5;
      delay = Math.max(delay, pauseMin * 60 * 1000);
      logChat(username, `--- Verbindung nach ${mins} min beendet${why} - zum ${shorts}. Mal in Folge nach weniger als ${SHORT_SESSION_MS / 60000} min, Pause ${pauseMin} min ---`);
      if (shorts === 3 || shorts === 5) {
        console.warn(`[Bedrock] ${username}: Verbindung haelt immer nur kurz (${shorts}x in Folge unter ${SHORT_SESSION_MS / 60000} min) - ${pauseMin} min Pause zwischen den Versuchen`);
      }
      if (state) state.status = `Bricht immer wieder ab – Pause bis ${clockTime(Date.now() + delay)}`;
    } else {
      const delaySec = Math.round(delay / 1000);
      logChat(username, `--- Verbindung nach ${mins} min beendet${why}, Reconnect in ${delaySec}s ---`);
      if (state) state.status = `Reconnect in ${delaySec}s...`;
    }
    broadcastAccountList();
    reconnectTimers[username] = setTimeout(() => {
      delete reconnectTimers[username];
      requestBotStart(username);
    }, delay);
  });
}

function stopBot(username) {
  if (reconnectTimers[username]) {
    clearTimeout(reconnectTimers[username]);
    delete reconnectTimers[username];
  }
  // Falls der Account gerade nur in der Warteschlange wartet oder aktiv dran ist
  pendingReconnectSet.delete(username);
  bpFor(username).waiting.delete(username);
  bedrockProbeEnded(username);
  shortSessionCount[username] = 0;
  // Ein offener Login-Code wird nicht mehr gebraucht. Zaehler/Pause gehoeren dem Account -
  // zurueckgesetzt wird nur, wenn keine andere Verbindung desselben Accounts noch dabei ist.
  const msaAccount = connUser(username);
  const hadCode = !!(bots[username] && bots[username].msaTimer);
  const siblingsBusy = connKeysOfAccount(msaAccount).some((k) => k !== username &&
    (pendingReconnectSet.has(k) || currentlyProcessing === k || (bots[k] && bots[k].bot && bots[k].status !== 'online')));
  if (!siblingsBusy) {
    msaCodeCount[msaAccount] = 0;
    msaPaused.delete(msaAccount);
  }
  if (bots[username]) bots[username].msaSkipped = false;
  updateMsaCodeMessage(username, 'stopped');
  io.emit('msa-code-clear', { username });
  if (currentlyProcessing === username) {
    if (sequentialWatchdogTimer) {
      clearTimeout(sequentialWatchdogTimer);
      sequentialWatchdogTimer = null;
    }
    currentlyProcessing = null;
    advanceSequentialQueue();
  }

  const state = bots[username];
  if (!state) return;
  state.manualStop = true;
  if (state.hideTimer) clearTimeout(state.hideTimer);
  if (state.autoChatTimers) state.autoChatTimers.forEach(clearTimeout);
  state.autoChatTimers = [];

  // forceKillBot versucht sauber zu trennen UND setzt state.bot in JEDEM Fall auf null,
  // damit der Account nie als "laeuft noch" haengen bleibt (auch wenn der Bot selbst
  // z.B. mitten in einem haengenden Microsoft-Login steckt und quit()/end() nichts bewirkt).
  if (state.msaTimer) { clearTimeout(state.msaTimer); state.msaTimer = null; }
  forceKillBot(username);
  state.status = 'gestoppt';
  broadcastAccountList();
  if (hadCode) wakeLoginSiblings(username);
}

// ---------- REST-API ----------
app.get('/api/accounts', (req, res) => {
  res.json(accountListForClient(req.user));
});

app.get('/api/chat-state', (req, res) => {
  pruneChatHistory();
  res.json({
    primary: getPrimaryUsername(),
    active: isPrimaryRunning(),
    servers: chatStatusAll(),
    history: chatHistory,
  });
});

// Erlaubte Zeichen in Account-Namen: Buchstaben, Ziffern, _ (Java) sowie fuer Bedrock ein
// fuehrender Punkt, Leerzeichen, # und -. Alles andere (z.B. < > " ') wird abgelehnt - solche
// Zeichen koennten im Dashboard als Code ausgefuehrt werden.
const ACCOUNT_NAME_RE = /^\.?[A-Za-z0-9_][A-Za-z0-9_ #-]{0,31}$/;
function accountNameProblem(name) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'Name fehlt';
  if (!ACCOUNT_NAME_RE.test(name.trim())) return 'Ungueltiger Name - erlaubt sind Buchstaben, Ziffern, _ (bei Bedrock ein Punkt davor, Leerzeichen, # und -), hoechstens 32 Zeichen';
  return null;
}

// ---------- Serverliste: API ----------
// Ansehen duerfen alle Angemeldeten (fuer die Anzeige), anlegen/aendern/loeschen nur Owner und Admin.
function serverDetail(sv) {
  return `${sv.host || '(keine Adresse)'} · Java ${sv.javaPort || '–'} · Bedrock ${sv.bedrockPort || '–'} · Kürzel ${sv.id}`;
}
function serverForClient(sv, viewer) {
  const out = {
    id: sv.id,
    name: sv.name,
    host: sv.host,
    javaPort: sv.javaPort,
    bedrockPort: sv.bedrockPort,
    isDefault: !!sv.isDefault,
  };
  if (viewer && viewer.role !== 'user') {
    out.autoChatTemplate = sv.autoChatTemplate || [];
    out.connections = sv.isDefault ? accounts.length : extraConnections.filter((c) => c.server === sv.id).length;
  }
  return out;
}
function auditServer(req, action, sv, detail) {
  auditWeb(req, action, `${sv.name} (${sv.id})`, detail);
}

app.get('/api/servers', (req, res) => {
  res.json({
    servers: servers.map((sv) => serverForClient(sv, req.user)),
    canManage: !!(req.user && req.user.role !== 'user'),
    limits: { maxServers: MAX_EXTRA_SERVERS, maxTemplate: AUTOCHAT_TEMPLATE_MAX, maxText: AUTOCHAT_TEXT_MAX },
    multiServer: { java: MULTI_SERVER_JAVA, bedrock: MULTI_SERVER_BEDROCK, bedrockMax: MULTI_SERVER_BEDROCK_MAX },
  });
});

app.post('/api/servers', requireManageRights, (req, res) => {
  if (servers.filter((sv) => !sv.isDefault).length >= MAX_EXTRA_SERVERS) {
    return res.status(400).json({ error: `Höchstens ${MAX_EXTRA_SERVERS} weitere Server` });
  }
  const r = validateServerInput(req.body, { others: servers });
  if (r.error) return res.status(400).json({ error: r.error });
  servers.push(r.value);
  saveServers();
  auditServer(req, 'Server angelegt', r.value, serverDetail(r.value));
  io.emit('servers-changed');
  securityNotice(`🌐 Server **${r.value.name}** (${r.value.host}) wurde im Dashboard von **${req.user.username}** angelegt`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true, server: serverForClient(r.value, req.user) });
});

app.put('/api/servers/:id', requireManageRights, (req, res) => {
  const sv = getServer(String(req.params.id));
  if (!sv) return res.status(404).json({ error: 'Server nicht gefunden' });
  if (sv.isDefault) {
    return res.status(400).json({ error: 'Der Standardserver kommt aus der .env (MC_SERVER_HOST, MC_SERVER_PORT, MC_BEDROCK_PORT) und lässt sich hier nicht ändern.' });
  }
  const r = validateServerInput(req.body, { others: servers.filter((o) => o !== sv), existing: sv });
  if (r.error) return res.status(400).json({ error: r.error });
  // Ports, die bestehende Verbindungen brauchen, duerfen nicht verschwinden
  const here = extraConnections.filter((c) => c.server === sv.id);
  if (!r.value.javaPort && here.some((c) => !isBedrockAccount(c.username))) {
    return res.status(400).json({ error: 'Auf diesem Server gibt es Java-Verbindungen - der Java-Port wird gebraucht' });
  }
  if (!r.value.bedrockPort && here.some((c) => isBedrockAccount(c.username))) {
    return res.status(400).json({ error: 'Auf diesem Server gibt es Bedrock-Verbindungen - der Bedrock-Port wird gebraucht' });
  }
  const before = { name: sv.name, detail: serverDetail(sv) };
  sv.name = r.value.name;
  sv.host = r.value.host;
  sv.javaPort = r.value.javaPort;
  sv.bedrockPort = r.value.bedrockPort;
  const after = serverDetail(sv);
  if (before.name === sv.name && before.detail === after) return res.json({ ok: true, server: serverForClient(sv, req.user) });
  saveServers();
  broadcastAccountList();
  io.emit('servers-changed');
  auditServer(req, 'Server geändert', sv, `${before.name !== sv.name ? `Name "${before.name}" → "${sv.name}"; ` : ''}${before.detail} → ${after}`);
  res.json({ ok: true, server: serverForClient(sv, req.user) });
});

app.delete('/api/servers/:id', requireManageRights, (req, res) => {
  const sv = getServer(String(req.params.id));
  if (!sv) return res.status(404).json({ error: 'Server nicht gefunden' });
  if (sv.isDefault) return res.status(400).json({ error: 'Der Standardserver lässt sich nicht löschen.' });
  const n = extraConnections.filter((c) => c.server === sv.id).length;
  if (n > 0) {
    return res.status(400).json({ error: `Auf diesem Server gibt es noch ${n} Verbindung(en). Bitte zuerst die Verbindungen entfernen.` });
  }
  servers = servers.filter((o) => o !== sv);
  saveServers();
  auditServer(req, 'Server gelöscht', sv, serverDetail(sv));
  io.emit('servers-changed');
  securityNotice(`🗑️ Server **${sv.name}** (${sv.host}) wurde im Dashboard von **${req.user.username}** gelöscht`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true });
});

// Auto-Chat-Vorlage: Startwert fuer neue Accounts (Standardserver) bzw. neue Verbindungen
app.post('/api/servers/:id/autochat', requireManageRights, (req, res) => {
  const sv = getServer(String(req.params.id));
  if (!sv) return res.status(404).json({ error: 'Server nicht gefunden' });
  const r = cleanAutoChatEntry(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  if (!Array.isArray(sv.autoChatTemplate)) sv.autoChatTemplate = [];
  if (sv.autoChatTemplate.length >= AUTOCHAT_TEMPLATE_MAX) {
    return res.status(400).json({ error: `Höchstens ${AUTOCHAT_TEMPLATE_MAX} Einträge pro Vorlage` });
  }
  sv.autoChatTemplate.push(r.value);
  saveServers();
  auditServer(req, 'Auto-Chat-Vorlage ergänzt', sv, `"${r.value.text}" nach ${r.value.delaySeconds}s`);
  res.json({ ok: true, autoChatTemplate: sv.autoChatTemplate });
});

app.delete('/api/servers/:id/autochat/:index', requireManageRights, (req, res) => {
  const sv = getServer(String(req.params.id));
  if (!sv) return res.status(404).json({ error: 'Server nicht gefunden' });
  const list = Array.isArray(sv.autoChatTemplate) ? sv.autoChatTemplate : [];
  const idx = /^\d+$/.test(String(req.params.index)) ? parseInt(req.params.index, 10) : -1;
  if (idx < 0 || idx >= list.length) return res.status(400).json({ error: 'Ungültiger Eintrag' });
  const removed = list.splice(idx, 1)[0];
  saveServers();
  auditServer(req, 'Auto-Chat-Vorlage: Eintrag entfernt', sv, `"${removed.text}"`);
  res.json({ ok: true, autoChatTemplate: list });
});

app.post('/api/accounts', requireManageRights, (req, res) => {
  const { username: rawUsername } = req.body || {};
  const nameProblem = accountNameProblem(rawUsername);
  if (nameProblem) {
    return res.status(400).json({ error: nameProblem });
  }
  const username = rawUsername.trim();
  if (accounts.find((a) => a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Account existiert bereits' });
  }
  const isFirstAccount = accounts.length === 0;
  accounts.push({
    username,
    authType: 'premium',
    everJoined: false,
    preferredChatSource: isFirstAccount,
    authCacheId: username,
    notifyElsewhere: false, // Glocke bei neuen Accounts aus - im Dashboard einschaltbar
    autoChat: templateFor(DEFAULT_SERVER_ID),
  });
  if (isFirstAccount) currentChatSourceUsername = username;
  saveAccounts();
  broadcastAccountList();
  auditWeb(req, 'Account angelegt', username);
  securityNotice(`➕ Account **${username}** wurde im Dashboard von **${req.user.username}** angelegt`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true });
});

function renameAccount(oldUsername, newUsername) {
  const acc = accounts.find((a) => a.username === oldUsername);
  if (!acc) return false;

  // Alle Verbindungen dieses Accounts (Standardserver + weitere) ziehen auf den neuen Namen um
  const moves = connKeysOfAccount(oldUsername).map((k) => [k, connKey(newUsername, connServerId(k))]);
  acc.username = newUsername;
  extraConnections.forEach((c) => { if (c.username === oldUsername) c.username = newUsername; });
  for (const [oldKey, newKey] of moves) moveConnKey(oldKey, newKey);
  if (moves.length > 1) saveExtraConnections();

  // Nutzer-Berechtigungen (allowedAccounts) mit dem neuen Namen aktualisieren
  let usersChanged = false;
  users.forEach((u) => {
    const idx = u.allowedAccounts.indexOf(oldUsername);
    if (idx !== -1) {
      u.allowedAccounts[idx] = newUsername;
      usersChanged = true;
    }
  });
  if (usersChanged) saveUsers();

  saveAccounts();
  broadcastAccountList();
  logChat(newUsername, `--- Account umbenannt von ${oldUsername} zu ${newUsername} ---`);
  return true;
}

// Alle Stellen, die einen Verbindungs-Schluessel benutzen, auf einen neuen Schluessel umziehen
function moveConnKey(oldKey, newKey) {
  for (const map of [bots, accountStats, reconnectTimers, reconnectFailCount, shortSessionCount, kickNotifyThrottle,
    startSources, msaCodeCount, msaCodeMessages, msaDiscordQueue]) {
    if (Object.prototype.hasOwnProperty.call(map, oldKey)) {
      map[newKey] = map[oldKey];
      delete map[oldKey];
    }
  }
  const bp = bpFor(oldKey);
  for (const set of [pendingReconnectSet, msaPaused, bp.waiting]) {
    if (set.has(oldKey)) { set.delete(oldKey); set.add(newKey); }
  }
  if (currentlyProcessing === oldKey) currentlyProcessing = newKey;
  if (bp.probe === oldKey) bp.probe = newKey;
  if (currentChatSourceUsername === oldKey) currentChatSourceUsername = newKey;
  chatHistory.forEach((m) => {
    if (m.username === oldKey) m.username = newKey;
  });
}

function makeAccountPrimary(username) {
  const acc = accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
  if (!acc) return false;
  // Das ist jetzt der Account, den der Nutzer dauerhaft als Chat-Quelle haben will.
  // Wichtig: die Liste selbst wird NICHT umsortiert, nur diese eine Markierung + die
  // aktuelle Chat-Quelle geaendert - so bleibt die Reihenfolge aller anderen Accounts stabil.
  accounts.forEach((a) => (a.preferredChatSource = a.username === acc.username));
  currentChatSourceUsername = acc.username;
  saveAccounts();
  broadcastAccountList();
  return true;
}

// Sucht unter allen Accounts (ausser dem angegebenen) den am besten geeigneten als
// voruebergehende Chat-Quelle: am liebsten einen, der gerade wirklich online ist, sonst
// wenigstens einen, der aktiv versucht sich zu verbinden.
function pickBestAvailableUsername(excludeUsername) {
  const candidates = accounts.filter((a) => a.username !== excludeUsername);
  let found = candidates.find((a) => bots[a.username] && bots[a.username].status === 'online');
  if (found) return found.username;
  found = candidates.find((a) => bots[a.username] && bots[a.username].status !== 'gestoppt');
  return found ? found.username : null;
}

// Wird aufgerufen, wenn die aktuelle Chat-Quelle woanders eingeloggt wurde (Duplicate-Login).
// Wechselt NUR die Chat-Quelle auf einen anderen verfuegbaren Account - die
// preferredChatSource-Markierung UND die Listenreihenfolge bleiben unangetastet, damit
// spaeter automatisch sauber zurueckgewechselt werden kann, ohne andere Accounts zu vertauschen.
function temporarilyDemotePrimary(username) {
  if (getPrimaryUsername() !== username) return; // nur relevant, wenn es GERADE die aktive Chat-Quelle ist
  const nextUsername = pickBestAvailableUsername(username);
  if (!nextUsername) return; // niemand verfuegbar, zu dem gewechselt werden koennte

  currentChatSourceUsername = nextUsername;
  broadcastAccountList();
  logChat(nextUsername, `--- Chat-Quelle automatisch auf ${nextUsername} gewechselt (${username} ist woanders eingeloggt) ---`);
}

// Wird nach jedem Login geprueft: Ist der eigentlich bevorzugte Account nicht online, soll
// als Chat-Quelle immer der am weitesten OBEN in der Liste stehende, gerade online verfuegbare
// Account gelten - nicht einfach nur derjenige, der zufaellig zuerst online kam. So wird die
// Chat-Quelle laufend "nach oben korrigiert", sobald ein hoeher stehender Account zurueckkommt.
function reevaluateChatSource() {
  const preferredAcc = accounts.find((a) => a.preferredChatSource);
  if (preferredAcc && bots[preferredAcc.username] && bots[preferredAcc.username].status === 'online') {
    return; // der bevorzugte Account ist online - das wird schon separat gehandhabt
  }

  const bestOnline = accounts.find((a) => bots[a.username] && bots[a.username].status === 'online');
  if (bestOnline && bestOnline.username !== getPrimaryUsername()) {
    currentChatSourceUsername = bestOnline.username;
    broadcastAccountList();
    logChat(bestOnline.username, `--- Chat-Quelle automatisch auf ${bestOnline.username} aktualisiert (weiter oben in der Liste, jetzt verfuegbar) ---`);
  }
}

app.post('/api/accounts/:username/make-primary', requireManageRights, (req, res) => {
  const key = req.params.username;
  if (!isDefaultConn(key)) {
    // Weiterer Server: Stern nur unter den Verbindungen dieses Servers
    if (!connectionExists(key)) return res.status(404).json({ error: 'Verbindung nicht gefunden' });
    if (isBedrockAccount(connUser(key))) return res.status(400).json({ error: 'Bedrock-Accounts können keine Chat-Quelle sein' });
    const sid = connServerId(key);
    extraConnections.forEach((c) => {
      if (c.server === sid) c.preferredChatSource = c.username === connUser(key);
    });
    saveExtraConnections();
    broadcastAccountList();
    auditWeb(req, 'Chat-Quelle festgelegt', key);
    return res.json({ ok: true });
  }
  const ok = makeAccountPrimary(req.params.username);
  if (!ok) return res.status(404).json({ error: 'Account nicht gefunden' });
  auditWeb(req, 'Chat-Quelle festgelegt', req.params.username);
  res.json({ ok: true });
});

app.post('/api/accounts/:username/notify-elsewhere', requireManageRights, (req, res) => {
  const acc = connectionExists(req.params.username) ? connSettings(req.params.username) : null;
  if (!acc) return res.status(404).json({ error: 'Account nicht gefunden' });
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled muss true oder false sein' });
  }
  acc.notifyElsewhere = enabled;
  saveConnSettings(req.params.username);
  broadcastAccountList();
  auditWeb(req, 'Glocke "anderswo eingeloggt"', req.params.username, enabled ? 'an' : 'aus');
  res.json({ ok: true, notifyElsewhere: acc.notifyElsewhere });
});

app.get('/api/accounts/:username/autochat', requireManageRights, (req, res) => {
  const acc = connectionExists(req.params.username) ? connSettings(req.params.username) : null;
  if (!acc) return res.status(404).json({ error: 'Account nicht gefunden' });
  res.json({ autoChat: acc.autoChat || [] });
});

app.post('/api/accounts/:username/autochat', requireManageRights, (req, res) => {
  const acc = connectionExists(req.params.username) ? connSettings(req.params.username) : null;
  if (!acc) return res.status(404).json({ error: 'Account nicht gefunden' });
  const { text, delaySeconds } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text fehlt' });
  }
  const delay = parseInt(delaySeconds, 10);
  if (isNaN(delay) || delay < 0) {
    return res.status(400).json({ error: 'delaySeconds muss eine positive Zahl sein' });
  }
  if (!Array.isArray(acc.autoChat)) acc.autoChat = [];
  if (!isDefaultConn(req.params.username) && text.trim().length > AUTOCHAT_TEXT_MAX) {
    return res.status(400).json({ error: `Text zu lang (max. ${AUTOCHAT_TEXT_MAX} Zeichen)` });
  }
  acc.autoChat.push({ text: text.trim(), delaySeconds: delay });
  saveConnSettings(req.params.username);
  auditWeb(req, 'Auto-Chat hinzugefügt', req.params.username, `"${text.trim()}" nach ${delay}s`);
  res.json({ ok: true, autoChat: acc.autoChat });
});

app.delete('/api/accounts/:username/autochat/:index', requireManageRights, (req, res) => {
  const acc = connectionExists(req.params.username) ? connSettings(req.params.username) : null;
  if (!acc) return res.status(404).json({ error: 'Account nicht gefunden' });
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || !acc.autoChat || idx < 0 || idx >= acc.autoChat.length) {
    return res.status(400).json({ error: 'Ungueltiger Index' });
  }
  const removed = acc.autoChat.splice(idx, 1)[0];
  saveConnSettings(req.params.username);
  auditWeb(req, 'Auto-Chat entfernt', req.params.username, removed ? `"${removed.text}"` : '');
  res.json({ ok: true, autoChat: acc.autoChat });
});

// ---------- Verbindungen zu weiteren Servern (nur Owner/Admin) ----------
// Warum kann dieser Account (noch) nicht auf diesen Server? (null = geht)
function addConnectionProblem(username, serverId) {
  const acc = accounts.find((a) => a.username === username);
  if (!acc) return { status: 404, error: 'Account nicht gefunden' };
  const sv = typeof serverId === 'string' ? getServer(serverId) : null;
  if (!sv) return { status: 404, error: 'Server nicht gefunden' };
  if (sv.isDefault) return { status: 400, error: 'Auf dem Standardserver ist jeder Account sowieso' };
  if (extraConnections.some((c) => c.username === username && c.server === sv.id)) {
    return { status: 400, error: 'Der Account ist schon auf diesem Server' };
  }
  const bedrock = isBedrockAccount(username);
  if (bedrock && !sv.bedrockPort) return { status: 400, error: 'Dieser Server hat keinen Bedrock-Port' };
  if (!bedrock && !sv.javaPort) return { status: 400, error: 'Dieser Server hat keinen Java-Port' };
  if (!bedrock && !MULTI_SERVER_JAVA) {
    return { status: 400, error: 'Java auf weiteren Servern ist ausgeschaltet (MULTI_SERVER_JAVA in der .env)' };
  }
  if (bedrock && !MULTI_SERVER_BEDROCK) {
    return { status: 400, error: 'Bedrock auf weiteren Servern ist ausgeschaltet (MULTI_SERVER_BEDROCK=1 in der .env, siehe Anleitung)' };
  }
  if (bedrock && extraConnections.filter((c) => isBedrockAccount(c.username)).length >= MULTI_SERVER_BEDROCK_MAX) {
    return { status: 400, error: `Höchstens ${MULTI_SERVER_BEDROCK_MAX} Bedrock-Verbindungen zu weiteren Servern (MULTI_SERVER_BEDROCK_MAX)` };
  }
  return null;
}

// Neue Verbindung anlegen (Startwerte: Vorlage des Servers, Glocke wie beim Account)
function addConnection(username, serverId) {
  const acc = accounts.find((a) => a.username === username);
  const entry = {
    username,
    server: serverId,
    everJoined: false, // erster Join auf DIESEM Server: noch kein Auto-Chat
    preferredChatSource: false,
    autoChat: templateFor(serverId),
    notifyElsewhere: acc ? acc.notifyElsewhere !== false : false,
  };
  extraConnections.push(entry);
  saveExtraConnections();
  const key = connKey(username, serverId);
  if (!bots[key]) {
    bots[key] = { bot: null, status: 'gestoppt', hideTimer: null, autoChatTimers: [], manualStop: true, hasSpawnedThisConnection: false };
  }
  return key;
}

// Verbindung entfernen: stoppen, Zustaende und Eintrag loeschen
function removeConnection(username, serverId) {
  const key = connKey(username, serverId);
  stopBot(key);
  extraConnections = extraConnections.filter((c) => !(c.username === username && c.server === serverId));
  saveExtraConnections();
  delete accountStats[key];
  delete bots[key];
  delete reconnectFailCount[key];
  delete shortSessionCount[key];
  delete kickNotifyThrottle[key];
  delete startSources[key];
  return key;
}

app.post('/api/accounts/:username/connections', requireManageRights, (req, res) => {
  const { username } = req.params;
  const serverId = req.body && typeof req.body.server === 'string' ? req.body.server.trim() : '';
  const problem = addConnectionProblem(username, serverId);
  if (problem) return res.status(problem.status).json({ error: problem.error });
  const key = addConnection(username, serverId);
  const sv = getServer(serverId);
  auditWeb(req, 'Verbindung angelegt', key, `${sv.name} (${sv.host})`);
  const start = !(req.body && req.body.start === false);
  if (start) {
    requestBotStart(key, { manual: true, source: `über das Dashboard (${req.user ? req.user.username : '?'})` });
  }
  broadcastAccountList();
  res.json({ ok: true, key, started: start });
});

app.delete('/api/accounts/:username/connections/:server', requireManageRights, (req, res) => {
  const { username, server } = req.params;
  if (!extraConnections.some((c) => c.username === username && c.server === server)) {
    return res.status(404).json({ error: 'Verbindung nicht gefunden' });
  }
  const key = removeConnection(username, server);
  const sv = getServer(server);
  auditWeb(req, 'Verbindung entfernt', key, sv ? `${sv.name} (${sv.host})` : '');
  broadcastAccountList();
  res.json({ ok: true });
});

app.post('/api/accounts/:username/rename', requireManageRights, (req, res) => {
  const { username } = req.params;
  const { newUsername } = req.body || {};

  if (!newUsername || typeof newUsername !== 'string' || !newUsername.trim()) {
    return res.status(400).json({ error: 'Neuer Name fehlt' });
  }
  const renameProblem = accountNameProblem(newUsername);
  if (renameProblem) return res.status(400).json({ error: renameProblem });
  const trimmedNew = newUsername.trim();

  const acc = accounts.find((a) => a.username === username);
  if (!acc) return res.status(404).json({ error: 'Account nicht gefunden' });

  if (accounts.some((a) => a.username.toLowerCase() === trimmedNew.toLowerCase() && a.username !== username)) {
    return res.status(400).json({ error: 'Ein Account mit diesem Namen existiert schon' });
  }
  if (accountConnected(username)) {
    return res.status(400).json({ error: 'Bitte den Account zuerst stoppen (auf allen Servern), bevor er umbenannt wird' });
  }

  renameAccount(username, trimmedNew);
  auditWeb(req, 'Account umbenannt', username, `neuer Name: ${trimmedNew}`);
  securityNotice(`✏️ Account **${username}** wurde im Dashboard von **${req.user.username}** in **${trimmedNew}** umbenannt`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  res.json({ ok: true });
});

app.delete('/api/accounts/:username', requireManageRights, (req, res) => {
  const { username } = req.params;
  const acc = accounts.find((a) => a.username === username);
  if (acc) {
    auditWeb(req, 'Account gelöscht', username);
    securityNotice(`🗑️ Account **${username}** wurde im Dashboard von **${req.user.username}** gelöscht`, loginClientIp(req), audit.deviceFromUA(req.headers['user-agent']));
  }
  const keys = acc ? connKeysOfAccount(username) : [username];
  keys.forEach((k) => stopBot(k));
  if (acc) {
    if (isBedrockAccount(username)) {
      deleteBedrockCacheFiles(username);
    } else {
      deleteAuthCacheFiles(acc.authCacheId);
    }
  }
  accounts = accounts.filter((a) => a.username !== username);
  keys.forEach((k) => delete accountStats[k]);
  if (extraConnections.some((c) => c.username === username)) {
    extraConnections = extraConnections.filter((c) => c.username !== username);
    saveExtraConnections();
  }
  // Falls die geloeschte Chat-Quelle war, braucht jetzt jemand anderes die Markierung
  if (accounts.length > 0 && !accounts.some((a) => a.preferredChatSource)) {
    accounts[0].preferredChatSource = true;
  }
  // Falls der geloeschte Account gerade die aktive Chat-Quelle war, auf einen anderen wechseln
  if (currentChatSourceUsername === username) {
    currentChatSourceUsername = accounts.length > 0 ? accounts[0].username : null;
  }

  // Referenz aus allen Nutzer-Berechtigungen entfernen
  let usersChanged = false;
  users.forEach((u) => {
    const idx = u.allowedAccounts.indexOf(username);
    if (idx !== -1) {
      u.allowedAccounts.splice(idx, 1);
      usersChanged = true;
    }
  });
  if (usersChanged) saveUsers();

  saveAccounts();
  broadcastAccountList();
  res.json({ ok: true });
});

app.get('/api/players/:username', requireAccountAccess, (req, res) => {
  const state = bots[req.params.username];
  if (!state || !state.bot) return res.json({ players: [] });
  const players = Object.keys(state.bot.players || {}).filter((p) => p !== req.params.username);
  res.json({ players });
});

// ---------- Ingame-Steuerung ----------
const VALID_MOVE_DIRECTIONS = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];

app.post('/api/control/:username/move', requireAccountAccess, (req, res) => {
  const { username } = req.params;
  const { direction, state: pressed } = req.body || {};
  if (!VALID_MOVE_DIRECTIONS.includes(direction)) {
    return res.status(400).json({ error: 'Ungueltige Richtung' });
  }
  const botState = bots[username];
  if (!botState || !botState.bot) {
    return res.status(400).json({ error: 'Account ist nicht online' });
  }
  try {
    botState.bot.setControlState(direction, !!pressed);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/control/:username/hotbar', requireAccountAccess, (req, res) => {
  const { username } = req.params;
  const botState = bots[username];
  if (!botState || !botState.bot) {
    return res.status(400).json({ error: 'Account ist nicht online' });
  }
  const slot = parseInt((req.body || {}).slot, 10);
  if (Number.isNaN(slot) || slot < 0 || slot > 8) {
    return res.status(400).json({ error: 'Ungueltiger Hotbar-Slot' });
  }
  try {
    botState.bot.setQuickBarSlot(slot);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/control/:username/drop', requireAccountAccess, (req, res) => {
  const { username } = req.params;
  const { all } = req.body || {};
  const botState = bots[username];
  if (!botState || !botState.bot) {
    return res.status(400).json({ error: 'Account ist nicht online' });
  }
  const bot = botState.bot;
  const heldItem = bot.heldItem;
  if (!heldItem) {
    return res.status(400).json({ error: 'Kein Item in der Hand' });
  }
  const cb = (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  };
  if (all) {
    bot.tossStack(heldItem, cb);
  } else {
    bot.toss(heldItem.type, heldItem.metadata, 1, cb);
  }
});

const MOUNTABLE_ANIMAL_NAMES = ['horse', 'donkey', 'mule', 'pig', 'strider', 'llama', 'camel'];

// Boote gibt es in neueren Minecraft-Versionen als EIGENE Entity pro Holzart
// (z.B. "oak_boat", "birch_boat" statt einfach "boat") - deshalb hier nicht auf einen
// festen Namen verlassen, sondern generisch auf "boat"/"raft"/"minecart" im Namen pruefen,
// plus zusaetzlich auf die von minecraft-data vergebene Kategorie "Vehicles".
function isMountableEntity(e) {
  if (!e || !e.name) return false;
  if (e.kind === 'Vehicles') return true;
  const n = e.name.toLowerCase();
  if (n.includes('boat') || n.includes('raft') || n.includes('minecart') || n.includes('bamboo')) return true;
  return MOUNTABLE_ANIMAL_NAMES.includes(n);
}

app.post('/api/control/:username/rightclick', requireAccountAccess, (req, res) => {
  const { username } = req.params;
  const botState = bots[username];
  if (!botState || !botState.bot) {
    return res.status(400).json({ error: 'Account ist nicht online' });
  }
  const bot = botState.bot;
  try {
    // Erst pruefen: steht in der Naehe ein Boot/eine Lore/ein reitbares Tier? Da es keine
    // Blickrichtungs-Steuerung gibt (also kein "worauf schaue ich gerade"), wird stattdessen
    // automatisch das naechste einsteigbare Fahrzeug im Umkreis gesucht und benutzt.
    let nearestVehicle = null;
    let nearestDist = Infinity;
    const nearbyForDebug = [];
    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (!e || !e.name || e === bot.entity) continue;
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist <= 6) nearbyForDebug.push(`${e.name} (kind=${e.kind}, dist=${dist.toFixed(1)})`);
      if (!isMountableEntity(e)) continue;
      if (dist <= 4 && dist < nearestDist) {
        nearestVehicle = e;
        nearestDist = dist;
      }
    }

    if (nearestVehicle) {
      bot.mount(nearestVehicle);
    } else {
      console.log(`[${username}] Rechtsklick: kein einsteigbares Fahrzeug in Reichweite gefunden. In der Naehe: ${nearbyForDebug.join(', ') || '(nichts)'}`);
      bot.activateItem();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/control/:username/leftclick', requireAccountAccess, (req, res) => {
  const { username } = req.params;
  const botState = bots[username];
  if (!botState || !botState.bot) {
    return res.status(400).json({ error: 'Account ist nicht online' });
  }
  const bot = botState.bot;
  try {
    // Wie beim Rechtsklick: da es keine Blickrichtungs-Steuerung gibt, wird automatisch das
    // naechste angreifbare Lebewesen (Mob/Spieler) in Nahkampf-Reichweite gesucht und attackiert.
    let nearestEntity = null;
    let nearestDist = Infinity;
    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      if (e.type !== 'mob' && e.type !== 'player') continue;
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist <= 4 && dist < nearestDist) {
        nearestEntity = e;
        nearestDist = dist;
      }
    }

    if (nearestEntity) {
      bot.attack(nearestEntity);
      res.json({ ok: true, target: nearestEntity.username || nearestEntity.name || 'entity' });
    } else {
      res.json({ ok: true, target: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/control/:username/dismount', requireAccountAccess, (req, res) => {
  const { username } = req.params;
  const botState = bots[username];
  if (!botState || !botState.bot) {
    return res.status(400).json({ error: 'Account ist nicht online' });
  }
  try {
    if (botState.bot.vehicle) {
      botState.bot.dismount();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tabcomplete', async (req, res) => {
  const { username, text } = req.body || {};
  if (!canAccessAccount(req.user, username)) {
    return res.status(403).json({ error: 'Kein Zugriff auf diesen Account.' });
  }
  const state = bots[username];
  if (!state || !state.bot) return res.json({ matches: [] });
  try {
    const assumeCommand = (text || '').startsWith('/');
    const bot = state.bot;
    // bot.tabComplete gibt nur packet.matches zurueck; wir greifen selbst auf den
    // rohen Server-Response zu, um auch start/length (Ersetzungsbereich) zu bekommen.
    let start;
    let length;
    let matches = [];
    try {
      bot._client.write('tab_complete', { text, assumeCommand, lookedAtBlock: undefined });
      const [packet] = await new Promise((resolve, reject) => {
        // Der Listener MUSS bei Zeitueberschreitung wieder entfernt werden - sonst sammeln
        // sich bei jeder unbeantworteten Anfrage Listener an ("MaxListenersExceededWarning:
        // 11 tab_complete listeners") und spaetere Antworten landen bei alten Anfragen.
        const onTabComplete = (p) => {
          clearTimeout(timer);
          resolve([p]);
        };
        const timer = setTimeout(() => {
          bot._client.removeListener('tab_complete', onTabComplete);
          reject(new Error('timeout'));
        }, 3000);
        bot._client.once('tab_complete', onTabComplete);
      });
      start = packet.start;
      length = packet.length;
      matches = (packet.matches || []).map((m) => (typeof m === 'string' ? m : m.match));
    } catch (inner) {
      matches = [];
    }
    res.json({ matches, start, length });
  } catch (e) {
    res.json({ matches: [] });
  }
});

app.post('/api/start-all', (req, res) => {
  // Ueber die Warteschlange starten lassen, statt alle gleichzeitig - verhindert
  // gleichzeitige Microsoft-Logins und damit 429-Fehler. Fuer eingeschraenkte
  // User-Rollen wird automatisch nur auf ihre erlaubten Accounts begrenzt.
  allConnKeys()
    .filter((key) => canAccessAccount(req.user, key))
    .forEach((key) => requestBotStart(key, { manual: true, source: `über „Alle starten“ im Dashboard (${req.user ? req.user.username : '?'})` }));
  auditWeb(req, 'Alle gestartet');
  res.json({ ok: true });
});

app.post('/api/stop-all', (req, res) => {
  allConnKeys()
    .filter((key) => canAccessAccount(req.user, key))
    .forEach((key) => stopBot(key));
  auditWeb(req, 'Alle gestoppt');
  res.json({ ok: true });
});

app.post('/api/start/:username', requireAccountAccess, (req, res) => {
  requestBotStart(req.params.username, { manual: true, source: `über das Dashboard (${req.user ? req.user.username : '?'})` });
  auditWeb(req, 'Gestartet', req.params.username);
  res.json({ ok: true });
});

app.post('/api/stop/:username', requireAccountAccess, (req, res) => {
  stopBot(req.params.username);
  auditWeb(req, 'Gestoppt', req.params.username);
  res.json({ ok: true });
});

app.post('/api/chat', (req, res) => {
  const { username, message } = req.body || {};
  if (!canAccessAccount(req.user, username)) {
    return res.status(403).json({ error: 'Kein Zugriff auf diesen Account.' });
  }
  const state = bots[username];
  if (!state || !state.bot) {
    return res.status(400).json({ error: 'Bot laeuft nicht' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message fehlt' });
  }
  const result = sendChatMessage(username, message);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  logChat(username, `(gesendet) ${message}`);
  auditWeb(req, message.trim().startsWith('/') ? 'Befehl gesendet' : 'Chat gesendet', username, `"${message}"`);
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.emit('accounts', accountListForClient(socket.user));
  pruneChatHistory();
  socket.emit('chat-state', {
    primary: getPrimaryUsername(),
    active: isPrimaryRunning(),
    servers: chatStatusAll(),
    history: chatHistory,
  });
});

// ---------- Schnittstelle fuer eigene Erweiterungen (Ordner "erweiterungen") ----------
// Weitere Kanaele, in denen !-Befehle gelten (von Erweiterungen freigegeben)
const extraCommandChannels = new Set();

function isAccountOnline(username) {
  const s = bots[username];
  return !!(s && s.bot && s.status === 'online');
}

// Was jede Erweiterung bekommt. Die Discord-Teile setzt der Discord-Block unten dazu
// (ohne eingerichteten Bot bleibt discordClient null).
const extApi = {
  app,
  requireOwner,
  requireAdmin,
  auditWeb,
  onChat: (fn) => { if (typeof fn === 'function') chatListeners.push(fn); },
  addAdminScript: (code) => { extAdminScripts.push(String(code)); },
  // Optionaler dritter/zweiter Parameter: Kuerzel eines weiteren Servers (ohne = Standardserver)
  sendChatMessage: (name, text, server) => sendChatMessage(server ? connKey(name, server) : name, text),
  logChat,
  getAccounts: () => accounts,
  isAccountOnline: (name, server) => isAccountOnline(server ? connKey(name, server) : name),
  getServers: () => servers.map((sv) => ({ id: sv.id, name: sv.name, isDefault: !!sv.isDefault })),
  colors: { info: DISCORD_COLOR_INFO, ok: DISCORD_COLOR_OK, warn: DISCORD_COLOR_WARN, danger: DISCORD_COLOR_DANGER },
  discordClient: null,
  botChannelId: DISCORD_CHANNEL_ID,
  addCommandChannel: (id) => { if (id) extraCommandChannels.add(String(id)); },
};

function loadExtensions(api) {
  const dir = path.join(__dirname, 'erweiterungen');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  } catch (_) {
    return; // kein Ordner -> keine Erweiterungen
  }
  for (const f of files) {
    try {
      const setup = require(path.join(dir, f));
      if (typeof setup === 'function') setup(api);
      console.log(`Erweiterung geladen: ${f}`);
    } catch (e) {
      console.error(`Erweiterung ${f} konnte nicht geladen werden:`, e.message);
    }
  }
}

// ---------- Discord: Bot fuer eingehende Nachrichten (Discord -> Minecraft) ----------
if (DISCORD_BOT_TOKEN && DISCORD_CHANNEL_ID) {
  const { Client, GatewayIntentBits } = require('discord.js');

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  discordStartedAt = Date.now();
  discordClient.once('clientReady', async () => {
    console.log(`Discord-Bot eingeloggt als ${discordClient.user.tag}`);
    await resolveDiscordTargets();
    discordReady = true;
    flushDiscordPending();
    discordReadyWaiters.splice(0).forEach((fn) => fn());
  });
  // Kommt der Bot nicht rechtzeitig online, gehen die aufgehobenen Meldungen per Webhook raus
  setTimeout(() => {
    if (!discordReady && discordPending.length > 0) {
      console.warn('Discord-Bot ist noch nicht verbunden - aufgehobene Meldungen gehen per Webhook raus');
      flushDiscordPending();
    }
  }, DISCORD_READY_WAIT_MS + 1000);

  const EPHEMERAL = MessageFlags.Ephemeral;

  // Schreibt ins Log, WARUM ein Discord-Klick nicht geklappt hat
  function logInteractionProblem(where, e) {
    const code = e && e.code;
    if (code === 10062) {
      console.warn(`[Diagnose] Discord-Klick (${where}) kam zu spät an - Discord gibt nur 3 Sekunden. Der Prozess war in dem Moment ausgelastet; im Discord stand "Interaktion fehlgeschlagen".`);
    } else if (code === 40060) {
      console.warn(`[Diagnose] Discord-Klick (${where}) wurde schon von einer ANDEREN Instanz beantwortet - läuft der AFK-Manager doppelt (z.B. zusätzlich auf einem zweiten Rechner)?`);
    } else {
      console.error(`Discord-Interaction Fehler (${where}):`, e && e.message);
    }
  }

  async function denyWithoutRole(interaction) {
    if (hasAllowedRole(interaction.member)) return false;
    auditDiscord(interaction.user, interaction.channel, 'Klick abgelehnt (keine Berechtigung)', null, interaction.customId);
    await interaction.reply({ content: '❌ Du hast keine Berechtigung dafür.', flags: EPHEMERAL })
      .catch((e) => logInteractionProblem('Rechte-Hinweis', e));
    return true;
  }

  discordClient.on('interactionCreate', async (interaction) => {
    let where = 'unbekannt';
    try {
      // ---------- Bestehender Start-Button (bei "anderswo eingeloggt") ----------
      if (interaction.isButton() && interaction.customId.startsWith('start_')) {
        where = 'Start-Button';
        if (await denyWithoutRole(interaction)) return;
        const username = interaction.customId.slice('start_'.length);
        // ERST Discord antworten, DANN den Bot starten: Discord erlaubt nur 3 Sekunden fuer
        // die Antwort, sonst steht dort "Die Anwendung hat nicht rechtzeitig reagiert".
        // Der Start laeuft auch dann los, wenn die Antwort zu spaet kommt - aber NICHT, wenn
        // eine andere Instanz den Klick schon beantwortet hat (die startet ihn dann selbst).
        let otherInstance = false;
        await interaction.update({
          content: `${interaction.message.content}\n\n▶️ **${connLabel(username)}** wird jetzt gestartet...`,
          components: [],
        }).catch((e) => {
          logInteractionProblem(`Start-Button ${username}`, e);
          if (e && e.code === 40060) otherInstance = true;
        });
        if (!otherInstance) {
          forgetElsewhereNotice(username, interaction.message.id);
          auditDiscord(interaction.user, interaction.channel, 'Gestartet (Knopf)', username);
          requestBotStart(username, { manual: true, source: `über den Knopf (${interaction.user.username})` });
        }
        return;
      }
    } catch (e) {
      logInteractionProblem(where, e);
    }
  });

  // "Name", "Name@lobby" (Kuerzel oder Servername), "Name@alle" -> Verbindungen
  // Rueckgabe: { keys, account, server, all } oder { error }
  const findServerByText = (text) => {
    const x = String(text || '').trim().toLowerCase();
    if (!x) return null;
    return servers.find((sv) => sv.id === x) || servers.find((sv) => sv.name.toLowerCase() === x) || null;
  };
  const resolveTarget = (text) => {
    const raw = String(text || '').trim();
    const at = raw.lastIndexOf('@');
    const namePart = at > 0 ? raw.slice(0, at).trim() : raw;
    const serverPart = at > 0 ? raw.slice(at + 1).trim() : null;
    const account = accounts.find((a) => a.username.toLowerCase() === namePart.toLowerCase());
    if (!account) return { error: `Unbekannter Account "${namePart}".` };
    if (serverPart === null) return { keys: [account.username], account, server: defaultServer };
    if (/^(alle|all)$/i.test(serverPart)) return { keys: connKeysOfAccount(account.username), account, all: true };
    const sv = findServerByText(serverPart);
    if (!sv) {
      return { error: `Unbekannter Server "${serverPart}". Server: ${servers.map((x) => `\`${x.id}\``).join(', ')}` };
    }
    const key = connKey(account.username, sv.id);
    if (!connectionExists(key)) return { error: `${account.username} ist nicht auf ${sv.name}.`, account, server: sv };
    return { keys: [key], account, server: sv };
  };
  const accountsHint = () => `Bekannte Accounts: ${accounts.map((a) => a.username).join(', ') || '(keine)'}` +
    (servers.length > 1 ? `\nWeitere Server: ${servers.filter((sv) => !sv.isDefault).map((sv) => `\`@${sv.id}\``).join(', ')} (z.B. \`Name@${servers[1].id}\`, \`Name@alle\`)` : '');

  discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    // Befehle gelten im Bot-Kanal (und in Kanaelen, die eine Erweiterung freigegeben hat)
    const isCommandChannel = message.channelId === DISCORD_CHANNEL_ID || extraCommandChannels.has(message.channelId);
    if (!isCommandChannel) return;

    const content = message.content.trim();

    // Rollen-Pruefung nur bei tatsaechlichen Befehlsversuchen (fangen mit "!" an),
    // damit normale Chat-Nachrichten im Kanal nicht faelschlicherweise abgewiesen werden
    if (content.startsWith('!') && !hasAllowedRole(message.member)) {
      auditDiscord(message.author, message.channel, 'Befehl abgelehnt (keine Berechtigung)', null, content.slice(0, 120));
      message.reply('❌ Du hast keine Berechtigung, diese Befehle zu nutzen.').catch(() => {});
      return;
    }

    // ---------- !rename AlterName NeuerName ----------
    const renameMatch = content.match(/^!rename\s+(\S+)\s+(\S+)$/i);
    if (renameMatch) {
      const oldName = renameMatch[1];
      const newName = renameMatch[2];
      const matchedAccount = accounts.find(
        (a) => a.username.toLowerCase() === oldName.toLowerCase()
      );
      if (!matchedAccount) {
        message.reply(
          `❌ Unbekannter Account "${oldName}". Beispiel: \`!rename AlterName NeuerName\`\n` +
          `Bekannte Accounts: ${accounts.map((a) => a.username).join(', ') || '(keine)'}`
        ).catch(() => {});
        return;
      }
      if (accounts.some((a) => a.username.toLowerCase() === newName.toLowerCase() && a.username !== matchedAccount.username)) {
        message.reply(`❌ Ein Account namens "${newName}" existiert schon.`).catch(() => {});
        return;
      }
      if (accountConnected(matchedAccount.username)) {
        message.reply(`❌ Bitte "${matchedAccount.username}" zuerst stoppen (\`!stop ${matchedAccount.username}\`${connKeysOfAccount(matchedAccount.username).length > 1 ? ' – auf allen Servern' : ''}), bevor er umbenannt werden kann.`).catch(() => {});
        return;
      }
      const renameProblem = accountNameProblem(newName);
      if (renameProblem) {
        message.reply(`❌ ${renameProblem}`).catch(() => {});
        return;
      }
      auditDiscord(message.author, message.channel, 'Account umbenannt', matchedAccount.username, `neuer Name: ${newName}`);
      renameAccount(matchedAccount.username, newName);
      message.reply(`✅ **${oldName}** wurde in **${newName}** umbenannt.`).catch(() => {});
      return;
    }

    // ---------- !primary Accountname: legt die Chat-Quelle fest ----------
    const primaryMatch = content.match(/^!(primary|setchatsource)\s+(.+)$/i);
    if (primaryMatch) {
      const target = primaryMatch[2].trim();
      const resolved = resolveTarget(target);
      if (resolved.error || resolved.all) {
        message.reply(
          `❌ ${resolved.error || 'Bitte einen Server angeben, nicht @alle.'} Beispiel: \`!primary Accountname\`\n` + accountsHint()
        ).catch(() => {});
        return;
      }
      const key = resolved.keys[0];
      if (!isDefaultConn(key)) {
        if (isBedrockAccount(connUser(key))) {
          message.reply('❌ Bedrock-Accounts können keine Chat-Quelle sein.').catch(() => {});
          return;
        }
        extraConnections.forEach((c) => {
          if (c.server === connServerId(key)) c.preferredChatSource = c.username === connUser(key);
        });
        saveExtraConnections();
        broadcastAccountList();
        auditDiscord(message.author, message.channel, 'Chat-Quelle festgelegt', key);
        message.reply(`⭐ ${connLabel(key)} ist jetzt die Chat-Quelle für ${resolved.server.name}.`).catch(() => {});
        return;
      }
      const matchedAccount = resolved.account;
      makeAccountPrimary(matchedAccount.username);
      auditDiscord(message.author, message.channel, 'Chat-Quelle festgelegt', matchedAccount.username);
      message.reply(`⭐ ${matchedAccount.username} ist jetzt die Chat-Quelle.`).catch(() => {});
      return;
    }

    // ---------- !add Accountname: neuen Account hinzufuegen und starten ----------
    const addMatch = content.match(/^!add\s+(.+)$/i);
    if (addMatch && addMatch[1].includes('@')) {
      const raw = addMatch[1].trim();
      const at = raw.lastIndexOf('@');
      const name = raw.slice(0, at).trim();
      const sv = findServerByText(raw.slice(at + 1));
      const acc = accounts.find((a) => a.username.toLowerCase() === name.toLowerCase());
      if (!acc) {
        message.reply(`❌ Den Account "${name}" gibt es noch nicht – zuerst \`!add ${name}\`, dann \`!add ${name}@server\`.`).catch(() => {});
        return;
      }
      if (!sv) {
        message.reply(`❌ Unbekannter Server. Server: ${servers.map((x) => `\`${x.id}\``).join(', ')}`).catch(() => {});
        return;
      }
      const problem = addConnectionProblem(acc.username, sv.id);
      if (problem) {
        message.reply(`❌ ${problem.error}`).catch(() => {});
        return;
      }
      const key = addConnection(acc.username, sv.id);
      auditDiscord(message.author, message.channel, 'Verbindung angelegt und gestartet', key, `${sv.name} (${sv.host})`);
      requestBotStart(key, { manual: true, source: `per !add von ${message.author.username}` });
      broadcastAccountList();
      message.reply(`✅ **${acc.username}** geht jetzt zusätzlich auf **${sv.name}** und wird gestartet.`).catch(() => {});
      return;
    }
    if (addMatch) {
      const newUsername = addMatch[1].trim();
      const addProblem = accountNameProblem(newUsername);
      if (addProblem) {
        message.reply(`❌ ${addProblem}`).catch(() => {});
        return;
      }
      if (accounts.find((a) => a.username.toLowerCase() === newUsername.toLowerCase())) {
        message.reply(`❌ Account "${newUsername}" existiert schon.`).catch(() => {});
        return;
      }
      const isFirstAccount = accounts.length === 0;
      accounts.push({
        username: newUsername,
        authType: 'premium',
        everJoined: false,
        preferredChatSource: isFirstAccount,
        authCacheId: newUsername,
        notifyElsewhere: false, // Glocke bei neuen Accounts aus - im Dashboard einschaltbar
        autoChat: templateFor(DEFAULT_SERVER_ID),
      });
      if (isFirstAccount) currentChatSourceUsername = newUsername;
      saveAccounts();
      broadcastAccountList();
      auditDiscord(message.author, message.channel, 'Account angelegt und gestartet', newUsername);
      message.reply(
        `✅ **${newUsername}** hinzugefügt und wird gestartet. Falls ein Microsoft-Login nötig ist, kommt der Code gleich hier im Kanal.`
      ).catch(() => {});
      requestBotStart(newUsername, { manual: true });
      return;
    }

    // ---------- !list / !status: Uebersicht aller Accounts ----------
    if (/^!(list|status)$/i.test(content)) {
      if (accounts.length === 0) {
        message.reply('Keine Accounts vorhanden.').catch(() => {});
        return;
      }
      const statusOf = (k) => (bots[k] ? bots[k].status : 'gestoppt');
      const emojiOf = (st) => (st === 'online' ? '🟢' : st === 'gestoppt' ? '⚪' : '🟡');
      const lines = [];
      accounts.forEach((acc) => {
        const status = statusOf(acc.username);
        const primaryTag = acc.username === getPrimaryUsername() ? ' *(Chat-Quelle)*' : '';
        lines.push(`${emojiOf(status)} **${acc.username}**${primaryTag} — ${status}`);
        connKeysOfAccount(acc.username).slice(1).forEach((k) => {
          const st = statusOf(k);
          const sv = serverOf(k);
          lines.push(`　↳ ${emojiOf(st)} ${sv ? sv.name : connServerId(k)} — ${st}`);
        });
      });
      const keys = allConnKeys();
      const onlineCount = keys.filter((k) => statusOf(k) === 'online').length;
      let description = lines.join('\n');
      if (description.length > 4000) description = description.slice(0, 3990) + '\n…';
      message.reply({
        embeds: [{
          title: `📋 Account-Übersicht (${onlineCount}/${keys.length} online)`,
          description,
          color: DISCORD_COLOR_INFO,
        }],
      }).catch(() => {});
      return;
    }

    // ---------- !start / !stop Accountname (oder "all") ----------
    const startStopMatch = content.match(/^!(start|stop)\s+(.+)$/i);
    if (startStopMatch) {
      const action = startStopMatch[1].toLowerCase();
      const target = startStopMatch[2].trim();

      if (target.toLowerCase() === 'all' || target.toLowerCase() === 'alle') {
        if (accounts.length === 0) {
          message.reply('Keine Accounts vorhanden.').catch(() => {});
          return;
        }
        // Alle Accounts auf allen Servern (wie "Alle starten/stoppen" im Dashboard)
        allConnKeys().forEach((k) => {
          if (action === 'start') requestBotStart(k, { manual: true, source: `per „!start all“ von ${message.author.username}` });
          else stopBot(k);
        });
        auditDiscord(message.author, message.channel, action === 'start' ? 'Alle gestartet' : 'Alle gestoppt');
        message.react('✅').catch(() => {});
        return;
      }

      const resolved = resolveTarget(target);
      if (resolved.error) {
        message.reply(
          `❌ ${resolved.error} Beispiel: \`!${action} Accountname\`, \`!${action} Accountname@server\` oder \`!${action} all\`\n` + accountsHint()
        ).catch(() => {});
        return;
      }

      resolved.keys.forEach((k) => {
        if (action === 'start') requestBotStart(k, { manual: true, source: `per !start von ${message.author.username}` });
        else stopBot(k);
      });
      auditDiscord(message.author, message.channel, action === 'start' ? 'Gestartet' : 'Gestoppt',
        resolved.all ? `${resolved.account.username}@alle` : resolved.keys[0],
        resolved.all ? resolved.keys.join(', ') : '');
      message.react('✅').catch(() => {});
      return;
    }

    // ---------- !mc Accountname Nachricht ----------
    if (!content.startsWith(DISCORD_COMMAND_PREFIX)) return;

    const rest = content.slice(DISCORD_COMMAND_PREFIX.length).trim();
    if (!rest) {
      message.reply(`Beispiel: \`${DISCORD_COMMAND_PREFIX} Accountname Hallo Leute\``).catch(() => {});
      return;
    }

    // Accountname ist jetzt Pflicht: erstes Wort MUSS ein bekannter Account sein.
    // Aufteilung an EINEM ODER MEHREREN Leerzeichen, damit z.B. "!mc Name  /befehl"
    // (zwei Leerzeichen) nicht dazu fuehrt, dass der Text mit einem Leerzeichen beginnt -
    // Minecraft wuerde ihn dann als normalen Chat statt als Befehl behandeln.
    const parts = rest.split(/\s+/);
    const maybeAccount = parts[0];
    const resolved = resolveTarget(maybeAccount);

    if (resolved.error || resolved.all) {
      message.reply(
        `❌ ${resolved.error || 'Bitte genau einen Server angeben (nicht @alle).'} Beispiel: \`${DISCORD_COMMAND_PREFIX} Accountname Hallo Leute\`` +
        `${servers.length > 1 ? ` oder \`${DISCORD_COMMAND_PREFIX} Accountname@${servers[1].id} Hallo\`` : ''}\n` + accountsHint()
      ).catch(() => {});
      return;
    }

    const targetUsername = resolved.keys[0];
    // Alles nach dem Accountnamen, fuehrende Leerzeichen entfernt
    const chatText = rest.slice(maybeAccount.length).trim();

    if (!chatText) {
      message.reply('Nachricht fehlt nach dem Accountnamen.').catch(() => {});
      return;
    }

    const state = bots[targetUsername];
    if (!state || !state.bot) {
      message.reply(`❌ ${connLabel(targetUsername)} ist gerade nicht online.`).catch(() => {});
      return;
    }

    const sent = sendChatMessage(targetUsername, chatText);
    if (!sent.ok) {
      message.reply(`❌ Konnte nicht über ${connLabel(targetUsername)} senden: ${sent.error}`).catch(() => {});
      return;
    }
    logChat(targetUsername, `(von Discord, ${message.author.username}) ${chatText}`);
    auditDiscord(message.author, message.channel, chatText.startsWith('/') ? 'Befehl gesendet' : 'Chat gesendet', targetUsername, `"${chatText}"`);
    message.react('✅').catch(() => {});
  });

  // Discord-Teile fuer die Erweiterungen (geladen werden sie nach diesem Block)
  Object.assign(extApi, { discordClient, hasAllowedRole, denyWithoutRole, logInteractionProblem, auditDiscord });

  // Erst einloggen, wenn der Webserver wirklich laeuft - eine doppelt gestartete Instanz
  // (Port belegt) verbindet sich so gar nicht erst mit Discord.
  whenServerListening(() => {
    discordClient.login(DISCORD_BOT_TOKEN).catch((e) => {
      console.error('Discord-Bot Login fehlgeschlagen:', e.message, '- Meldungen gehen per Webhook raus');
      discordStartedAt = 0; // nicht mehr auf den Bot warten
      flushDiscordPending();
    });
  });
} else if (DISCORD_WEBHOOK_URL) {
  console.log('Discord: nur Webhook-Benachrichtigungen aktiv (kein Bot-Token/Kanal fuer Ruecksenden gesetzt).');
}

// ---------- Eigene Erweiterungen ----------
// Liegen im Ordner "erweiterungen" .js-Dateien, werden sie hier geladen. Der Ordner gehoert
// nicht zum Projekt (.gitignore) - fuer Ergaenzungen, die nur auf diesem Rechner laufen.
// Jede Datei exportiert eine Funktion, die das Objekt extApi (oben) bekommt.
loadExtensions(extApi);

// ---------- Discord: taegliche Uptime-Zusammenfassung ----------
// Laeuft um 00:00 Uhr und zeigt die vollen 24h des ABGELAUFENEN Tages.
// ---------- Discord: taegliche Uptime-Zusammenfassung ----------
// Der Ablauf um Mitternacht:
//   1. Zusammenfassung mit den echten Tageswerten senden (getUptimeMs liefert noch die
//      vollen 24h, weil ensureStats() den Reset nicht mehr automatisch macht)
//   2. Danach erst resetDailyStats() aufrufen -> Zaehler starten bei 0 fuer den neuen Tag
// So stehen echte volle 24h in der Zusammenfassung, und der neue Tageszaehler laeuft
// ab genau 00:00 Uhr, ohne irgendwelche Abschneidungen.
let lastDiscordSummaryDate = null;
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    const yesterday = getTodayStr(new Date(now.getTime() - 60 * 1000));
    if (lastDiscordSummaryDate !== yesterday) {
      lastDiscordSummaryDate = yesterday;

      // Schritt 1: Zusammenfassung mit den Werten des abgelaufenen Tages senden.
      // getUptimeMs() liefert hier noch die korrekten 24h-Werte, da ensureStats()
      // keinen automatischen Reset mehr macht.
      if (accounts.length > 0) {
        const lines = accounts.map((a) => `**${a.username}**: ${formatDurationServer(getUptimeMs(a.username))}`);
        // Weitere Server jeweils als eigener Abschnitt
        for (const sv of servers.filter((x) => !x.isDefault)) {
          const keys = allConnKeys().filter((k) => connServerId(k) === sv.id);
          if (keys.length === 0) continue;
          lines.push('', `__${sv.name}__`);
          keys.forEach((k) => lines.push(`**${connUser(k)}**: ${formatDurationServer(getUptimeMs(k))}`));
        }
        const text = lines.join('\n');
        sendDiscordEmbed({
          title: '📊 Tageszusammenfassung',
          description: text.length > 4000 ? text.slice(0, 3990) + '\n…' : text,
          color: DISCORD_COLOR_INFO,
        });
      }

      // Schritt 2: Erst NACH dem Senden die Zaehler fuer den neuen Tag auf 0 setzen.
      resetDailyStats();
    }
  }
}, 60 * 1000);

// ---------- Selbstdiagnose ----------
// Schreibt nur dann etwas ins Log, wenn es relevant ist:
//  - der Prozess "haengt" (Event-Loop blockiert) -> erklaert Discord-Timeouts / langsame Seite
//  - Speicherverbrauch alle 10 Minuten -> zeigt ein langsames Wachstum (Speicherleck)
//  - warum der Prozess beendet wurde -> fehlt die Zeile vor einem Neustart, wurde der Prozess
//    hart abgeschossen (Speicher voll / Absturz), nicht normal beendet
const diagMb = (n) => Math.round(n / 1048576);
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
let lastMemoryLogAt = 0;
let lastCpuUsage = process.cpuUsage();
let lastCpuAt = Date.now();
setInterval(() => {
  const maxMs = Math.round(loopDelay.max / 1e6);
  const p99Ms = Math.round(loopDelay.percentile(99) / 1e6);
  loopDelay.reset();
  const mem = process.memoryUsage();
  if (maxMs >= 1000) {
    console.warn(`[Diagnose] Prozess hing bis zu ${maxMs} ms (99% der Zeit unter ${p99Ms} ms) - RAM ${diagMb(mem.rss)} MB, Heap ${diagMb(mem.heapUsed)} MB`);
  }
  if (Date.now() - lastMemoryLogAt >= 10 * 60 * 1000) {
    lastMemoryLogAt = Date.now();
    const limit = v8.getHeapStatistics().heap_size_limit;
    // CPU des Prozesses seit der letzten Zeile (100% = ein Kern voll ausgelastet)
    const cpu = process.cpuUsage(lastCpuUsage);
    const secs = Math.max(1, (Date.now() - lastCpuAt) / 1000);
    lastCpuUsage = process.cpuUsage();
    lastCpuAt = Date.now();
    const cpuPct = Math.round((cpu.user + cpu.system) / 1e4 / secs);
    let bedrockInfo = '';
    if (bedrockPacketTotals.read || bedrockPacketTotals.dropped) {
      const rate = (n) => { const r = n / secs; return r >= 10 ? String(Math.round(r)) : r.toFixed(1); };
      bedrockInfo = `, Bedrock-Pakete/s gelesen ${rate(bedrockPacketTotals.read)}, verworfen ${rate(bedrockPacketTotals.dropped)}`;
      bedrockPacketTotals.read = 0;
      bedrockPacketTotals.dropped = 0;
    }
    console.log(`[Diagnose] RAM ${diagMb(mem.rss)} MB, Heap ${diagMb(mem.heapUsed)} von max. ${diagMb(limit)} MB, CPU ${cpuPct}%, ${Object.values(bots).filter((b) => b && b.bot).length} Bots verbunden${bedrockInfo}`);
  }
}, 60 * 1000).unref();
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`[Diagnose] ${sig} empfangen - Server wird normal beendet`);
    process.exit(0);
  });
});
process.on('exit', (code) => console.log(`[Diagnose] Prozess beendet (Code ${code})`));

server.listen(PORT, () => {
  console.log(`AFK-Manager laeuft auf Port ${PORT}`);
  if (MC_SERVER_HOST) console.log(`Zielserver: ${MC_SERVER_HOST}:${MC_SERVER_PORT}`);
  else console.error('[Server] MC_SERVER_HOST fehlt in der .env - ohne Standardserver startet kein Account! Bitte eintragen und neu starten.');
  if (servers.length > 1) console.log(`Weitere Server: ${servers.filter((sv) => !sv.isDefault).map((sv) => `${sv.name} (${sv.host})`).join(', ')}`);

  sendDiscordEmbed({
    title: '🟢 AFK-Manager gestartet',
    description: MC_SERVER_HOST
      ? `Verbindet mit ${MC_SERVER_HOST}, ${accounts.length} Account(s) werden automatisch gestartet.`
      : 'MC_SERVER_HOST fehlt in der .env - es startet kein Account.',
    color: DISCORD_COLOR_OK,
  });

  // Alle gespeicherten Accounts automatisch starten (z.B. nach Stromausfall/Neustart via pm2).
  // Laeuft ueber die Reconnect-Warteschlange, damit sie nacheinander statt gleichzeitig
  // einen Microsoft-Login versuchen (verhindert 429-Fehler bei vielen Accounts).
  allConnKeys().forEach((key) => {
    console.log(`Auto-Start (Serverstart): ${key}`);
    // bots-Objekt vorab anlegen damit der Status auf der Webseite sofort sichtbar ist,
    // auch wenn der Account noch in der Warteschlange auf seinen Verbindungsversuch wartet.
    if (!bots[key]) {
      bots[key] = { bot: null, status: 'Warteschlange...', hideTimer: null, autoChatTimers: [], manualStop: false, hasSpawnedThisConnection: false };
    }
    requestBotStart(key, { source: 'nach einem Neustart des AFK-Managers' });
  });
  broadcastAccountList();

  // Regelmaessig die Account-Liste neu senden, damit die Uptime-Anzeige live mitzaehlt
  setInterval(() => broadcastAccountList(), 30 * 1000);
});
