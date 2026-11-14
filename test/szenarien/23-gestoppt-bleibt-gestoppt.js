// Gestoppte Accounts bleiben nach einem Neustart des Managers gestoppt, bis jemand startet
// (Dashboard, Discord, "Alle stoppen", anderswo eingeloggt, neu angelegt; auch weitere Server)
module.exports = {
  name: 'Gestoppt bleibt gestoppt',
  phasen: 3,
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }, { username: 'charlie', everJoined: true }, { username: '.bed', everJoined: true }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [{ id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] }] },
    'verbindungen.json': { version: 1, connections: [{ username: 'alpha', server: 'lobby', everJoined: true, autoChat: [] }, { username: 'bravo', server: 'lobby', everJoined: true, autoChat: [] }] },
  },
  async run (t) {
    const status = async (key) => {
      for (const a of await t.liste()) {
        if (a.username === key) return a.status
        const c = (a.connections || []).find((x) => x.key === key)
        if (c) return c.status
      }
    }
    const java = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user)
    if (t.PHASE === 1) {
      t.chk('Alle verbinden', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online' && a.connections.every((c) => c.status === 'online')), 300000))
      await t.api('POST', '/api/stop/bravo') // Dashboard
      let b = t.discord.befehl('!stop .bed') // Discord
      b = t.discord.befehl('!stop alpha@lobby') // weiterer Server
      java('mc.test', 'charlie').slice(-1)[0].kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' })) // anderswo
      await t.api('POST', '/api/accounts', { username: 'delta' }) // neu, nicht gestartet
      await t.warte(2000)
      const acc = t.datei('accounts.json')
      t.chk('Merker gespeichert (accounts.json)', ['bravo', 'charlie', '.bed', 'delta'].every((n) => acc.find((a) => a.username === n).stopped === true) && !acc.find((a) => a.username === 'alpha').stopped, acc)
      t.chk('Merker gespeichert (verbindungen.json)', t.datei('verbindungen.json').connections.find((c) => c.username === 'alpha').stopped === true && !t.datei('verbindungen.json').connections.find((c) => c.username === 'bravo').stopped)
      return
    }
    if (t.PHASE === 2) {
      t.chk('Neustart: alpha startet', await t.warteBis(() => java('mc.test', 'alpha').length === 1, 30000))
      java('mc.test', 'alpha')[0].einloggen()
      t.chk('Neustart: bravo@lobby startet', await t.warteBis(() => java('lobby.test', 'bravo').length === 1, 60000))
      java('lobby.test', 'bravo')[0].einloggen()
      await t.warte(120000)
      t.chk('Gestoppte starten nicht', java('mc.test', 'bravo').length === 0 && java('mc.test', 'charlie').length === 0 && java('mc.test', 'delta').length === 0 && java('lobby.test', 'alpha').length === 0 && t.bedrockClients.length === 0, t.javaBots.map((b) => `${b.username}@${b.opts.host}`))
      t.chk('Status "gestoppt"', (await status('bravo')) === 'gestoppt' && (await status('alpha@lobby')) === 'gestoppt' && (await status('.bed')) === 'gestoppt')
      t.chk('Discord-Startmeldung nennt die Gestoppten', t.discord.nachrichten().some((m) => /2 Account\(s\) werden automatisch gestartet, 5 bleiben gestoppt/.test(t.discord.text(m))), t.discord.nachrichten().map(t.discord.text).filter((x) => /automatisch/.test(x)))
      // Starten hebt den Merker auf
      await t.api('POST', '/api/start/bravo')
      t.discord.befehl('!start alpha@lobby')
      t.chk('Start (Dashboard/Discord) verbindet', await t.alleEinloggenBis(async () => (await status('bravo')) === 'online' && (await status('alpha@lobby')) === 'online', 200000))
      t.chk('Merker aufgehoben', !t.datei('accounts.json').find((a) => a.username === 'bravo').stopped && !t.datei('verbindungen.json').connections.find((c) => c.username === 'alpha').stopped)
      // "Alle stoppen" -> nach dem Neustart bleibt alles aus
      await t.api('POST', '/api/stop-all')
      await t.warte(2000)
      return
    }
    // Phase 3
    await t.warte(60000)
    t.chk('Nach "Alle stoppen" startet nach dem Neustart nichts', t.javaBots.length === 0 && t.bedrockClients.length === 0)
    await t.api('POST', '/api/start-all')
    t.chk('"Alle starten" startet wieder alles', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online' && a.connections.every((c) => c.status === 'online')), 400000), (await t.liste()).map((a) => [a.username, a.status]))
    t.chk('Kein Merker mehr', !t.datei('accounts.json').some((a) => a.stopped) && !t.datei('verbindungen.json').connections.some((c) => c.stopped))
  },
}
