// Testumgebung: startet server.js mit nachgebauten Minecraft-, Bedrock- und Discord-Teilen.
// Es wird nichts nach aussen verbunden (kein Microsoft-Login, kein Minecraft-Server, kein Discord).
//
// Aufruf (macht test/run.js fuer jedes Szenario):
//   node test/lib/harness.js test/szenarien/<name>.js
//
// Die Zeit laeuft im Zeitraffer (TEST_ZEITRAFFER, Standard 40x): Date.now() und alle Timer
// laufen gleich schnell, die 10-Sekunden-Pause der Warteschlange dauert also nur 0,25 s.
'use strict'

const Module = require('module')
const path = require('path')
const fs = require('fs')
const { EventEmitter } = require('events')

const SCALE = Math.max(1, Number(process.env.TEST_ZEITRAFFER || 40))
const REPO = path.resolve(__dirname, '..', '..')
const szenarioDatei = path.resolve(process.argv[2] || '')
const szenario = require(szenarioDatei)
const PHASE = Number(process.env.TEST_PHASE || 1)

// ---------- Zeitraffer ----------
const RealDate = Date
const realNow = RealDate.now.bind(RealDate)
const t0 = realNow()
// Testuhr startet immer um 10:00 Uhr (Zeitraffer laeuft sonst je nach echter Uhrzeit ueber
// Mitternacht - dann setzt die Tagesstatistik mitten im Test zurueck)
const startUhr = new RealDate(t0)
startUhr.setHours(szenario.uhrzeit != null ? szenario.uhrzeit : 10, 0, 0, 0)
let sprung = startUhr.getTime() - t0
const fakeNow = () => Math.round(t0 + (realNow() - t0) * SCALE + sprung)
class FakeDate extends RealDate {
  constructor (...a) { if (a.length === 0) super(fakeNow()); else super(...a) }
  static now () { return fakeNow() }
}
FakeDate.UTC = RealDate.UTC
FakeDate.parse = RealDate.parse
global.Date = FakeDate
const realSetTimeout = global.setTimeout
const realSetInterval = global.setInterval
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.max(0, (Number(ms) || 0) / SCALE), ...a)
global.setInterval = (fn, ms, ...a) => realSetInterval(fn, Math.max(1, (Number(ms) || 0) / SCALE), ...a)
const warteEcht = (ms) => new Promise((r) => realSetTimeout(r, ms))

// ---------- Arbeitsordner (frische Kopie des Programms) ----------
const lauf = process.env.TEST_LAUF_DIR || path.join(REPO, 'test', '.lauf', `${path.basename(szenarioDatei, '.js')}-${process.pid}`)
if (PHASE === 1) {
  fs.rmSync(lauf, { recursive: true, force: true })
  fs.mkdirSync(lauf, { recursive: true })
  for (const f of fs.readdirSync(REPO)) {
    if (/\.(js|html)$/.test(f)) fs.copyFileSync(path.join(REPO, f), path.join(lauf, f))
  }
  fs.cpSync(path.join(REPO, 'public'), path.join(lauf, 'public'), { recursive: true })
  fs.symlinkSync(fs.realpathSync(path.join(REPO, 'node_modules')), path.join(lauf, 'node_modules'))
  if (szenario.accounts) fs.writeFileSync(path.join(lauf, 'accounts.json'), JSON.stringify(szenario.accounts, null, 2))
  for (const [name, inhalt] of Object.entries(szenario.dateien || {})) {
    fs.mkdirSync(path.dirname(path.join(lauf, name)), { recursive: true })
    fs.writeFileSync(path.join(lauf, name), typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt, null, 2))
  }
}
// Login-Cache nur im Testordner (deleteAuthCacheFiles & Co. duerfen nie echte Dateien sehen)
process.env.HOME = lauf
process.env.APPDATA = lauf

// ---------- Einstellungen ----------
const PORT = String(3900 + (process.pid % 900))
Object.assign(process.env, {
  PORT,
  DASHBOARD_PASSWORD: 'testpw',
  DASHBOARD_OWNER: 'nils',
  MC_SERVER_HOST: 'mc.test',
  MC_SERVER_PORT: '25565',
  MC_BEDROCK_PORT: '19132',
  DISCORD_BOT_TOKEN: 'test',
  DISCORD_CHANNEL_ID: 'BEFEHLE',
  DISCORD_NOTIFY_CHANNEL_ID: 'MELDUNGEN',
  DISCORD_CHAT_CHANNEL_ID: 'CHAT',
  DISCORD_WEBHOOK_URL: '',
  DISCORD_CHAT_WEBHOOK_URL: '',
  ...(szenario.env || {}),
})
for (const [k, v] of Object.entries(szenario.env || {})) if (v === null) delete process.env[k]

