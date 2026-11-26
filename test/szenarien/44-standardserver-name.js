// Standardserver: Name und Kürzel in der Verwaltung ändern (Adresse/Ports bleiben in der .env).
// Die Accounts laufen einfach weiter, Discord-Meldungen und das Dashboard nennen den neuen Namen,
// "Name@kürzel" geht in Discord, Prüfungen, Rechte, Protokoll; bleibt nach einem Neustart.
module.exports = {
  name: 'Standardserver: Name und Kürzel ändern',
  phasen: 2,
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [{ text: '/afk', delaySeconds: 5 }] }, servers: [
      { id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] },
    ] },
  },
  async run (t) {
    const standard = async () => (await t.api('GET', '/api/servers')).data.servers.find((s) => s.isDefault)

    if (t.PHASE === 2) {
      const sv = await standard()
      t.chk('Neustart: Name und Kürzel bleiben', sv.name === 'Clash SMP' && sv.tag === 'clash' && sv.id === 'standard', sv)
      t.chk('Neustart: servers.json behält die Vorlage', t.datei('servers.json').defaultServer.autoChatTemplate.length === 1 && t.datei('servers.json').defaultServer.name === 'Clash SMP' && t.datei('servers.json').defaultServer.tag === 'clash', t.datei('servers.json').defaultServer)
      t.chk('Neustart: Start-Meldung mit Namen', await t.warteBis(() => t.discord.nachrichten().some((m) => /Verbindet mit Clash SMP \(mc\.test\)/.test(t.discord.text(m))), 60000), t.discord.nachrichten().map(t.discord.text).filter((x) => /gestartet/.test(x)))
      // Zurück auf die .env: Name wie in der .env und Kürzel "standard" -> nichts Eigenes mehr gespeichert
      const r = await t.api('PUT', '/api/servers/standard', { name: 'mc.test', id: 'standard' })
      t.chk('Zurücksetzen: ok', r.status === 200 && r.data.server.name === 'mc.test' && r.data.server.tag === 'standard', r.data)
      t.chk('Zurücksetzen: servers.json ohne eigenen Namen/Kürzel', !('name' in t.datei('servers.json').defaultServer) && !('tag' in t.datei('servers.json').defaultServer), t.datei('servers.json').defaultServer)
      return
    }

    t.chk('Start: beide online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 120000))
    const vorher = (await standard())
    t.chk('Am Anfang: Name aus der .env, Kürzel "standard"', vorher.name === 'mc.test' && vorher.tag === 'standard', vorher)
    const botsVorher = t.javaBots.length

    // Rechte und Prüfungen
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })
    const put = (body, als) => t.api('PUT', '/api/servers/standard', body, als)
    t.chk('User darf nicht', (await put({ name: 'Hack' }, 'paul')).status === 403)
    for (const [body, name, re] of [
      [{ name: '' }, 'Name leer', /Name fehlt/],
      [{ name: '<b>x</b>' }, 'Name mit Sonderzeichen', /Name: 1-32 Zeichen/],
      [{ name: 'a'.repeat(33) }, 'Name zu lang', /Name: 1-32 Zeichen/],
      [{ name: 'lobby' }, 'Name wie ein anderer Server', /gibt es schon/],
      [{ id: 'Lob!' }, 'Kürzel mit Sonderzeichen', /Kürzel: 1-24 Zeichen/],
      [{ id: 'alle' }, 'Kürzel reserviert', /reserviert/],
      [{ id: 'lobby' }, 'Kürzel eines anderen Servers', /schon vergeben/],
      [{ id: 42 }, 'Kürzel als Zahl', /Ungültiges Kürzel/],
      [{ host: 'anderer.test' }, 'Adresse ändern', /stehen in der \.env/],
      [{ javaPort: 1234 }, 'Port ändern', /stehen in der \.env/],
    ]) {
      const r = await put(body)
      t.chk(`Abgelehnt: ${name}`, r.status === 400 && re.test(r.data.error || ''), r.data)
    }
    t.chk('Abgelehnt: nichts geändert', (await standard()).name === 'mc.test' && !t.datei('servers.json').defaultServer.name)

    // Ändern
    let r = await put({ name: '  Clash SMP ', id: 'CLASH', host: 'mc.test' })
    t.chk('Name und Kürzel geändert', r.status === 200 && r.data.server.name === 'Clash SMP' && r.data.server.tag === 'clash' && r.data.server.id === 'standard', r.data)
    t.chk('servers.json: Name, Kürzel und Vorlage', t.datei('servers.json').defaultServer.name === 'Clash SMP' && t.datei('servers.json').defaultServer.tag === 'clash' && t.datei('servers.json').defaultServer.autoChatTemplate.length === 1, t.datei('servers.json').defaultServer)
    await t.warte(5000)
    t.chk('Accounts laufen einfach weiter (kein Neustart)', t.javaBots.length === botsVorher && (await t.liste()).every((a) => a.status === 'online'))
    t.chk('Weiterer Server darf das Kürzel nicht nehmen', (await t.api('PUT', '/api/servers/lobby', { name: 'Lobby', host: 'lobby.test', javaPort: 25570, id: 'clash' })).status === 400)
    t.chk('Neuer Server darf das Kürzel nicht nehmen', (await t.api('POST', '/api/servers', { name: 'Neu', host: 'neu.test', javaPort: 25565, id: 'clash' })).status === 400)
    t.chk('Neuer Server darf den Namen nicht nehmen', (await t.api('POST', '/api/servers', { name: 'clash smp', host: 'neu.test', javaPort: 25565 })).status === 400)

    // Protokoll
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Änderung', e.some((x) => x.action === 'Server geändert' && /Kürzel @standard → @clash; Name "mc\.test" → "Clash SMP"/.test(x.detail)), e.slice(0, 3))

    // Discord: Name@clash, Name@standard, Name@Servername, ohne @
    for (const [befehl, text] of [['!mc alpha@clash /eins', '/eins'], ['!mc alpha@standard /zwei', '/zwei'], ['!mc alpha@Clash SMP /drei', null], ['!mc alpha /vier', '/vier']]) {
      const b = t.discord.befehl(befehl)
      await t.warte(500)
      if (text) t.chk(`Discord: ${befehl}`, t.java('alpha').gesendet.includes(text) && b.reaktionen.includes('✅'), b)
    }
    // Meldungen nennen den neuen Namen
    const v = t.discord.nachrichten('MELDUNGEN').length
    await t.api('POST', '/api/stop-all')
    t.chk('Discord-Meldung mit neuem Namen', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').slice(v).some((m) => /Alle Accounts offline \(Clash SMP\)/.test(t.discord.text(m))), 10000), t.discord.nachrichten('MELDUNGEN').slice(v).map(t.discord.text))
    await t.api('POST', '/api/start-all')
    await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 120000)

    // Browser: Dashboard-Kopf und Chips, Verwaltung bearbeiten
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { chromium = null }
    if (chromium) {
      const browser = await chromium.launch()
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, val] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: 390, height: 1200 } })
      await ctx.addCookies([{ name: k, value: val, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      await p.waitForSelector('.account-row')
      const kopf = await p.evaluate(() => ({ titel: document.title, sub: (document.querySelector('.sub') || {}).textContent }))
      t.chk('Dashboard: Kopf "Hauptserver: Clash SMP (mc.test)"', /Hauptserver: Clash SMP \(mc\.test\)/.test(kopf.sub) && /Clash SMP/.test(kopf.titel), kopf)
      t.chk('Dashboard: Server-Übersicht mit Namen', await p.waitForFunction(() => /Clash SMP/.test(document.body.textContent) && !/\bmc\.test\s+\d+ \/ \d+ online/.test(document.body.textContent), null, { timeout: 5000 * 40 }).then(() => true, () => false))

      await p.goto(`http://127.0.0.1:${process.env.PORT}/admin`)
      await p.waitForSelector('#serverList .user-row')
      const zeile = p.locator('#serverList .user-row', { hasText: 'Standardserver' })
      t.chk('Verwaltung: Standardserver mit Kürzel @clash', /Clash SMP\s*@clash/.test(await zeile.locator('.user-name').textContent()))
      await zeile.locator('button', { hasText: 'Bearbeiten' }).click()
      t.chk('Verwaltung: Felder für Name und Kürzel, keine für Adresse', (await zeile.locator('input[id^="srvEditName-"]').inputValue()) === 'Clash SMP' && (await zeile.locator('input[id^="srvEditId-"]').inputValue()) === 'clash' && (await zeile.locator('input[id^="srvEditHost-"]').count()) === 0)
      await zeile.locator('input[id^="srvEditName-"]').fill('ClashSMP')
      await zeile.locator('button', { hasText: 'Speichern' }).click()
      let ok = false
      for (let i = 0; i < 40 && !ok; i++) { await p.waitForTimeout(100); ok = t.datei('servers.json').defaultServer.name === 'ClashSMP' }
      t.chk('Verwaltung: gespeichert ohne Rückfrage', ok)
      t.chk('Verwaltung: Liste zeigt den neuen Namen', await p.waitForSelector('#serverList .user-name:has-text("ClashSMP")', { timeout: 5000 }).then(() => true).catch(() => false))
      // Fehler wird angezeigt
      const z2 = p.locator('#serverList .user-row', { hasText: 'Standardserver' })
      if (!(await z2.locator('input[id^="srvEditId-"]').isVisible())) await z2.locator('button', { hasText: 'Bearbeiten' }).click()
      await z2.locator('input[id^="srvEditId-"]').fill('lobby')
      await z2.locator('button', { hasText: 'Speichern' }).click()
      t.chk('Verwaltung: Fehler wird angezeigt', await p.waitForFunction(() => [...document.querySelectorAll('.error-msg')].some((e) => /schon vergeben/.test(e.textContent)), null, { timeout: 5000 * 40 }).then(() => true, () => false))
      t.chk('Verwaltung: keine JS-Fehler', fehler.length === 0, fehler)
      await browser.close()
      r = await put({ name: 'Clash SMP' })
      t.chk('Für Phase 2 wieder "Clash SMP"', r.status === 200)
    } else {
      console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)')
    }
  },
}
