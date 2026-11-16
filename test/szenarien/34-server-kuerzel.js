// Kürzel eines weiteren Servers ändern: Verbindungen ziehen mit allem um (Einstellungen, Online-
// Zeit, Auto-Chat, gestoppt-Merker), laufende Verbindungen starten neu, Discord nimmt das neue
// Kürzel; Prüfungen, Rechte, Protokoll; bleibt nach einem Neustart
module.exports = {
  name: 'Server-Kürzel ändern',
  phasen: 2,
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [
      { id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] },
      { id: 'zwei', name: 'Zwei', host: 'zwei.test', javaPort: 25565, bedrockPort: null, autoChatTemplate: [] },
    ] },
    'verbindungen.json': { version: 1, connections: [
      { username: 'alpha', server: 'lobby', everJoined: true, autoChat: [{ text: '/lobby-afk', delaySeconds: 1 }] },
      { username: 'bravo', server: 'lobby', everJoined: true, autoChat: [], stopped: true },
    ] },
  },
  async run (t) {
    const bot = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user).slice(-1)[0]
    const bots = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user)
    const conn = async (key) => {
      for (const a of await t.liste()) {
        const c = (a.connections || []).find((x) => x.key === key)
        if (c) return c
      }
      return null
    }

    if (t.PHASE === 2) {
      t.chk('Neustart: Server heißt weiter @lob', (t.datei('servers.json').servers.find((s) => s.name === 'Lobby') || {}).id === 'lob')
      t.chk('Neustart: alpha@lob startet wieder', await t.alleEinloggenBis(async () => !!bot('lobby.test', 'alpha'), 120000))
      t.chk('Neustart: bravo@lob bleibt gestoppt', !bot('lobby.test', 'bravo') && (await conn('bravo@lob')).status === 'gestoppt')
      return
    }

    t.chk('Start: alpha@lobby verbindet', await t.alleEinloggenBis(async () => (await conn('alpha@lobby')) && (await conn('alpha@lobby')).status === 'online', 120000))
    t.chk('bravo@lobby bleibt gestoppt', !bot('lobby.test', 'bravo'))
    await t.warte(3000)
    t.chk('Auto-Chat läuft auf @lobby', bot('lobby.test', 'alpha').gesendet.includes('/lobby-afk'))
    await t.warte(5 * 60 * 1000)
    const vorher = (await conn('alpha@lobby')).uptimeMs
    t.chk('Online-Zeit läuft', vorher >= 4 * 60 * 1000, vorher)

    // Prüfungen
    const put = (body, als) => t.api('PUT', '/api/servers/lobby', { name: 'Lobby', host: 'lobby.test', javaPort: 25570, ...body }, als)
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })
    await t.api('POST', '/api/users', { username: 'toni', password: 'geheim123', role: 'admin', allowedAccounts: [] })
    t.chk('User darf das Kürzel nicht ändern', (await put({ id: 'lob' }, 'paul')).status === 403)
    for (const [id, name, re] of [
      ['Lob!', 'Sonderzeichen', /Kürzel: 1-24 Zeichen/],
      ['-lob', 'Bindestrich am Anfang', /Kürzel: 1-24 Zeichen/],
      ['a'.repeat(25), 'zu lang', /Kürzel: 1-24 Zeichen/],
      ['alle', 'reserviert (alle)', /reserviert/],
      ['standard', 'reserviert (standard)', /reserviert/],
      ['zwei', 'schon vergeben', /schon vergeben/],
      [42, 'Zahl statt Text', /Ungültiges Kürzel/],
    ]) {
      const r = await put({ id })
      t.chk(`Abgelehnt: ${name}`, r.status === 400 && re.test(r.data.error || ''), r.data)
    }
    t.chk('Abgelehnt: nichts geändert', t.datei('servers.json').servers.some((s) => s.id === 'lobby') && !!(await conn('alpha@lobby')))
    let r = await put({ id: 'lobby' })
    t.chk('Gleiches Kürzel: einfach ok', r.status === 200 && !r.data.moved, r.data)

    // Ändern (als Admin, Großbuchstaben werden klein)
    const alt = bot('lobby.test', 'alpha')
    const anzahl = bots('lobby.test', 'alpha').length
    r = await put({ id: 'LOB' }, 'toni')
    t.chk('Kürzel geändert', r.status === 200 && r.data.server.id === 'lob' && r.data.moved && r.data.moved.connections === 2 && r.data.moved.restarted === 1, r.data)
    t.chk('servers.json: neues Kürzel', t.datei('servers.json').servers.some((s) => s.id === 'lob') && !t.datei('servers.json').servers.some((s) => s.id === 'lobby'))
    t.chk('verbindungen.json: Verbindungen umgezogen', t.datei('verbindungen.json').connections.every((c) => c.server === 'lob'), t.datei('verbindungen.json'))
    t.chk('Alte Verbindung getrennt', await t.warteBis(() => alt.beendet, 5000))
    t.chk('Liste: nur noch @lob', !!(await conn('alpha@lob')) && !(await conn('alpha@lobby')) && !!(await conn('bravo@lob')))
    t.chk('Laufende Verbindung startet neu', await t.warteBis(() => bots('lobby.test', 'alpha').length === anzahl + 1, 60000))
    bot('lobby.test', 'alpha').einloggen()
    t.chk('...und ist wieder online', await t.warteBis(async () => (await conn('alpha@lob')).status === 'online', 5000))
    await t.warte(3000)
    t.chk('Auto-Chat zieht mit um', bot('lobby.test', 'alpha').gesendet.includes('/lobby-afk'))
    t.chk('Online-Zeit zieht mit um', (await conn('alpha@lob')).uptimeMs >= vorher, [(await conn('alpha@lob')).uptimeMs, vorher])
    t.chk('Gestoppte Verbindung bleibt gestoppt', !bot('lobby.test', 'bravo') && (await conn('bravo@lob')).status === 'gestoppt' && t.datei('verbindungen.json').connections.find((c) => c.username === 'bravo').stopped === true)
    t.chk('Standardserver unberührt', (await t.liste()).find((a) => a.username === 'alpha').status === 'online')
    t.chk('User sieht seine Verbindung unter dem neuen Kürzel', ((await t.liste('paul')).find((a) => a.username === 'alpha').connections || []).some((c) => c.key === 'alpha@lob'))

    // Discord nimmt das neue Kürzel
    let b = t.discord.befehl('!mc alpha@lob /neu')
    await t.warte(500)
    t.chk('Discord: !mc alpha@lob', bot('lobby.test', 'alpha').gesendet.includes('/neu') && b.reaktionen.includes('✅'), b)
    b = t.discord.befehl('!mc alpha@Lobby /name')
    await t.warte(500)
    t.chk('Discord: Servername geht weiterhin', bot('lobby.test', 'alpha').gesendet.includes('/name'), b)
    b = t.discord.befehl('!mc alpha@zwei /falsch')
    await t.warte(500)
    t.chk('Discord: anderer Server bleibt getrennt', !bot('lobby.test', 'alpha').gesendet.includes('/falsch'))

    // Protokoll
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Kürzel-Änderung', e.some((x) => x.action === 'Server geändert' && x.who === 'toni' && /Kürzel @lobby → @lob \(2 Verbindung\(en\), 1 neu gestartet\)/.test(x.detail)), e.slice(0, 4))
    t.chk('Chat-Log: Hinweis', t.logEnthaelt(/\[alpha@lob\] --- Server-Kürzel geändert: @lobby → @lob ---/))

    // Verwaltung im Browser: Kürzel im Bearbeiten-Bereich ändern (mit Rückfrage)
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { chromium = null }
    if (chromium) {
      const browser = await chromium.launch()
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: 390, height: 1200 } })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/admin`)
      await p.waitForSelector('#serverList .user-row')
      const zeile = p.locator('#serverList .user-row', { hasText: 'Lobby' })
      await zeile.locator('button', { hasText: 'Bearbeiten' }).click()
      const feld = zeile.locator('input[id^="srvEditId-"]')
      t.chk('Browser: Kürzel-Feld zeigt das aktuelle Kürzel', (await feld.inputValue()) === 'lob')
      await feld.fill('lobby2')
      await zeile.locator('button', { hasText: 'Speichern' }).click()
      await p.waitForSelector('#msgOverlay.open, .overlay.open', { timeout: 3000 }).catch(() => {})
      const frage = await p.evaluate(() => (document.querySelector('.overlay.open, #msgOverlay.open') || {}).textContent || '')
      t.chk('Browser: Rückfrage wegen Neustart der Verbindungen', /@lob auf @lobby2/.test(frage) && /2 Verbindungen/.test(frage), frage.slice(0, 200))
      await p.click('#msgOk')
      let neu = false
      for (let i = 0; i < 30 && !neu; i++) { await p.waitForTimeout(100); neu = t.datei('servers.json').servers.some((sv) => sv.id === 'lobby2') }
      t.chk('Browser: gespeichert', neu)
      t.chk('Browser: Liste zeigt @lobby2', await p.waitForSelector('#serverList .srv-id:has-text("@lobby2")', { timeout: 5000 }).then(() => true).catch(() => false))
      t.chk('Browser: keine JS-Fehler', fehler.length === 0, fehler)
      await browser.close()
      // für Phase 2 wieder @lob
      const r2 = await t.api('PUT', '/api/servers/lobby2', { name: 'Lobby', host: 'lobby.test', javaPort: 25570, id: 'lob' })
      t.chk('Zurück auf @lob', r2.status === 200)
      t.chk('Startet wieder', await t.alleEinloggenBis(async () => {
        const c = await conn('alpha@lob')
        const b2 = bot('lobby.test', 'alpha')
        return c && c.status === 'online' && b2 && !b2.beendet && bots('lobby.test', 'alpha').length >= anzahl + 2
      }, 120000))
    } else {
      console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)')
    }
    await t.warte(65 * 1000) // Statistik wird jede Minute gespeichert
  },
}