// ---------- Mitschnitt der Konsole ----------
const logZeilen = []
for (const lvl of ['log', 'warn', 'error']) {
  const orig = console[lvl].bind(console)
  console[lvl] = (...a) => {
    const text = a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.stack : JSON.stringify(x))).join(' ')
    logZeilen.push(text)
    if (process.env.TEST_LAUT) orig(text)
  }
}

// ---------- Nachbau: mineflayer (Java) ----------
const javaBots = []
class FakeJavaBot extends EventEmitter {
  constructor (opts) {
    super()
    this.opts = opts
    this.username = opts.username
    this.gesendet = []
    this.geschrieben = []
    this.beendet = false
    this.players = {}
    this.entities = {}
    this.entity = { position: { x: 0, y: 64, z: 0, distanceTo: () => 1 } }
    this.heldItem = null
    this.steuerung = []
    this._client = new EventEmitter()
    this._client.write = (name, params) => this.geschrieben.push([name, params])
    this._client.end = () => this.quit()
  }

  chat (text) { this.gesendet.push(text) }
  quit () { if (this.beendet) return; this.beendet = true; setImmediate(() => this.emit('end', 'quit')) }
  end () { this.quit() }
  setControlState (k, v) { this.steuerung.push([k, v]) }
  clearControlStates () {}
  setQuickBarSlot (s) { this.steuerung.push(['hotbar', s]) }
  dismount () { this.steuerung.push(['dismount']) }
  mount () { this.steuerung.push(['mount']) }
  attack () { this.steuerung.push(['attack']) }

  // ---- vom Test gesteuert ----
  einloggen () { this.drin = true; this.emit('login'); this.emit('spawn') }
  spawn () { this.emit('spawn') }
  kick (grund) { this.emit('kicked', grund, true); this.beendet = true; this.emit('end', 'kicked') }
  trennen () { this.beendet = true; this.emit('end', 'socketClosed') }
  fehler (msg, code) { const e = new Error(msg); if (code) e.code = code; this.emit('error', e) }
  chatEmpfangen (text) { this.emit('message', { toString: () => text }) }
  code (data = {}) { this.opts.onMsaCode({ user_code: 'TESTCODE', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, message: 'Code', ...data }) }
}

// ---------- Nachbau: Bedrock (Thread-Client, bedrock-protocol, nethernet-http) ----------
const bedrockClients = []
class FakeBedrockClient extends EventEmitter {
  constructor (cfg, callbacks = {}) {
    super()
    this.cfg = cfg
    this.cb = callbacks
    this.options = { version: '1.26.60', protocolVersion: 924, ...(cfg.client ? { host: cfg.client.host, port: cfg.client.port } : {}) }
    this.username = cfg.client ? cfg.client.username : cfg.username
    this.profile = { name: this.username }
    this.isThread = true
    this.pakete = []
    this._closed = false
  }

  queue (name, params) { if (this._closed) throw new Error('Verbindung ist geschlossen'); this.pakete.push([name, params]) }
  write (name, params) { this.queue(name, params) }
  disconnect () { this.close() }
  close () {
    if (this._closed) return
    this._closed = true
    try { this.emit('close') } finally { this.removeAllListeners() }
  }

  // ---- vom Test gesteuert ----
  spawn () { this.drin = true; this.emit('spawn') }
  trennen (grund) { if (grund) this.emit('disconnect', { message: grund }); this.close() }
  schritt (name, info = {}) { if (this.cb.onStep) this.cb.onStep(name, info) }
  aufbauScheitert (code = 9) { this.schritt('webrtc-getrennt', { reason: `connecterror:${code}`, events: [] }); }
  code (data = {}) { if (this.cb.onMsaCode) this.cb.onMsaCode({ user_code: 'BEDROCKCODE', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, ...data }) }
}

const fakeBedrockProtocol = {
  createClient: (opts) => { const c = new FakeBedrockClient({ client: opts }); bedrockClients.push(c); return c },
  ping: () => (process.env.TEST_BEDROCK_RAKNET === '1' ? Promise.resolve({}) : Promise.reject(new Error('kein RakNet'))),
}
const fakeNethernet = {
  probe: async () => ({ scheme: 'http', address: '192.0.2.1' }),
  attach: () => {},
  randomNetworkId: () => '1234567890',
  tuneWerift: () => ({ ok: true, responseMs: 2000, consentTimeoutS: 120, delayedAck: true }),
}

