// Schalter MULTI_SERVER_JAVA=0: vorhandene Verbindungen ruhen, neue gehen nicht; ungültige
// Einträge in verbindungen.json bleiben beim Speichern erhalten
module.exports = {
  name: 'Schalter und ungültige Verbindungen',
  env: { MULTI_SERVER_JAVA: '0' },
  accounts: [{ username: 'alpha' }, { username: 'bravo' }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [{ id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] }] },
    'verbindungen.json': { version: 1, connections: [{ username: 'alpha', server: 'lobby', everJoined: true, autoChat: [] }, { username: 'alpha', server: 'weg' }] },
  },
  async run (t) {
    t.chk('Ungültige Verbindung gemeldet', t.logEnthaelt(/Verbindung wird nicht benutzt \(Server "weg" gibt es nicht\)/))
    t.chk('Standardserver startet', await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 60000))
    await t.warte(60000)
    t.chk('Weitere Server: kein Bot', !t.javaBots.some((b) => b.opts.host === 'lobby.test'))
    const c = (await t.liste()).find((a) => a.username === 'alpha').connections[0]
    t.chk('Status nennt den Schalter', c && /MULTI_SERVER_JAVA/.test(c.status), c)
    const r = await t.api('POST', '/api/accounts/bravo/connections', { server: 'lobby' })
    t.chk('Neue Verbindung abgelehnt', r.status === 400 && /MULTI_SERVER_JAVA/.test(r.data.error), r.data)
    await t.api('POST', '/api/accounts/alpha%40lobby/notify-elsewhere', { enabled: false })
    const datei = t.datei('verbindungen.json')
    t.chk('Ungültiger Eintrag bleibt in der Datei', datei.connections.length === 2 && datei.connections.some((x) => x.server === 'weg'), datei)
    t.chk('Gültiger Eintrag gespeichert', datei.connections.find((x) => x.server === 'lobby').notifyElsewhere === false)
  },
}
