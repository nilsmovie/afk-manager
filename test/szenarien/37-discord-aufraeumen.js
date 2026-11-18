// "npm run discord-aufraeumen": löscht nur Nachrichten des AFK-Managers (Bot und seine Webhooks)
// im Zeitraum; zuerst nur anzeigen; paketweise, ohne Recht einzeln, Webhook-Nachrichten über den
// Webhook. Gegen ein nachgebautes Discord (lokaler HTTP-Server).
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const BOT = '900000000000000001'
const HOOK = '900000000000000002'
const HOOK_TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'
const KANAL = '1528570358175764512'
const EPOCH = 1420070400000
const sf = (ms, n) => String((BigInt(ms - EPOCH) << 22n) + BigInt(n))

function fakeDiscord ({ verwalten }) {
  const msgs = []
  const log = { bulk: 0, einzeln: 0, webhook: 0, abgelehnt: 0 }
  const add = (ms, autor, extra = {}) => {
    const n = msgs.length
    msgs.push({ id: sf(ms, n), timestamp: new Date(ms).toISOString(), author: { id: autor }, content: `Meldung ${n}`, embeds: [], ...extra })
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const send = (code, body) => {
      if (body === undefined) { res.writeHead(code); return res.end() } // 204 wie bei Discord: ohne Inhalt
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const p = u.pathname.replace(/^\/api\/v10/, '')
      if (req.method === 'GET' && p === '/users/@me') return send(200, { id: BOT, username: 'AFK' })
      if (req.method === 'GET' && p === `/channels/${KANAL}/messages`) {
        const before = BigInt(u.searchParams.get('before') || '999999999999999999999')
        const limit = Number(u.searchParams.get('limit') || 50)
        const page = msgs.filter((m) => BigInt(m.id) < before).sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)).slice(0, limit)
        return send(200, page)
      }
      if (req.method === 'POST' && p === `/channels/${KANAL}/messages/bulk-delete`) {
        if (!verwalten) { log.abgelehnt++; return send(403, { message: 'Missing Permissions', code: 50013 }) }
        const ids = JSON.parse(body).messages
        if (ids.length < 2 || ids.length > 100) return send(400, { message: 'bad', code: 50016 })
        for (const id of ids) { const i = msgs.findIndex((m) => m.id === id); if (i >= 0) msgs.splice(i, 1) }
        log.bulk++
        return send(204)
      }
      let m = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(p)
      if (req.method === 'DELETE' && m) {
        const i = msgs.findIndex((x) => x.id === m[2])
        if (i < 0) return send(404, { message: 'Unknown Message', code: 10008 })
        if (msgs[i].author.id !== BOT && !verwalten) return send(403, { message: 'Missing Permissions', code: 50013 })
        msgs.splice(i, 1); log.einzeln++
        return send(204)
      }
      m = /^\/webhooks\/(\d+)\/([\w-]+)\/messages\/(\d+)$/.exec(p)
      if (req.method === 'DELETE' && m) {
        if (m[1] !== HOOK || m[2] !== HOOK_TOKEN || req.headers.authorization) return send(401, { message: 'no', code: 0 })
        const i = msgs.findIndex((x) => x.id === m[3] && x.webhook_id === HOOK)
        if (i < 0) return send(404, { message: 'Unknown Message', code: 10008 })
        msgs.splice(i, 1); log.webhook++
        return send(204)
      }
      send(404, { message: `unbekannt ${req.method} ${p}`, code: 0 })
    })
  })
  return { server, msgs, log, add }
}