// ---------- Nachbau: Discord ----------
const STORE = path.join(lauf, 'test-discord.json')
const ladeStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch (_) { return { next: 1, msgs: {} } } }
const speichereStore = (d) => fs.writeFileSync(STORE, JSON.stringify(d, null, 2))
const flach = (c) => (c && typeof c.toJSON === 'function' ? c.toJSON() : c)
const flachPayload = (p) => JSON.parse(JSON.stringify({ ...p, components: (p.components || []).map(flach), embeds: (p.embeds || []).map(flach) }))
let fakeDiscord = null
function nachricht (id) {
  const d = ladeStore()
  const m = d.msgs[id]
  if (!m) { const e = new Error('Unknown Message'); e.code = 10008; throw e }
  return {
    id,
    channelId: m.channelId,
    content: m.content,
    embeds: m.embeds,
    components: m.components,
    edit: async (p) => {
      const d2 = ladeStore()
      const neu = flachPayload(p)
      Object.assign(d2.msgs[id], { content: neu.content ?? d2.msgs[id].content, embeds: neu.embeds.length ? neu.embeds : (p.embeds ? [] : d2.msgs[id].embeds), components: neu.components })
      d2.msgs[id].edits = (d2.msgs[id].edits || 0) + 1
      speichereStore(d2)
    },
  }
}
class FakeDiscordClient extends EventEmitter {
  constructor () {
    super()
    fakeDiscord = this
    this.user = { tag: 'AFK#0001', id: 'bot' }
    this.channels = {
      fetch: async (cid) => {
        if (global.__kaputteKanaele && global.__kaputteKanaele.has(cid)) throw new Error('Missing Access')
        return {
          id: cid,
          name: cid,
          send: async (p) => {
            const d = ladeStore()
            const id = 'm' + d.next++
            d.msgs[id] = { channelId: cid, ...flachPayload(p), at: Date.now() }
            speichereStore(d)
            return nachricht(id)
          },
          messages: { fetch: async (mid) => nachricht(mid) },
        }
      },
    }
  }

  login () { setTimeout(() => this.emit('clientReady'), Number(process.env.TEST_DISCORD_VERZOEGERUNG || 2000)); return Promise.resolve('ok') }
  destroy () {}
}

// ---------- Module austauschen ----------
const realLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'mineflayer') return { createBot: (opts) => { const b = new FakeJavaBot(opts); javaBots.push(b); return b } }
  if (request === 'bedrock-protocol') return fakeBedrockProtocol
  if (request === './nethernet-http') return fakeNethernet
  if (request === './bedrock-thread') {
    return { BedrockThreadClient: class extends FakeBedrockClient { constructor (cfg, cb) { super(cfg, cb); bedrockClients.push(this) } } }
  }
  if (request === 'discord.js') {
    const echt = realLoad.apply(this, arguments)
    return new Proxy(echt, { get: (t, k) => (k === 'Client' ? FakeDiscordClient : t[k]) })
  }
  return realLoad.apply(this, arguments)
}

// ---------- Werkzeuge fuer die Szenarien ----------
let bestanden = 0
let fehlgeschlagen = 0
const base = `http://127.0.0.1:${PORT}`
const cookies = {}

