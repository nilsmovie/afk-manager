// Dashboard mit mehreren Servern: Chat und Chat-Quelle pro Server, Discord-Spiegel und
// Erweiterungen nur vom Standardserver, Erweiterung kann über einen weiteren Server senden,
// Bedienung im Browser (Server-Zeilen, "+ Server", Chat-Umschalter)
const EXT = `module.exports = (api) => {
  const zeilen = []
  api.onChat((e) => zeilen.push(e))
  api.app.get('/api/test-chat', api.requireOwner, (req, res) => res.json(zeilen))
  api.app.post('/api/test-senden', api.requireOwner, (req, res) => res.json(api.sendChatMessage(req.body.account, req.body.text, req.body.server)))
  api.app.get('/api/test-online', api.requireOwner, (req, res) => res.json({ std: api.isAccountOnline('alpha'), lobby: api.isAccountOnline('alpha', 'lobby'), server: api.getServers().map((s) => s.id) }))
}`
module.exports = {
  name: 'Dashboard mit mehreren Servern',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }, { username: '.bed' }],
  dateien: {
    'erweiterungen/test.js': EXT,
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [{ id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] }, { id: 'event', name: 'Event-Server', host: 'event.test', javaPort: 25565, bedrockPort: null, autoChatTemplate: [] }] },
    'verbindungen.json': { version: 1, connections: [{ username: 'alpha', server: 'lobby', everJoined: true, autoChat: [{ text: '/afk', delaySeconds: 1 }] }, { username: 'bravo', server: 'lobby', everJoined: true }] },
  },
  async run (t) {
    const bot = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user).slice(-1)[0]
    t.chk('Alle verbinden', await t.alleEinloggenBis(async () => {
      const l = await t.liste()
      return l.every((a) => a.status === 'online' && a.connections.every((c) => c.status === 'online'))
    }, 300000))
    const cs = async () => (await t.api('GET', '/api/chat-state')).data
    let st = await cs()
    t.chk('Chat-Status pro Server', st.servers.standard.primary === 'alpha' && st.servers.lobby.primary === 'alpha@lobby' && st.servers.lobby.active === true && st.servers.event.primary === null, st.servers)

    // Chat pro Server
    bot('lobby.test', 'alpha').chatEmpfangen('[Lobby] Bob: hallo lobby')
    bot('lobby.test', 'bravo').chatEmpfangen('[Lobby] Bob: hallo lobby')
    bot('mc.test', 'alpha').chatEmpfangen('[Spieler] Bob: hallo standard')
    await t.warte(4000)
    st = await cs()
    const lob = st.history.filter((h) => /hallo lobby/.test(h.text))
    t.chk('Lobby-Chat genau einmal, mit Server', lob.length === 1 && lob[0].server === 'lobby' && lob[0].username === 'alpha@lobby', lob)
    t.chk('Standard-Chat mit Server', st.history.some((h) => /hallo standard/.test(h.text) && h.server === 'standard'))
    t.chk('Discord-Chat-Spiegel nur vom Standardserver', t.discord.nachrichten('CHAT').some((m) => /hallo standard/.test(m.content)) && !t.discord.nachrichten('CHAT').some((m) => /hallo lobby/.test(m.content)))
    const ext = (await t.api('GET', '/api/test-chat')).data
    t.chk('Erweiterung bekommt nur den Standardserver (mit Feld server)', ext.some((e) => /hallo standard/.test(e.text) && e.server === 'standard') && !ext.some((e) => /hallo lobby/.test(e.text)), ext)

    // Stern pro Server
    let r = await t.api('POST', '/api/accounts/bravo%40lobby/make-primary')
    t.chk('Stern auf bravo@lobby', r.status === 200 && (await cs()).servers.lobby.primary === 'bravo@lobby', r.data)
    t.chk('Standardserver bleibt bei alpha', (await cs()).servers.standard.primary === 'alpha')
    t.chk('Stern gespeichert', t.datei('verbindungen.json').connections.find((c) => c.username === 'bravo').preferredChatSource === true && !t.datei('accounts.json').find((a) => a.username === 'bravo').preferredChatSource)
    bot('lobby.test', 'bravo').trennen()
    t.chk('Fällt die Quelle aus, übernimmt alpha@lobby', await t.warteBis(async () => (await cs()).servers.lobby.primary === 'alpha@lobby', 5000), (await cs()).servers)
    await t.alleEinloggenBis(async () => (await cs()).servers.lobby.primary === 'bravo@lobby', 200000)
    t.chk('...und bravo@lobby kommt als Quelle zurück', (await cs()).servers.lobby.primary === 'bravo@lobby')
    const liste = await t.liste()
    t.chk('Liste markiert die Quelle pro Server', liste.find((a) => a.username === 'bravo').connections[0].isPrimary === true && liste.find((a) => a.username === 'alpha').connections[0].isPrimary === false && liste.find((a) => a.username === 'alpha').isPrimary === true)

    // Erweiterung: optionaler Server
    r = await t.api('POST', '/api/test-senden', { account: 'alpha', text: '/msg x lobby', server: 'lobby' })
    t.chk('Erweiterung sendet über den weiteren Server', r.data.ok === true && bot('lobby.test', 'alpha').gesendet.includes('/msg x lobby') && !bot('mc.test', 'alpha').gesendet.includes('/msg x lobby'), r.data)
    r = await t.api('POST', '/api/test-senden', { account: 'alpha', text: '/msg x std' })
    t.chk('...ohne Server wie bisher', r.data.ok === true && bot('mc.test', 'alpha').gesendet.includes('/msg x std'))
    r = await t.api('GET', '/api/test-online')
    t.chk('isAccountOnline mit Server, getServers', r.data.std === true && r.data.lobby === true && r.data.server.join() === 'standard,lobby,event', r.data)

    // Steuerung über eine Verbindung
    r = await t.api('POST', '/api/control/alpha%40lobby/hotbar', { slot: 4 })
    t.chk('Steuerung einer Verbindung', r.status === 200 && bot('lobby.test', 'alpha').steuerung.some((x) => x[0] === 'hotbar' && x[1] === 4) && !bot('mc.test', 'alpha').steuerung.some((x) => x[0] === 'hotbar' && x[1] === 4))

    // ---------- Im Browser ----------
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })
    // Der Browser-Teil braucht Playwright mit Chromium - fehlt das (z.B. auf dem Server, auf dem
    // der Manager laeuft), wird er uebersprungen statt als Fehler gezaehlt
    let chromium
    try {
      ({ chromium } = require('playwright'))
    } catch (_) {
      console.log('  --    Browser-Test übersprungen (Playwright nicht installiert, nur für Entwickler nötig)')
      return
    }
    let browser
    try {
      browser = await chromium.launch()
    } catch (e) {
      console.log(`  --    Browser-Test übersprungen (Chromium startet nicht: ${String(e.message).split('\n')[0]})`)
      return
    }
    const oeffnen = async (user, pw, breite) => {
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pw }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1000 }, deviceScaleFactor: 1 })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (e) => fehler.push(e.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      await p.waitForTimeout(1500)
      return { p, ctx, fehler }
    }
    const shot = process.env.TEST_SCREENSHOTS
    let { p, ctx, fehler } = await oeffnen('nils', 'testpw', 1280)
    t.chk('Seite ohne JS-Fehler', fehler.length === 0, fehler)
    t.chk('Server-Zeilen beim Account', (await p.$$eval('.conn-row', (els) => els.length)) === 2)
    t.chk('Chat-Umschalter sichtbar (Standard + Lobby)', await p.$eval('#chatServerSelect', (el) => el.style.display !== 'none' && Array.from(el.options).map((o) => o.value).join()) === 'standard,lobby')
    t.chk('Standard-Chat sichtbar, Lobby-Chat nicht', await p.$eval('#chatlog', (el) => /hallo standard/.test(el.textContent) && !/hallo lobby/.test(el.textContent)))
    await p.selectOption('#chatServerSelect', 'lobby')
    await p.waitForTimeout(300)
    t.chk('Umschalten zeigt den Lobby-Chat', await p.$eval('#chatlog', (el) => /hallo lobby/.test(el.textContent) && !/hallo standard/.test(el.textContent)))
    t.chk('Kopf nennt die Lobby-Quelle', /\(bravo\)/.test(await p.$eval('#chatPrimaryInfo', (el) => el.textContent)), await p.$eval('#chatPrimaryInfo', (el) => el.textContent))
    t.chk('Senden-Auswahl: nur Lobby-Verbindungen', (await p.$eval('#chatAccountSelect', (el) => Array.from(el.options).map((o) => o.value).join())) === 'alpha@lobby,bravo@lobby')
    await p.fill('#chatInput', 'aus dem browser')
    await p.click('#sendChatBtn')
    await p.waitForTimeout(500)
    t.chk('Senden über die gewählte Verbindung', bot('lobby.test', 'alpha').gesendet.includes('aus dem browser') && !bot('mc.test', 'alpha').gesendet.includes('aus dem browser'))
    bot('lobby.test', 'bravo').chatEmpfangen('[Lobby] Eve: live <b>x</b>')
    await p.waitForTimeout(800)
    t.chk('Neue Lobby-Zeile live, HTML nur als Text', await p.$eval('#chatlog', (el) => /live <b>x<\/b>/.test(el.textContent) && !el.querySelector('b')))
    t.chk('Steuerung: Verbindungen mit Servername', (await p.$eval('#controlAccountSelect', (el) => Array.from(el.options).map((o) => o.textContent).join('|'))) === 'alpha|alpha (Lobby)|bravo|bravo (Lobby)')
    // "+ Server": bravo -> Event-Server
    const bravoRow = p.locator('.account-row', { hasText: 'bravo' }).first()
    await bravoRow.locator('button', { hasText: '+ Server' }).click()
    await p.waitForTimeout(200)
    t.chk('"+ Server" bietet nur freie Server an', (await bravoRow.locator('select').evaluate((el) => Array.from(el.options).map((o) => o.value).join())) === 'event')
    if (shot) await p.locator('.layout').screenshot({ path: `${shot}/dashboard-breit.png` })
    await bravoRow.locator('button', { hasText: 'Hinzufügen und starten' }).click()
    t.chk('Verbindung über den Browser angelegt und gestartet', await t.warteBis(() => bot('event.test', 'bravo'), 30000))
    bot('event.test', 'bravo').einloggen()
    await p.waitForTimeout(800)
    t.chk('Neue Server-Zeile erscheint', (await p.$$eval('.conn-row', (els) => els.length)) === 3)
    t.chk('Statusleiste zählt alle Verbindungen', /\/ 6 online/.test(await p.$eval('#statusStripText', (el) => el.textContent)), await p.$eval('#statusStripText', (el) => el.textContent))
    await ctx.close()

    // Handy-Breite + User-Rolle
    ;({ p, ctx, fehler } = await oeffnen('paul', 'geheim123', 390))
    t.chk('User: sieht seine Server-Zeile, ohne Verwaltungsknöpfe', (await p.$$eval('.conn-row', (els) => els.length)) === 1 && (await p.$$('button[title="Von diesem Server entfernen"]')).length === 0 && (await p.$$('text=+ Server')).length === 0)
    t.chk('User: keine JS-Fehler', fehler.length === 0, fehler)
    const breite = await p.evaluate(() => document.documentElement.scrollWidth)
    t.chk('Handy: kein seitliches Scrollen', breite <= 390, breite)
    if (shot) await p.screenshot({ path: `${shot}/dashboard-handy-user.png`, fullPage: false })
    await ctx.close()
    ;({ p, ctx } = await oeffnen('nils', 'testpw', 390))
    if (shot) await p.locator('#accountList').screenshot({ path: `${shot}/dashboard-handy.png` })
    t.chk('Handy (Owner): kein seitliches Scrollen', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390)
    await ctx.close()
    await browser.close()
  },
}
