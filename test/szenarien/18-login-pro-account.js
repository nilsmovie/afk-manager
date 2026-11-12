// Microsoft-Login gehört dem Account: Codes und Pause gelten für alle seine Verbindungen
module.exports = {
  name: 'Microsoft-Login über mehrere Server',
  accounts: [{ username: 'alpha' }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [{ id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] }] },
    'verbindungen.json': { version: 1, connections: [{ username: 'alpha', server: 'lobby', everJoined: true, autoChat: [] }] },
  },
  async run (t) {
    const std = () => t.javaBots.filter((b) => b.opts.host === 'mc.test')
    const lobby = () => t.javaBots.filter((b) => b.opts.host === 'lobby.test')
    const lobbyStatus = async () => (await t.liste())[0].connections[0].status
    for (let i = 1; i <= 4; i++) {
      await t.warteBis(() => std().length === i, 200000)
      std()[i - 1].code({ user_code: `A${i}`, expires_in: 60 })
      if (i === 1) {
        await t.warte(30000)
        t.chk('Zweite Verbindung wartet auf den Code', lobby().length === 0 && /Wartet auf den Microsoft-Login \(alpha\)/.test(await lobbyStatus()), await lobbyStatus())
      }
    }
    t.chk('Nach 4 Codes: Login pausiert', await t.warteBis(async () => /Start drücken/.test(await t.status('alpha')), 200000), await t.status('alpha'))
    t.chk('...auch für die zweite Verbindung', await t.warteBis(async () => /Start drücken/.test(await lobbyStatus()), 60000), await lobbyStatus())
    await t.warte(120000)
    t.chk('Kein einziger Code über die zweite Verbindung', lobby().length === 0 && !t.discord.nachrichten('MELDUNGEN').some((m) => /Lobby/.test(t.discord.text(m))) && !t.logEnthaelt(/\[alpha@lobby\] Microsoft-Login/))
    await t.api('POST', '/api/start/alpha%40lobby')
    t.chk('Start bei der zweiten Verbindung hebt die Pause auf', await t.warteBis(() => lobby().length === 1, 30000))
    lobby()[0].einloggen()
    t.chk('Nach dem Login kommt auch der Standardserver wieder', await t.warteBis(() => std().length === 5, 60000))
    std()[4].einloggen()
    t.chk('Beide online', await t.warteBis(async () => (await t.status('alpha')) === 'online' && (await lobbyStatus()) === 'online', 5000))
  },
}