const t = {
  PHASE,
  lauf,
  log: logZeilen,
  chk (name, ok, detail) {
    if (ok) { bestanden++; process.stdout.write(`  ok    ${name}\n`) } else { fehlgeschlagen++; process.stdout.write(`  FEHLER ${name}${detail !== undefined ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}\n`) }
    return !!ok
  },
  // Wartezeiten in (Spiel-)Millisekunden - laufen im Zeitraffer
  warte: (ms) => warteEcht(Math.max(5, ms / SCALE)),
  async warteBis (fn, ms = 60000) {
    const ende = realNow() + Math.max(200, ms / SCALE)
    while (realNow() < ende) {
      try { if (await fn()) return true } catch (_) { /* weiter */ }
      await warteEcht(10)
    }
    try { return !!(await fn()) } catch (_) { return false }
  },
  zeit: {
    jetzt: () => fakeNow(),
    springe: (ms) => { sprung += ms },
    setze: (date) => { sprung += date.getTime() - fakeNow() },
  },
  // ---- Minecraft ----
  javaBots,
  bedrockClients,
  // Jeden neu auftauchenden Bot sofort einloggen lassen, bis fn() stimmt
  async alleEinloggenBis (fn, ms = 60000) {
    return t.warteBis(async () => {
      t.javaBots.filter((b) => !b.drin && !b.beendet).forEach((b) => b.einloggen())
      t.bedrockClients.filter((c) => !c.drin && !c._closed).forEach((c) => c.spawn())
      return fn()
    }, ms)
  },
  java: (cacheId) => javaBots.filter((b) => b.opts.username === cacheId).pop(),
  javaAlle: (cacheId) => javaBots.filter((b) => b.opts.username === cacheId),
  bedrock: (gamertag) => bedrockClients.filter((c) => c.username === gamertag).pop(),
  bedrockAlle: (gamertag) => bedrockClients.filter((c) => c.username === gamertag),
  // ---- Discord ----
  discord: {
    nachrichten: (kanal) => Object.entries(ladeStore().msgs).map(([id, m]) => ({ id, ...m })).filter((m) => !kanal || m.channelId === kanal),
    text: (m) => [m.content || '', ...(m.embeds || []).map((e) => `${e.title || ''} ${e.description || ''}`)].join(' '),
    befehl (content, { rollen = true, autor = 'tester', kanal = 'BEFEHLE' } = {}) {
      const antworten = []
      const reaktionen = []
      fakeDiscord.emit('messageCreate', {
        author: { bot: false, id: 'u-' + autor, username: autor },
        member: { roles: { cache: { some: () => rollen } } },
        channelId: kanal,
        channel: { id: kanal, name: kanal },
        content,
        reply: async (x) => { antworten.push(typeof x === 'string' ? x : JSON.stringify(x)) },
        react: async (e) => { reaktionen.push(e) },
      })
      return { antworten, reaktionen }
    },
    knopf (customId, message, { rollen = true, autor = 'tester' } = {}) {
      const antworten = []
      fakeDiscord.emit('interactionCreate', {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId,
        user: { id: 'u-' + autor, username: autor },
        member: { roles: { cache: { some: () => rollen } } },
        channel: { id: message.channelId, name: message.channelId },
        message: { id: message.id, content: message.content },
        update: async (p) => antworten.push(p),
        reply: async (p) => antworten.push(p),
      })
      return antworten
    },
    kaputt: (kanal, an = true) => { global.__kaputteKanaele = global.__kaputteKanaele || new Set(); if (an) global.__kaputteKanaele.add(kanal); else global.__kaputteKanaele.delete(kanal) },
  },
  // ---- Webseite ----
  // Passwort: nils = DASHBOARD_PASSWORD, alle anderen Test-Benutzer "geheim123"
  async login (user = 'nils', pw = user === 'nils' ? 'testpw' : 'geheim123') {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: pw }) })
    cookies[user] = (r.headers.get('set-cookie') || '').split(';')[0]
    return r.ok
  },
  async api (method, url, body, als = 'nils') {
    if (!cookies[als]) await t.login(als)
    const r = await fetch(base + url, {
      method,
      headers: { cookie: cookies[als] || '', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    })
    let data = null
    const text = await r.text()
    try { data = JSON.parse(text) } catch (_) { data = text }
    return { status: r.status, data }
  },
  async liste (als = 'nils') { return (await t.api('GET', '/api/accounts', undefined, als)).data },
  async status (name, als = 'nils') { const a = (await t.liste(als)).find((x) => x.username === name); return a ? a.status : undefined },
  datei: (name) => { try { return JSON.parse(fs.readFileSync(path.join(lauf, name), 'utf8')) } catch (_) { return null } },
  logEnthaelt: (re) => logZeilen.some((z) => re.test(z)),
}

// ---------- Start ----------
;(async () => {
  try {
    require(path.join(lauf, 'server.js'))
    const bereit = await t.warteBis(async () => (await fetch(base + '/login')).ok, 20000)
    if (!bereit) throw new Error('Server startet nicht')
    process.stdout.write(`${szenario.name || path.basename(szenarioDatei)}${PHASE > 1 ? ` (Phase ${PHASE})` : ''}\n`)
    await szenario.run(t)
  } catch (e) {
    fehlgeschlagen++
    process.stdout.write(`  FEHLER Absturz: ${e && e.stack}\n`)
  }
  process.stdout.write(`ERGEBNIS ${bestanden} ok, ${fehlgeschlagen} Fehler\n`)
  if (fehlgeschlagen && !process.env.TEST_LAUT) {
    fs.writeFileSync(path.join(lauf, 'konsole.log'), logZeilen.join('\n'))
    process.stdout.write(`  (Konsole: ${path.join(lauf, 'konsole.log')})\n`)
  }
  process.exit(fehlgeschlagen ? 1 : 0)
})()
