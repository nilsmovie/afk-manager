// Ohne MC_SERVER_HOST in der .env: kein fest eingebauter Server mehr, sondern eine klare Meldung
module.exports = {
  name: 'Ohne MC_SERVER_HOST',
  env: { MC_SERVER_HOST: '' },
  accounts: [{ username: 'alpha' }, { username: '.beta' }],
  async run (t) {
    await t.warte(30000)
    t.chk('Kein Bot startet', t.javaBots.length === 0 && t.bedrockClients.length === 0, t.javaBots.length)
    t.chk('Status sagt, was fehlt', /MC_SERVER_HOST/.test(await t.status('alpha')) && /MC_SERVER_HOST/.test(await t.status('.beta')), await t.liste())
    t.chk('Fehler im Log', t.logEnthaelt(/MC_SERVER_HOST fehlt in der \.env/))
    t.chk('Hinweis in Discord', await t.warteBis(() => t.discord.nachrichten().some((m) => /MC_SERVER_HOST fehlt/.test(t.discord.text(m))), 5000))
    await t.api('POST', '/api/start/alpha')
    await t.warte(20000)
    t.chk('Start-Klick startet auch nichts', t.javaBots.length === 0)
    const seite = await t.api('GET', '/')
    t.chk('Dashboard lädt trotzdem (Titel AFK-Manager)', seite.status === 200 && /AFK-Manager/.test(seite.data))
    const r = await t.api('POST', '/api/servers', { name: 'Notfall', host: 'mc.test', javaPort: 25565 })
    t.chk('Weiterer Server lässt sich trotzdem anlegen', r.status === 200, r.data)
  },
}
