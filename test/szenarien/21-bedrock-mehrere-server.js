// Bedrock auf mehreren Servern (MULTI_SERVER_BEDROCK=1): eigener Zielserver, Obergrenze,
// Bedrock-Pause nur für den betroffenen Server, Meldung mit Servername, Probe nach der Pause
module.exports = {
  name: 'Bedrock auf mehreren Servern',
  env: { MULTI_SERVER_BEDROCK: '1', MULTI_SERVER_BEDROCK_MAX: '1', MC_BEDROCK_PAUSE_AFTER_FAILS: '3', MC_BEDROCK_PAUSE_MIN: '15' },
  accounts: [{ username: '.eins', everJoined: true }, { username: '.zwei', everJoined: true }, { username: 'java1' }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [{ id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: 19133, autoChatTemplate: [{ text: '/afk', delaySeconds: 1 }] }] },
  },
  async run (t) {
    const auf = (host, name) => t.bedrockClients.filter((c) => c.cfg.client && c.cfg.client.host === host && c.username === name)
    const status = async (key) => {
      for (const a of await t.liste()) {
        if (a.username === key) return a.status
        const c = (a.connections || []).find((x) => x.key === key)
        if (c) return c.status
      }
    }
    t.chk('Standardserver: alle online', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 200000))

    let r = await t.api('POST', '/api/accounts/.eins/connections', { server: 'lobby' })
    t.chk('Bedrock-Verbindung anlegen (eingeschaltet)', r.status === 200, r.data)
    t.chk('Verbindet zum anderen Server mit eigenem Port und Gamertag ohne Punkt', await t.warteBis(() => auf('lobby.test', 'eins').length === 1, 30000) && auf('lobby.test', 'eins')[0].cfg.client.port === 19133)
    auf('lobby.test', 'eins')[0].spawn()
    t.chk('online', await t.warteBis(async () => (await status('.eins@lobby')) === 'online', 5000))
    await t.warte(3000)
    t.chk('Erster Join dort: kein Auto-Chat aus der Vorlage', !auf('lobby.test', 'eins')[0].pakete.some((p) => p[0] === 'command_request' && p[1].command === '/afk'))
    r = await t.api('POST', '/api/accounts/.zwei/connections', { server: 'lobby' })
    t.chk('Obergrenze MULTI_SERVER_BEDROCK_MAX', r.status === 400 && /MULTI_SERVER_BEDROCK_MAX/.test(r.data.error), r.data)
    r = await t.api('POST', '/api/chat', { username: '.eins@lobby', message: '/lobbybefehl' })
    t.chk('Befehl über die Bedrock-Verbindung', r.status === 200 && auf('lobby.test', 'eins')[0].pakete.some((p) => p[0] === 'command_request' && p[1].command === '/lobbybefehl') && !auf('mc.test', 'eins').some((c) => c.pakete.some((p) => p[1] && p[1].command === '/lobbybefehl')))

    // Lobby nimmt keine Bedrock-Verbindungen mehr an -> Pause NUR für die Lobby
    auf('lobby.test', 'eins')[0].trennen()
    for (let i = 0; i < 6 && !t.logEnthaelt(/Bedrock-Accounts auf Lobby pausieren/); i++) {
      const n = auf('lobby.test', 'eins').length
      if (!await t.warteBis(() => auf('lobby.test', 'eins').length > n || t.logEnthaelt(/Bedrock-Accounts auf Lobby pausieren/), 400000)) break
      if (auf('lobby.test', 'eins').length > n) auf('lobby.test', 'eins').slice(-1)[0].aufbauScheitert(9)
    }
    t.chk('Pause für die Lobby', t.logEnthaelt(/alle Bedrock-Accounts auf Lobby pausieren/))
    t.chk('Status zeigt die Pause', await t.warteBis(async () => /Bedrock-Pause bis/.test(await status('.eins@lobby')), 60000), await status('.eins@lobby'))
    t.chk('Standardserver nicht betroffen', (await status('.eins')) === 'online' && (await status('.zwei')) === 'online')
    t.chk('Discord-Hinweis nennt den Server', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /kommen nicht auf den Server \(Lobby\)/.test(t.discord.text(m)) && /lobby\.test:19133/.test(t.discord.text(m))), 5000))
    // Standardserver: ein Bedrock-Account fällt aus -> normaler Reconnect, keine Pause von der Lobby geerbt
    const nZwei = auf('mc.test', 'zwei').length
    auf('mc.test', 'zwei').slice(-1)[0].trennen()
    t.chk('Standardserver verbindet normal neu (keine Lobby-Pause)', await t.warteBis(() => auf('mc.test', 'zwei').length === nZwei + 1, 200000))
    auf('mc.test', 'zwei').slice(-1)[0].spawn()

    // Nach der Pause: Probe auf der Lobby
    const n = auf('lobby.test', 'eins').length
    t.chk('Nach der Pause probiert es die Lobby-Verbindung', await t.warteBis(() => auf('lobby.test', 'eins').length === n + 1, 20 * 60 * 1000))
    auf('lobby.test', 'eins').slice(-1)[0].spawn()
    t.chk('...und ist wieder online', await t.warteBis(async () => (await status('.eins@lobby')) === 'online', 5000))
    await t.warte(3000)
    t.chk('Jetzt mit Auto-Chat (war schon mal drin)', auf('lobby.test', 'eins').slice(-1)[0].pakete.some((p) => p[0] === 'command_request' && p[1].command === '/afk'))
  },
}
