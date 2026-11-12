// Serverliste: Sicherung vor der Umstellung, anlegen/ändern/löschen mit Prüfung, Rechte,
// Protokoll, Auto-Chat-Vorlage, Neustart und kaputte servers.json
const ACCOUNTS = [{ username: 'alpha', everJoined: true, autoChat: [{ text: '/hub', delaySeconds: 2 }] }]
module.exports = {
  name: 'Serverliste',
  phasen: 2,
  accounts: ACCOUNTS,
  async run (t) {
    if (t.PHASE === 1) {
      const sicherung = t.datei('accounts.vor-mehrserver.json')
      t.chk('Sicherung vor der Umstellung angelegt', sicherung && sicherung[0].username === 'alpha' && sicherung[0].autoChat[0].text === '/hub', sicherung)
      t.chk('accounts.json unverändert im alten Format', JSON.stringify(t.datei('accounts.json')) === JSON.stringify(ACCOUNTS))
      t.chk('Ohne weitere Server keine servers.json', t.datei('servers.json') === null)

      let r = await t.api('GET', '/api/servers')
      t.chk('Nur der Standardserver aus der .env', r.data.servers.length === 1 && r.data.servers[0].isDefault && r.data.servers[0].host === 'mc.test' && r.data.servers[0].javaPort === 25565 && r.data.servers[0].id === 'standard', r.data)

      await t.api('POST', '/api/users', { username: 'toni', password: 'geheim123', role: 'admin', allowedAccounts: [] })
      await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })
      t.chk('User: anlegen verboten', (await t.api('POST', '/api/servers', { name: 'X', host: 'x.test', javaPort: 25565 }, 'paul')).status === 403)
      r = await t.api('GET', '/api/servers', undefined, 'paul')
      t.chk('User: sieht Server, aber keine Vorlagen/Zahlen', r.status === 200 && r.data.canManage === false && r.data.servers[0].autoChatTemplate === undefined && r.data.servers[0].connections === undefined, r.data)

      // Prüfung der Eingaben
      const fehler = async (body, re, name) => {
        const x = await t.api('POST', '/api/servers', body, 'toni')
        t.chk(name, x.status === 400 && re.test(x.data.error || ''), x)
      }
      await fehler({ name: '<img src=x onerror=alert(1)>', host: 'a.test', javaPort: 1 }, /Name/, 'HTML im Namen abgelehnt')
      await fehler({ name: 'A', host: 'a.test:25565', javaPort: 25565 }, /ohne Port/, 'Adresse mit Port abgelehnt')
      await fehler({ name: 'A', host: 'a b.test', javaPort: 25565 }, /Ungültige Adresse/, 'Kaputte Adresse abgelehnt')
      await fehler({ name: 'A', host: 'a.test', javaPort: 70000 }, /Port/, 'Port zu groß abgelehnt')
      await fehler({ name: 'A', host: 'a.test', javaPort: '25a' }, /Port/, 'Port mit Buchstaben abgelehnt')
      await fehler({ name: 'A', host: 'a.test', javaPort: '', bedrockPort: '' }, /Mindestens einen Port/, 'Ohne Port abgelehnt')
      await fehler({ name: 'A', host: 'MC.test', javaPort: 25565 }, /schon als/, 'Standardserver doppelt abgelehnt')
      await fehler({ name: 'A', id: 'alle', host: 'a.test', javaPort: 25565 }, /reserviert/, 'Reserviertes Kürzel abgelehnt')
      await fehler({ name: 'A', id: 'a@b', host: 'a.test', javaPort: 25565 }, /Kürzel/, 'Kürzel mit @ abgelehnt')

      // Anlegen
      r = await t.api('POST', '/api/servers', { name: 'Mein Lobby-Server', host: ' Lobby.Example.net ', javaPort: '25566', bedrockPort: '' }, 'toni')
      t.chk('Admin legt Server an, Kürzel aus dem Namen', r.status === 200 && r.data.server.id === 'mein-lobby-server' && r.data.server.host === 'lobby.example.net' && r.data.server.javaPort === 25566 && r.data.server.bedrockPort === null, r.data)
      r = await t.api('POST', '/api/servers', { name: 'Eigener', id: 'eigen', host: '192.168.1.20', javaPort: 25565, bedrockPort: 19132 })
      t.chk('Owner legt Server mit IP und eigenem Kürzel an', r.status === 200 && r.data.server.id === 'eigen', r.data)
      await fehler({ name: 'mein lobby-server', host: 'b.test', javaPort: 1 }, /Namen gibt es schon/, 'Name doppelt abgelehnt')
      await fehler({ name: 'B', id: 'eigen', host: 'b.test', javaPort: 1 }, /schon vergeben/, 'Kürzel doppelt abgelehnt')
      const datei = t.datei('servers.json')
      t.chk('servers.json + Sicherung geschrieben', datei && datei.servers.length === 2 && t.datei('servers.backup.json').servers.length === 2, datei)
      t.chk('Standardserver steht nicht in der Datei', !datei.servers.some((s) => s.id === 'standard'))

      // Ändern
      r = await t.api('PUT', '/api/servers/eigen', { name: 'Eigener Server', host: '192.168.1.21', javaPort: 25565, bedrockPort: '' })
      t.chk('Ändern', r.status === 200 && r.data.server.name === 'Eigener Server' && r.data.server.bedrockPort === null, r.data)
      r = await t.api('PUT', '/api/servers/standard', { name: 'X', host: 'x.test', javaPort: 1 })
      t.chk('Standardserver nicht änderbar', r.status === 400 && /\.env/.test(r.data.error), r.data)
      t.chk('User: ändern verboten', (await t.api('PUT', '/api/servers/eigen', { name: 'Y' }, 'paul')).status === 403)

      // Auto-Chat-Vorlage
      r = await t.api('POST', '/api/servers/standard/autochat', { text: '/afk', delaySeconds: 3 })
      t.chk('Vorlage beim Standardserver', r.status === 200 && r.data.autoChatTemplate.length === 1, r.data)
      r = await t.api('POST', '/api/servers/standard/autochat', { text: 'x'.repeat(300), delaySeconds: 3 })
      t.chk('Zu langer Vorlagentext abgelehnt', r.status === 400, r.data)
      r = await t.api('POST', '/api/servers/standard/autochat', { text: '/a', delaySeconds: -1 })
      t.chk('Negative Wartezeit abgelehnt', r.status === 400, r.data)
      await t.api('POST', '/api/accounts', { username: 'bravo' })
      t.chk('Neuer Account bekommt die Vorlage', JSON.stringify(t.datei('accounts.json').find((a) => a.username === 'bravo').autoChat) === '[{"text":"/afk","delaySeconds":3}]', t.datei('accounts.json'))
      t.chk('Bestehender Account bleibt', JSON.stringify(t.datei('accounts.json').find((a) => a.username === 'alpha').autoChat) === '[{"text":"/hub","delaySeconds":2}]')
      t.discord.befehl('!add charlie')
      t.chk('Auch bei !add', await t.warteBis(() => ((t.datei('accounts.json').find((a) => a.username === 'charlie') || {}).autoChat || []).length === 1, 5000))
      r = await t.api('POST', '/api/servers/eigen/autochat', { text: '/lobby', delaySeconds: 1 })
      await t.api('POST', '/api/servers/eigen/autochat', { text: '/afk', delaySeconds: 2 })
      r = await t.api('DELETE', '/api/servers/eigen/autochat/0')
      t.chk('Vorlage: Eintrag entfernen', r.status === 200 && r.data.autoChatTemplate.length === 1 && r.data.autoChatTemplate[0].text === '/afk', r.data)
      t.chk('Vorlage: falscher Index', (await t.api('DELETE', '/api/servers/eigen/autochat/7')).status === 400)

      // Löschen
      t.chk('Standardserver nicht löschbar', (await t.api('DELETE', '/api/servers/standard')).status === 400)
      t.chk('User: löschen verboten', (await t.api('DELETE', '/api/servers/mein-lobby-server', undefined, 'paul')).status === 403)
      r = await t.api('DELETE', '/api/servers/mein-lobby-server', undefined, 'toni')
      t.chk('Löschen', r.status === 200 && (await t.api('GET', '/api/servers')).data.servers.length === 2)

      // Protokoll
      const eintraege = (await t.api('GET', '/api/audit')).data.entries
      const hat = (aktion, ziel, wer) => eintraege.some((e) => e.action === aktion && e.target === ziel && (!wer || e.who === wer))
      t.chk('Protokoll: angelegt (mit Server und Wer)', hat('Server angelegt', 'Mein Lobby-Server (mein-lobby-server)', 'toni'), eintraege.slice(0, 12))
      t.chk('Protokoll: geändert', hat('Server geändert', 'Eigener Server (eigen)'))
      t.chk('Protokoll: Vorlage', hat('Auto-Chat-Vorlage ergänzt', `${(await t.api('GET', '/api/servers')).data.servers[0].name} (standard)`))
      t.chk('Protokoll: gelöscht', hat('Server gelöscht', 'Mein Lobby-Server (mein-lobby-server)', 'toni'))
      t.chk('Keine Protokoll-Meldung in Discord', !t.discord.nachrichten().some((m) => /Protokoll|Server \*\*/.test(t.discord.text(m))))

      // Verwaltungsseite liefert die Karte
      const seite = await t.api('GET', '/admin')
      t.chk('Verwaltung hat die Server-Karte', /id="serverCard"/.test(seite.data))

      // Für Phase 2: servers.json kaputt machen -> Sicherung muss greifen
      require('fs').writeFileSync(require('path').join(t.lauf, 'servers.json'), '{ kaputt')
      return
    }
    // Phase 2: Neustart
    const r = await t.api('GET', '/api/servers')
    const eigen = r.data.servers.find((s) => s.id === 'eigen')
    t.chk('Nach Neustart: Server aus der Sicherung', eigen && eigen.name === 'Eigener Server' && eigen.host === '192.168.1.21', r.data)
    t.chk('...mit Vorlage', eigen && eigen.autoChatTemplate.length === 1)
    t.chk('...Standard-Vorlage auch', r.data.servers[0].autoChatTemplate.length === 1)
    t.chk('Hinweis im Log', t.logEnthaelt(/servers\.json nicht lesbar - Sicherung wird verwendet/))
    t.chk('Sicherung wird nicht überschrieben', t.datei('accounts.vor-mehrserver.json').length === 1)
    t.chk('Accounts starten wie immer', await t.warteBis(() => t.java('alpha'), 20000))
  },
}
