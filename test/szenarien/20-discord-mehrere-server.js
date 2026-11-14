// Discord mit mehreren Servern: Name@Server, Name@alle, !add Name@Server, !list, !primary,
// Meldungen mit Servername, Start-Knopf einer Verbindung, ruhigeres "Alle wieder online",
// "Alle online/offline" pro Server, Tageszusammenfassung pro Server
module.exports = {
  name: 'Discord mit mehreren Servern',
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  env: { DISCORD_ALL_ONLINE_AFTER_MIN: '10' },
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [{ id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] }, { id: 'event', name: 'Event Server', host: 'event.test', javaPort: 25565, bedrockPort: null, autoChatTemplate: [] }] },
    'verbindungen.json': { version: 1, connections: [{ username: 'alpha', server: 'lobby', everJoined: true, autoChat: [], notifyElsewhere: true }] },
  },
  async run (t) {
    const bot = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user).slice(-1)[0]
    const bots = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user)
    const meldungen = () => t.discord.nachrichten('MELDUNGEN').map(t.discord.text)
    const status = async (key) => {
      for (const a of await t.liste()) {
        if (a.username === key) return a.status
        const c = (a.connections || []).find((x) => x.key === key)
        if (c) return c.status
      }
    }
    t.chk('Start: alle verbinden', await t.alleEinloggenBis(async () => (await status('alpha@lobby')) === 'online' && (await status('bravo')) === 'online', 200000))
    t.chk('Nach dem Start: "Alle wieder online" für beide Server', await t.warteBis(() => meldungen().some((m) => /Alle Accounts wieder online \d/.test(m)) && meldungen().some((m) => /Alle Accounts wieder online \(Lobby\)/.test(m)), 5000), meldungen())

    // !mc / !stop / !start mit @
    let b = t.discord.befehl('!mc alpha@lobby /lobby')
    await t.warte(300)
    t.chk('!mc Name@Server sendet dort', bot('lobby.test', 'alpha').gesendet.includes('/lobby') && !bot('mc.test', 'alpha').gesendet.includes('/lobby') && b.reaktionen.includes('✅'), b)
    b = t.discord.befehl('!mc alpha@LOBBY /gross')
    await t.warte(300)
    t.chk('Server ohne Groß-/Kleinschreibung', bot('lobby.test', 'alpha').gesendet.includes('/gross'))
    b = t.discord.befehl('!mc alpha /std')
    await t.warte(300)
    t.chk('!mc ohne @ = Standardserver', bot('mc.test', 'alpha').gesendet.includes('/std') && !bot('lobby.test', 'alpha').gesendet.includes('/std'))
    b = t.discord.befehl('!mc alpha@alle hi')
    await t.warte(300)
    t.chk('!mc Name@alle abgelehnt', /genau einen Server/.test(b.antworten[0] || ''), b.antworten)
    b = t.discord.befehl('!mc bravo@lobby hi')
    await t.warte(300)
    t.chk('!mc: nicht auf dem Server', /bravo ist nicht auf Lobby/.test(b.antworten[0] || ''), b.antworten)
    b = t.discord.befehl('!mc alpha@gibtsnicht hi')
    await t.warte(300)
    t.chk('!mc: unbekannter Server mit Liste', /Unbekannter Server "gibtsnicht"/.test(b.antworten[0] || '') && /lobby/.test(b.antworten[0] || ''), b.antworten)

    b = t.discord.befehl('!stop alpha@lobby')
    await t.warte(500)
    t.chk('!stop Name@Server stoppt nur dort', (await status('alpha@lobby')) === 'gestoppt' && (await status('alpha')) === 'online')
    const nLobby = bots('lobby.test', 'alpha').length
    b = t.discord.befehl('!start alpha@lobby')
    t.chk('!start Name@Server', await t.warteBis(() => bots('lobby.test', 'alpha').length === nLobby + 1, 30000))
    bot('lobby.test', 'alpha').einloggen()
    await t.warte(1000)
    b = t.discord.befehl('!stop alpha@alle')
    await t.warte(500)
    t.chk('!stop Name@alle stoppt überall', (await status('alpha@lobby')) === 'gestoppt' && (await status('alpha')) === 'gestoppt')
    b = t.discord.befehl('!start alpha@alle')
    t.chk('!start Name@alle', await t.alleEinloggenBis(async () => (await status('alpha@lobby')) === 'online' && (await status('alpha')) === 'online', 200000))

    // !add Name@Server
    b = t.discord.befehl('!add bravo@Event Server')
    t.chk('!add Name@Servername legt an und startet', await t.warteBis(() => bot('event.test', 'bravo'), 30000) && /zusätzlich auf \*\*Event Server\*\*/.test(b.antworten[0] || ''), b.antworten)
    bot('event.test', 'bravo').einloggen()
    b = t.discord.befehl('!add bravo@event')
    await t.warte(300)
    t.chk('!add doppelt abgelehnt', /schon auf diesem Server/.test(b.antworten[0] || ''), b.antworten)
    b = t.discord.befehl('!add niemand@lobby')
    await t.warte(300)
    t.chk('!add für unbekannten Account erklärt den Weg', /zuerst `!add niemand`/.test(b.antworten[0] || ''), b.antworten)

    // !list
    b = t.discord.befehl('!list')
    await t.warte(500)
    const liste = (() => { try { const o = JSON.parse(b.antworten[0]); return `${o.embeds[0].title} ${o.embeds[0].description}` } catch (_) { return b.antworten[0] || '' } })()
    t.chk('!list zeigt weitere Server', /↳ 🟢 Lobby — online/.test(liste) && /↳ 🟢 Event Server — online/.test(liste) && /\(4\/4 online\)/.test(liste), liste)
    t.chk('!list markiert die echte Chat-Quelle', /\*\*alpha\*\* \*\(Chat-Quelle\)\*/.test(liste), liste)

    // !primary pro Server
    await t.api('POST', '/api/accounts/bravo/connections', { server: 'lobby' })
    await t.alleEinloggenBis(async () => (await status('bravo@lobby')) === 'online', 100000)
    b = t.discord.befehl('!primary bravo@lobby')
    await t.warte(500)
    t.chk('!primary Name@Server', /Chat-Quelle für Lobby/.test(b.antworten[0] || '') && (await t.api('GET', '/api/chat-state')).data.servers.lobby.primary === 'bravo@lobby', b.antworten)
    t.chk('...Standardserver unverändert', (await t.api('GET', '/api/chat-state')).data.servers.standard.primary === 'alpha')

    // "anderswo eingeloggt" auf einem weiteren Server: Meldung + Knopf mit Servername
    bot('lobby.test', 'alpha').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
    t.chk('Meldung nennt den Server', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /alpha \(Lobby\)\*\* ist anderswo eingeloggt/.test(m.content || '')), 5000))
    const notice = t.discord.nachrichten('MELDUNGEN').find((m) => /alpha \(Lobby\)\*\* ist anderswo/.test(m.content || ''))
    t.chk('Knopf mit Servername', JSON.stringify(notice.components || []).includes('alpha (Lobby) starten'), notice.components)
    t.chk('Standardserver bleibt online', (await status('alpha')) === 'online')
    const nL = bots('lobby.test', 'alpha').length
    const klick = t.discord.knopf('start_alpha@lobby', notice)
    t.chk('Knopf startet die Verbindung', await t.warteBis(() => bots('lobby.test', 'alpha').length === nL + 1, 30000))
    bot('lobby.test', 'alpha').einloggen()
    t.chk('Meldung wird aktualisiert (mit Servername)', klick.some((p) => /▶️ \*\*alpha \(Lobby\)\*\* wird jetzt gestartet/.test(p.content || '')), klick)

    // Ruhiger: ein einzelner kurzer Verbindungsverlust -> kein "Alle wieder online"
    await t.warte(20000)
    let v = meldungen().length
    bot('mc.test', 'bravo').trennen()
    await t.alleEinloggenBis(async () => (await status('bravo')) === 'online', 200000)
    await t.warte(5000)
    t.chk('Kurzer Ausfall eines Accounts: kein "Alle wieder online"', !meldungen().slice(v).some((m) => /Alle Accounts wieder online/.test(m)), meldungen().slice(v))
    // ...aber nach einem längeren Ausfall (über 10 Minuten) schon
    v = meldungen().length
    t.discord.befehl('!stop bravo')
    await t.warte(11 * 60 * 1000)
    t.discord.befehl('!start bravo')
    await t.alleEinloggenBis(async () => (await status('bravo')) === 'online', 200000)
    t.chk('Langer Ausfall: "Alle wieder online"', await t.warteBis(() => meldungen().slice(v).some((m) => /Alle Accounts wieder online \d/.test(m)), 5000), meldungen().slice(v))

    // Alle offline pro Server: Lobby stoppen -> "Alle Accounts offline (Lobby)", Standardserver bleibt ruhig
    v = meldungen().length
    t.discord.befehl('!stop alpha@lobby')
    t.discord.befehl('!stop bravo@lobby')
    t.chk('"Alle offline (Lobby)"', await t.warteBis(() => meldungen().slice(v).some((m) => /Alle Accounts offline \(Lobby\)/.test(m)), 5000), meldungen().slice(v))
    t.chk('Kein "Alle offline" für den Standardserver', !meldungen().slice(v).some((m) => /Alle Accounts offline Kein Account ist gerade mit dem Server/.test(m)))
    t.discord.befehl('!start alpha@lobby')
    t.discord.befehl('!start bravo@lobby')
    t.chk('Danach "Alle wieder online (Lobby)"', await t.alleEinloggenBis(() => meldungen().slice(v).some((m) => /Alle Accounts wieder online \(Lobby\)/.test(m)), 200000))

    // Massen-Kick auf der Lobby -> Sammelmeldung mit Servername, danach "wieder online (Lobby)"
    v = meldungen().length
    bot('lobby.test', 'alpha').kick('Server restarting')
    bot('lobby.test', 'bravo').kick('Server restarting')
    t.chk('Sammelmeldung (Lobby)', await t.warteBis(() => meldungen().slice(v).some((m) => /2 Accounts wurden gekickt \(Lobby\)/.test(m)), 10000))
    t.chk('...dann "wieder online (Lobby)"', await t.alleEinloggenBis(() => meldungen().slice(v).some((m) => /Alle Accounts wieder online \(Lobby\)/.test(m)), 300000))

    // Tageszusammenfassung um 0:00 mit Abschnitt pro Server
    const m = new Date(t.zeit.jetzt()); m.setHours(23, 59, 50, 0)
    t.zeit.setze(m)
    t.chk('Tageszusammenfassung mit Abschnitten', await t.warteBis(() => meldungen().some((x) => /Tageszusammenfassung/.test(x) && /__Lobby__/.test(x) && /__Event Server__/.test(x)), 200000), meldungen().filter((x) => /Tageszusammenfassung/.test(x)))
    const sum = meldungen().find((x) => /Tageszusammenfassung/.test(x))
    t.chk('...Standardserver oben ohne Überschrift', /Tageszusammenfassung \*\*alpha\*\*/.test(sum), sum)

    // Protokoll
    const e = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Protokoll: Discord-Befehl mit Server', e.some((x) => x.src === 'discord' && x.action === 'Gestoppt' && x.target === 'alpha@lobby'))
    t.chk('Protokoll: @alle mit allen Verbindungen', e.some((x) => x.src === 'discord' && x.target === 'alpha@alle' && /alpha, alpha@lobby/.test(x.detail || '')))
    t.chk('Protokoll: !add Name@Server', e.some((x) => x.src === 'discord' && x.action === 'Verbindung angelegt und gestartet' && x.target === 'bravo@event'))
  },
}
