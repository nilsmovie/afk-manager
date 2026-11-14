// Erweiterungen: Schnittstelle (Chat senden, Online-Status, Accounts, Verwaltungs-Skript, Discord-Teile)
const EXT = `module.exports = (api) => {
  api.app.get('/api/test-ext', api.requireOwner, (req, res) => {
    res.json({
      online: api.isAccountOnline('alpha'),
      accounts: api.getAccounts().map((a) => a.username),
      hatDiscord: !!api.discordClient,
      hatRollen: typeof api.hasAllowedRole === 'function',
      farben: Object.keys(api.colors),
    })
  })
  api.app.post('/api/test-ext/senden', api.requireOwner, (req, res) => {
    const r = api.sendChatMessage(req.body.account, req.body.text)
    api.logChat(req.body.account, '(Erweiterung) ' + req.body.text)
    api.auditWeb(req, 'Test-Erweiterung', req.body.account)
    res.json(r)
  })
  api.addAdminScript('window.__testExt = 1')
  api.addCommandChannel('EXTRA')
}`
module.exports = {
  name: 'Erweiterungs-Schnittstelle',
  accounts: [{ username: 'alpha' }, { username: '.bedrock' }],
  dateien: { 'erweiterungen/test.js': EXT, 'erweiterungen/kaputt.js': 'throw new Error("Tippfehler")' },
  async run (t) {
    t.chk('Erweiterung geladen', t.logEnthaelt(/Erweiterung geladen: test\.js/))
    t.chk('Kaputte Erweiterung: nur Fehlermeldung', t.logEnthaelt(/Erweiterung kaputt\.js konnte nicht geladen werden/))
    await t.warteBis(() => t.java('alpha'), 20000)
    let r = await t.api('GET', '/api/test-ext')
    t.chk('Offline erkannt', r.data.online === false)
    t.java('alpha').einloggen()
    await t.warte(1000)
    r = await t.api('GET', '/api/test-ext')
    t.chk('Online erkannt, Accounts, Discord-Teile', r.data.online === true && r.data.accounts.join() === 'alpha,.bedrock' && r.data.hatDiscord && r.data.hatRollen && r.data.farben.includes('danger'), r.data)
    r = await t.api('POST', '/api/test-ext/senden', { account: 'alpha', text: '/p mute x' })
    t.chk('Senden über einen Account', r.data.ok === true && t.java('alpha').gesendet.includes('/p mute x'), r.data)
    r = await t.api('POST', '/api/test-ext/senden', { account: '.bedrock', text: 'x' })
    t.chk('Senden über nicht verbundenen Account: Fehler statt Absturz', r.data.ok === false)
    const skript = await t.api('GET', '/erweiterungen/admin.js')
    t.chk('Verwaltungs-Skript für den Owner', /__testExt/.test(skript.data))
    await t.api('POST', '/api/users', { username: 'toni', password: 'geheim123', role: 'admin', allowedAccounts: [] })
    t.chk('...nicht für Admins', (await t.api('GET', '/erweiterungen/admin.js', undefined, 'toni')).data === '')
    const b = t.discord.befehl('!list', { kanal: 'EXTRA' })
    await t.warte(500)
    t.chk('Freigegebener Kanal nimmt Befehle an', b.antworten.length === 1)
    const b2 = t.discord.befehl('!list', { kanal: 'FREMD' })
    await t.warte(500)
    t.chk('Fremder Kanal nicht', b2.antworten.length === 0)
  },
}