module.exports = {
  name: 'Discord aufräumen',
  accounts: [],
  async run (t) {
    const werkzeug = path.join(__dirname, '..', '..', 'tools', 'discord-aufraeumen.js')
    // nicht spawnSync: das nachgebaute Discord läuft in diesem Prozess und muss antworten können
    const lauf = (port, args) => new Promise((resolve) => {
      const c = spawn(process.execPath, [werkzeug, ...args], {
        env: { ...process.env, TZ: 'Europe/Berlin', DISCORD_API_URL: `http://127.0.0.1:${port}/api`, DISCORD_BOT_TOKEN: 'test-token', DISCORD_WEBHOOK_URL: `https://discord.com/api/webhooks/${HOOK}/${HOOK_TOKEN}`, DISCORD_CHAT_WEBHOOK_URL: '' },
        cwd: path.join(__dirname, '..', '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      c.stdout.on('data', (x) => { stdout += x })
      c.stderr.on('data', (x) => { stderr += x })
      c.on('close', (status) => resolve({ status, stdout, stderr }))
    })
    // Zeitraum 18.11.2026 00:01 - 05:00 Ortszeit (UTC+1)
    const t0 = Date.UTC(2026, 10, 17, 23, 1) // 00:01 Ortszeit
    const ende = Date.UTC(2026, 10, 18, 4, 0) // 05:00 Ortszeit
    const vorbereiten = (verwalten) => {
      const d = fakeDiscord({ verwalten })
      d.add(t0 - 60 * 1000, BOT) // 00:00 - davor, bleibt
      for (let i = 0; i < 230; i++) d.add(t0 + i * 60 * 1000, BOT, { content: i % 2 ? '⚠️ alpha wurde gekickt' : '✅ Alle wieder online' })
      for (let i = 0; i < 5; i++) d.add(t0 + 30000 + i * 3600 * 1000, HOOK, { webhook_id: HOOK })
      d.add(t0 + 1000, '123456789012345678', { content: 'Mensch schreibt was' }) // bleibt
      d.add(t0 + 2000, '555555555555555555', { content: 'anderer Bot' }) // bleibt
      d.add(t0 + 3000, '777777777777777777', { webhook_id: '777777777777777777', content: 'fremder Webhook' }) // bleibt
      d.add(ende + 30 * 1000, BOT, { content: 'genau 05:00:30 - gehört noch dazu' })
      d.add(ende + 60 * 1000, BOT) // 05:01 - danach, bleibt
      return d
    }
    const starten = (d) => new Promise((r) => d.server.listen(0, '127.0.0.1', () => r(d.server.address().port)))

    // ---------- Mit "Nachrichten verwalten": Pakete ----------
    let d = vorbereiten(true)
    let port = await starten(d)
    const args = ['--kanal', KANAL, '--von', '18.11.2026 00:01', '--bis', '18.11.2026 05:00']
    let r = await lauf(port, args)
    t.chk('Nur anzeigen: findet 236 Nachrichten (Bot + Webhook)', r.status === 0 && /236 Nachricht\(en\) vom AFK-Manager gefunden \(3 andere Nachrichten im Zeitraum bleiben stehen\)/.test(r.stdout), r.stdout + r.stderr)
    t.chk('Nur anzeigen: Zeitraum in Ortszeit', /18\.11\.2026, 00:01:00 bis 18\.11\.2026, 05:00:59 \(Europe\/Berlin\)/.test(r.stdout), r.stdout)
    t.chk('Nur anzeigen: nichts gelöscht', d.msgs.length === 241 && /Nichts gelöscht/.test(r.stdout))
    r = await lauf(port, [...args, '--loeschen'])
    t.chk('Ohne Bestätigung (kein Terminal): nichts gelöscht', /Abgebrochen/.test(r.stdout) && d.msgs.length === 241, r.stdout)
    r = await lauf(port, [...args, '--loeschen', '--ja'])
    t.chk('Löschen: fertig', r.status === 0 && /Fertig: 236 gelöscht/.test(r.stdout), r.stdout + r.stderr)
    t.chk('Paketweise (3 Pakete)', d.log.bulk === 3 && d.log.einzeln === 0, d.log)
    const rest = d.msgs.map((m) => m.content).sort()
    t.chk('Übrig: vorher/nachher und fremde Nachrichten', d.msgs.length === 5 && rest.includes('Mensch schreibt was') && rest.includes('anderer Bot') && rest.includes('fremder Webhook'), rest)
    d.server.close()

    // ---------- Ohne Recht: einzeln, Webhook über den Webhook ----------
    d = vorbereiten(false)
    port = await starten(d)
    r = await lauf(port, ['--kanal', KANAL, '--von', '2026-11-18 00:01', '--bis', '2026-11-18 05:00', '--loeschen', '--ja'])
    t.chk('Ohne Recht: Hinweis und einzeln gelöscht', r.status === 0 && /darf keine Nachrichten verwalten/.test(r.stdout) && /Fertig: 236 gelöscht/.test(r.stdout), r.stdout + r.stderr)
    t.chk('Ohne Recht: Bot-Nachrichten einzeln, Webhook-Nachrichten über den Webhook', d.log.einzeln === 231 && d.log.webhook === 5 && d.log.abgelehnt === 1, d.log)
    t.chk('Ohne Recht: fremde Nachrichten bleiben', d.msgs.length === 5)
    d.server.close()

    // ---------- Falsche Eingaben ----------
    r = await lauf(1, ['--kanal', 'abc', '--von', '00:01', '--bis', '05:00'])
    t.chk('Falsche Kanal-ID: Hilfe statt Löschen', r.status === 1 && /Aufruf:/.test(r.stdout))
    r = await lauf(1, ['--kanal', KANAL, '--von', '05:00', '--bis', '00:01'])
    t.chk('Ende vor Anfang: Fehler', r.status === 1 && /liegt vor/.test(r.stderr), r.stderr)
    r = await lauf(1, ['--kanal', KANAL, '--von', 'gestern', '--bis', '05:00'])
    t.chk('Unbekanntes Datum: Hilfe', r.status === 1 && /Aufruf:/.test(r.stdout))
  },
}
