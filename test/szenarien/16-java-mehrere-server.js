// Java auf mehreren Servern: Verbindung anlegen/entfernen, eigener Zielserver, Auto-Chat-Vorlage
// und everJoined pro Verbindung, Kicks pro Server gesammelt, Rechte, Statistik, gemeinsamer
// Microsoft-Login (nie zwei Logins für denselben Account gleichzeitig), Umbenennen, Neustart
module.exports = {
  name: 'Java auf mehreren Servern',
  phasen: 2,
  accounts: [
    { username: 'alpha', everJoined: true, autoChat: [{ text: '/hub', delaySeconds: 1 }] },
    { username: 'bravo', everJoined: true },
    { username: '.bed' },
  ],
  async run (t) {
    const bot = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user).slice(-1)[0]
    const bots = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user)
    const conn = async (acc, key, als) => ((await t.liste(als)).find((a) => a.username === acc) || { connections: [] }).connections.find((c) => c.key === key)

    if (t.PHASE === 2) {
      // Neustart: Verbindungen bleiben, starten in Listenreihenfolge, Auto-Chat (schon mal drin) kommt
      await t.warteBis(() => bot('mc.test', 'alpha'), 30000)
      t.chk('Neustart: erst der Standardserver', !bot('lobby.test', 'alpha'))
      bot('mc.test', 'alpha').einloggen()
      t.chk('Neustart: alpha2@lobby startet mit', await t.warteBis(() => bot('lobby.test', 'alpha'), 60000))
      const l = await t.liste()
      t.chk('Neustart: Verbindung in der Liste', l.find((a) => a.username === 'alpha2').connections.length === 1, l)
      bot('lobby.test', 'alpha').einloggen()
      await t.warte(3000)
      t.chk('Neustart: Auto-Chat auf dem weiteren Server', bot('lobby.test', 'alpha').gesendet.includes('/lobby-afk'), bot('lobby.test', 'alpha').gesendet)
      return
    }

    for (const n of ['alpha', 'bravo']) {
      await t.warteBis(() => bot('mc.test', n), 30000)
      bot('mc.test', n).einloggen()
    }
    await t.warteBis(() => t.bedrock('bed'), 30000)
    t.bedrock('bed').spawn()

    let r = await t.api('POST', '/api/servers', { name: 'Lobby', id: 'lobby', host: 'lobby.test', javaPort: 25570 })
    await t.api('POST', '/api/servers', { name: 'Zwei', id: 'zwei', host: 'zwei.test', javaPort: 25565, bedrockPort: 19132 })
    await t.api('POST', '/api/servers/lobby/autochat', { text: '/lobby-afk', delaySeconds: 1 })
    await t.api('POST', '/api/users', { username: 'toni', password: 'geheim123', role: 'admin', allowedAccounts: [] })
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })

    // Anlegen: Prüfungen
    t.chk('User: Verbindung anlegen verboten', (await t.api('POST', '/api/accounts/alpha/connections', { server: 'lobby' }, 'paul')).status === 403)
    t.chk('Unbekannter Server', (await t.api('POST', '/api/accounts/alpha/connections', { server: 'gibtsnicht' })).status === 404)
    t.chk('Unbekannter Account', (await t.api('POST', '/api/accounts/nix/connections', { server: 'lobby' })).status === 404)
    t.chk('Standardserver abgelehnt', (await t.api('POST', '/api/accounts/alpha/connections', { server: 'standard' })).status === 400)
    r = await t.api('POST', '/api/accounts/.bed/connections', { server: 'lobby' })
    t.chk('Bedrock: Server ohne Bedrock-Port abgelehnt', r.status === 400 && /Bedrock-Port/.test(r.data.error), r.data)
    r = await t.api('POST', '/api/accounts/.bed/connections', { server: 'zwei' })
    t.chk('Bedrock: ausgeschaltet (MULTI_SERVER_BEDROCK)', r.status === 400 && /MULTI_SERVER_BEDROCK/.test(r.data.error), r.data)

    // Anlegen und starten
    r = await t.api('POST', '/api/accounts/alpha/connections', { server: 'lobby' }, 'toni')
    t.chk('Admin legt alpha@lobby an', r.status === 200 && r.data.key === 'alpha@lobby', r.data)
    t.chk('Doppelt abgelehnt', (await t.api('POST', '/api/accounts/alpha/connections', { server: 'lobby' })).status === 400)
    t.chk('Startet auf dem anderen Server mit demselben Login', await t.warteBis(() => bot('lobby.test', 'alpha'), 30000))
    t.chk('...Port des Servers', bot('lobby.test', 'alpha').opts.port === 25570, bot('lobby.test', 'alpha').opts)
    t.chk('verbindungen.json geschrieben', (t.datei('verbindungen.json') || { connections: [] }).connections.some((c) => c.username === 'alpha' && c.server === 'lobby'))
    t.chk('accounts.json bleibt im alten Format', !t.datei('accounts.json').some((a) => a.connections || a.server))
    bot('lobby.test', 'alpha').einloggen()
    t.chk('alpha@lobby online', await t.warteBis(async () => ((await conn('alpha', 'alpha@lobby')) || {}).status === 'online', 5000), await conn('alpha', 'alpha@lobby'))
    t.chk('alpha auf dem Standardserver bleibt online', (await t.status('alpha')) === 'online')
    await t.warte(3000)
    t.chk('Erster Join auf dem neuen Server: kein Auto-Chat', !bot('lobby.test', 'alpha').gesendet.includes('/lobby-afk'), bot('lobby.test', 'alpha').gesendet)
    t.chk('Vorlage wurde übernommen', JSON.stringify((await conn('alpha', 'alpha@lobby')).autoChat) === '[{"text":"/lobby-afk","delaySeconds":1}]')
    t.chk('everJoined pro Verbindung gespeichert', t.datei('verbindungen.json').connections.find((c) => c.username === 'alpha').everJoined === true)

    // Reconnect auf dem weiteren Server -> jetzt mit Auto-Chat
    bot('lobby.test', 'alpha').trennen()
    t.chk('Reconnect auf lobby', await t.warteBis(() => bots('lobby.test', 'alpha').length === 2, 120000))
    bot('lobby.test', 'alpha').einloggen()
    await t.warte(3000)
    t.chk('Auto-Chat nach Reconnect (nur die Vorlage, nicht /hub)', bot('lobby.test', 'alpha').gesendet.includes('/lobby-afk') && !bot('lobby.test', 'alpha').gesendet.includes('/hub'), bot('lobby.test', 'alpha').gesendet)
    t.chk('Standardserver unberührt (kein neuer Bot)', bots('mc.test', 'alpha').length === 1)

    // Auto-Chat und Glocke pro Verbindung über die bekannten Wege
    r = await t.api('POST', '/api/accounts/alpha%40lobby/autochat', { text: '/extra', delaySeconds: 2 })
    t.chk('Auto-Chat einer Verbindung ändern', r.status === 200 && t.datei('verbindungen.json').connections[0].autoChat.length === 2 && t.datei('accounts.json').find((a) => a.username === 'alpha').autoChat.length === 1, r.data)
    r = await t.api('POST', '/api/accounts/alpha%40lobby/notify-elsewhere', { enabled: true })
    t.chk('Glocke einer Verbindung', r.status === 200 && t.datei('verbindungen.json').connections[0].notifyElsewhere === true)

    // Rechte: User mit alpha darf auch alpha@lobby bedienen
    t.chk('User sieht seine Verbindung', !!(await conn('alpha', 'alpha@lobby', 'paul')))
    await t.api('POST', '/api/accounts/bravo/connections', { server: 'lobby' })
    await t.warteBis(() => bot('lobby.test', 'bravo'), 30000)
    bot('lobby.test', 'bravo').einloggen()
    t.chk('User: fremde Verbindung stoppen verboten', (await t.api('POST', '/api/stop/bravo%40lobby', undefined, 'paul')).status === 403)
    t.chk('User: Chat über eigene Verbindung', (await t.api('POST', '/api/chat', { username: 'alpha@lobby', message: 'hi lobby' }, 'paul')).status === 200 && bot('lobby.test', 'alpha').gesendet.includes('hi lobby'))
    t.chk('Chat landet nicht auf dem Standardserver', !bot('mc.test', 'alpha').gesendet.includes('hi lobby'))

    // Kicks: pro Server gesammelt
    const vorher = t.discord.nachrichten('MELDUNGEN').length
    bot('lobby.test', 'alpha').kick('Server is restarting')
    bot('lobby.test', 'bravo').kick('Server is restarting')
    await t.warte(10000)
    const neu = t.discord.nachrichten('MELDUNGEN').slice(vorher).map((m) => t.discord.text(m))
    t.chk('Eine Sammelmeldung mit Servername', neu.some((x) => /2 Accounts wurden gekickt \(Lobby\)/.test(x) && /alpha, bravo/.test(x)), neu)
    t.chk('Kein "Alle offline" (Standardserver ist ja online)', !neu.some((x) => /Alle Accounts offline/.test(x)), neu)
    bot('mc.test', 'bravo').kick('Kicked for spamming')
    await t.warte(10000)
    const neu2 = t.discord.nachrichten('MELDUNGEN').slice(vorher).map((m) => t.discord.text(m))
    t.chk('Kick auf dem Standardserver: eigene Meldung ohne Servername', neu2.some((x) => /bravo wurde gekickt/.test(x) && !/Lobby/.test(x)), neu2)
    t.chk('Alle drei kommen wieder', await t.alleEinloggenBis(() => bots('lobby.test', 'alpha').length === 3 && bots('lobby.test', 'bravo').length === 2 && bots('mc.test', 'bravo').length === 2, 300000))

    // Statistik pro Verbindung
    await t.warte(5 * 60 * 1000)
    const l = await t.liste()
    const a = l.find((x) => x.username === 'alpha')
    t.chk('Online-Zeit pro Verbindung getrennt', a.uptimeMs > a.connections[0].uptimeMs && a.connections[0].uptimeMs > 60000, { std: a.uptimeMs, lobby: a.connections[0].uptimeMs })

    // Gemeinsamer Microsoft-Login: bravo braucht einen Code -> bravo@zwei wartet
    await t.api('POST', '/api/stop/bravo')
    r = await t.api('POST', '/api/accounts/bravo/connections', { server: 'zwei', start: false })
    t.chk('Anlegen ohne Start', r.status === 200 && r.data.started === false)
    await t.warte(5000)
    t.chk('...startet nicht von selbst', !bot('zwei.test', 'bravo'))
    await t.api('POST', '/api/start/bravo')
    await t.warteBis(() => bots('mc.test', 'bravo').length === 3, 30000)
    bot('mc.test', 'bravo').code({ user_code: 'BRAVO1', expires_in: 300 })
    await t.warteBis(async () => /Login nötig/.test(await t.status('bravo')), 5000)
    await t.api('POST', '/api/start/bravo%40zwei')
    await t.warte(30000)
    t.chk('Zweite Verbindung wartet auf den Login (kein zweiter Code)', !bot('zwei.test', 'bravo'))
    t.chk('...und sagt das', /Wartet auf den Microsoft-Login/.test((await conn('bravo', 'bravo@zwei')).status), await conn('bravo', 'bravo@zwei'))
    bot('mc.test', 'bravo').einloggen()
    t.chk('Nach dem Login startet die zweite Verbindung', await t.warteBis(() => bot('zwei.test', 'bravo'), 60000))
    bot('zwei.test', 'bravo').einloggen()

    // Alle stoppen / starten umfasst alle Server
    await t.api('POST', '/api/stop-all')
    await t.warte(2000)
    const l2 = await t.liste()
    t.chk('Alle stoppen: auch weitere Server', l2.every((x) => x.status === 'gestoppt' && x.connections.every((c) => c.status === 'gestoppt')), l2.map((x) => [x.username, x.status, x.connections.map((c) => c.status)]))
    const nZwei = bots('zwei.test', 'bravo').length
    await t.api('POST', '/api/start-all')
    t.chk('Alle starten: auch weitere Server', await t.alleEinloggenBis(async () => (await t.liste()).every((x) => x.status === 'online' && x.connections.every((c) => c.status === 'online')), 300000), (await t.liste()).map((x) => [x.username, x.status, x.connections.map((c) => c.status)]))
    t.chk('...in Listenreihenfolge, eine nach der anderen', bots('zwei.test', 'bravo').length === nZwei + 1)
    await t.api('POST', '/api/stop-all')

    // Umbenennen: nur wenn alles gestoppt, Verbindungen ziehen mit
    await t.api('POST', '/api/start/alpha%40lobby')
    await t.warteBis(() => bots('lobby.test', 'alpha').length === 5, 60000)
    bot('lobby.test', 'alpha').einloggen()
    r = await t.api('POST', '/api/accounts/alpha/rename', { newUsername: 'alpha2' })
    t.chk('Umbenennen verboten, solange eine Verbindung läuft', r.status === 400 && /allen Servern/.test(r.data.error), r.data)
    await t.api('POST', '/api/stop/alpha%40lobby')
    r = await t.api('POST', '/api/accounts/alpha/rename', { newUsername: 'alpha2' })
    t.chk('Umbenennen', r.status === 200, r.data)
    t.chk('Verbindung zieht mit', !!(await conn('alpha2', 'alpha2@lobby')) && t.datei('verbindungen.json').connections.some((c) => c.username === 'alpha2' && c.server === 'lobby'))

    // Entfernen
    r = await t.api('DELETE', '/api/accounts/bravo/connections/zwei', undefined, 'paul')
    t.chk('User: entfernen verboten', r.status === 403)
    await t.api('POST', '/api/start/bravo%40zwei')
    await t.warteBis(() => bots('zwei.test', 'bravo').length === nZwei + 2, 60000)
    bot('zwei.test', 'bravo').einloggen()
    r = await t.api('DELETE', '/api/accounts/bravo/connections/zwei')
    t.chk('Entfernen', r.status === 200, r.data)
    t.chk('...Bot beendet', bot('zwei.test', 'bravo').beendet)
    t.chk('...aus der Datei', !t.datei('verbindungen.json').connections.some((c) => c.username === 'bravo' && c.server === 'zwei'))
    const nachher = bots('zwei.test', 'bravo').length
    await t.warte(120000)
    t.chk('...kein Reconnect', bots('zwei.test', 'bravo').length === nachher)
    r = await t.api('DELETE', '/api/servers/lobby')
    t.chk('Server mit Verbindungen nicht löschbar', r.status === 400 && /Verbindung/.test(r.data.error), r.data)

    // Protokoll
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Verbindung angelegt (Server im Ziel)', e.some((x) => x.action === 'Verbindung angelegt' && x.target === 'alpha@lobby' && x.who === 'toni'))
    t.chk('Protokoll: Verbindung entfernt', e.some((x) => x.action === 'Verbindung entfernt' && x.target === 'bravo@zwei'))
    t.chk('Protokoll: Start einer Verbindung', e.some((x) => x.action === 'Gestartet' && x.target === 'bravo@zwei'))

    // Für Phase 2: alpha2@lobby läuft wieder
    await t.api('POST', '/api/start/alpha2%40lobby')
    await t.warteBis(() => bots('lobby.test', 'alpha').length === 6, 60000)
    bot('lobby.test', 'alpha').einloggen()
    await t.warte(2000)
  },
}
