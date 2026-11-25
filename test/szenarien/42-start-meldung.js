// Nach einem Neustart: KEIN "Alle Accounts wieder online" pro Server, sondern die Meldung
// "AFK-Manager gestartet" wird bearbeitet (Fortschritt pro Server, am Ende "alle Accounts online").
// Klappt es nicht in 20 Minuten: "nicht alle online" mit den fehlenden Accounts, für diesen Server
// kommt später das normale "Alle Accounts wieder online (Server)". Auch der Standardserver steht
// in den Server-Meldungen jetzt mit Namen.
module.exports = {
  name: 'Start-Meldung statt "Alle wieder online" pro Server',
  phasen: 2,
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }, { username: 'charlie', everJoined: true }, { username: 'delta', everJoined: true, stopped: true }],
  dateien: {
    'servers.json': { version: 1, defaultServer: { autoChatTemplate: [] }, servers: [
      { id: 'lobby', name: 'Lobby', host: 'lobby.test', javaPort: 25570, bedrockPort: null, autoChatTemplate: [] },
      { id: 'event', name: 'Event_Server', host: 'event.test', javaPort: 25565, bedrockPort: null, autoChatTemplate: [] },
    ] },
    'verbindungen.json': { version: 1, connections: [
      { username: 'alpha', server: 'lobby', everJoined: true, autoChat: [] },
      { username: 'bravo', server: 'event', everJoined: true, autoChat: [], stopped: true },
    ] },
  },
  async run (t) {
    const bot = (host, user) => t.javaBots.filter((b) => b.opts.host === host && b.username === user && !b.beendet).slice(-1)[0]
    const einloggen = async (host, user) => {
      t.chk(`${user}@${host} verbindet`, await t.warteBis(() => !!bot(host, user), 120000))
      bot(host, user).einloggen()
    }
    const alle = () => t.discord.nachrichten('MELDUNGEN')
    const start = () => alle().filter((m) => /AFK-Manager gestartet/.test(t.discord.text(m))).slice(-1)[0]
    const startText = () => (start() ? t.discord.text(start()) : '')
    const status = async (key) => {
      for (const a of await t.liste()) {
        if (a.username === key) return a.status
        const c = (a.connections || []).find((x) => x.key === key)
        if (c) return c.status
      }
    }

    if (t.PHASE === 2) {
      // ---- Neustart: charlie kommt nicht rein -> nach 20 Minuten "nicht alle online" ----
      t.chk('Neustart: neue Start-Meldung', await t.warteBis(() => alle().filter((m) => /AFK-Manager gestartet/.test(t.discord.text(m))).length === 2, 60000))
      const vorher = alle().length
      // Reihenfolge der Warteschlange: alpha, alpha@lobby, bravo, charlie
      await einloggen('mc.test', 'alpha')
      await einloggen('lobby.test', 'alpha')
      await einloggen('mc.test', 'bravo')
      await t.warte(60 * 1000)
      t.chk('Lobby fertig, Standardserver wartet auf charlie', /✅ \*\*Lobby\*\*: 1\/1 online/.test(startText()) && /⏳ \*\*mc\.test\*\*: 2\/3 online \(\+1 gestoppt\)/.test(startText()), startText())
      await t.warte(20 * 60 * 1000)
      t.chk('Nach 20 Minuten: "nicht alle online"', /🟡 AFK-Manager gestartet – nicht alle online/.test(startText()), startText())
      t.chk('...mit dem, was fehlt', /⚠️ \*\*mc\.test\*\*: 2\/3 online \(\+1 gestoppt\) – fehlt: charlie/.test(startText()) && /✅ \*\*Lobby\*\*: 1\/1 online/.test(startText()), startText())
      t.chk('...und Erklärung', /Nach \d+ Min\. sind 3\/4 Accounts online/.test(startText()), startText())
      t.chk('Log: noch nicht alle online', t.logEnthaelt(/Start: nach \d+ Min\. noch nicht alle online \(mc\.test: charlie\)/))
      t.chk('Bis dahin keine einzelnen "Alle wieder online"', !alle().slice(vorher).some((m) => /Alle Accounts wieder online/.test(t.discord.text(m))), alle().slice(vorher).map(t.discord.text))
      // charlie kommt später doch -> normales "Alle Accounts wieder online (mc.test)"
      t.chk('charlie kommt doch', await t.alleEinloggenBis(async () => (await status('charlie')) === 'online', 200000))
      t.chk('Danach: "Alle Accounts wieder online (mc.test)" - der gestoppte zählt nicht', await t.warteBis(() => alle().slice(vorher).some((m) => /🟢 Alle Accounts wieder online \(mc\.test\) 3\/3 Accounts sind verbunden\. \(1 gestoppt\)/.test(t.discord.text(m))), 10000), alle().slice(vorher).map(t.discord.text))
      t.chk('...nicht für die Lobby (war ja schon komplett)', !alle().slice(vorher).some((m) => /Alle Accounts wieder online \(Lobby\)/.test(t.discord.text(m))))
      t.chk('Start-Meldung bleibt beim Endstand', /nicht alle online/.test(startText()))
      return
    }

    // ---- Phase 1: Start, alle kommen nach und nach ----
    t.chk('Start-Meldung ist da', await t.warteBis(() => !!start(), 60000))
    t.chk('Start-Meldung: Fortschritt pro Server', /Verbindet mit mc\.test, 4 Account\(s\) werden automatisch gestartet, 2 bleiben gestoppt\./.test(startText()) &&
      /⏳ \*\*mc\.test\*\*: 0\/3 online \(\+1 gestoppt\)/.test(startText()) && /⏳ \*\*Lobby\*\*: 0\/1 online/.test(startText()) && /⏹️ \*\*Event\\_Server\*\*: alle gestoppt/.test(startText()), startText())
    // Reihenfolge der Warteschlange: alpha, alpha@lobby, bravo, charlie
    await einloggen('mc.test', 'alpha')
    await einloggen('lobby.test', 'alpha')
    t.chk('Lobby fertig, Standardserver 1/3', await t.warteBis(() => /✅ \*\*Lobby\*\*: 1\/1 online/.test(startText()) && /⏳ \*\*mc\.test\*\*: 1\/3 online/.test(startText()), 60000), startText())
    const bearbeitet = start().edits || 0
    t.chk('Nicht bei jeder Kleinigkeit bearbeitet (höchstens alle 15 s)', bearbeitet >= 1 && bearbeitet <= 3, bearbeitet)
    await einloggen('mc.test', 'bravo')
    t.chk('Wird bearbeitet: 2/3', await t.warteBis(() => /⏳ \*\*mc\.test\*\*: 2\/3 online/.test(startText()), 60000), startText())
    await einloggen('mc.test', 'charlie')
    t.chk('Alle da: "alle Accounts online"', await t.warteBis(() => /🟢 AFK-Manager gestartet – alle Accounts online/.test(startText()), 30000), startText())
    t.chk('...mit allen Servern', /Alle 4 Account\(s\) auf allen 2 Servern sind online \(nach (unter 1|\d+) Min\.\)/.test(startText()) &&
      /✅ \*\*mc\.test\*\*: 3\/3 online \(\+1 gestoppt\)/.test(startText()) && /✅ \*\*Lobby\*\*: 1\/1 online/.test(startText()) && /⏹️ \*\*Event\\_Server\*\*: alle gestoppt/.test(startText()), startText())
    t.chk('Eine einzige Start-Meldung, keine einzelnen "Alle wieder online"', alle().filter((m) => /AFK-Manager gestartet/.test(t.discord.text(m))).length === 1 && !alle().some((m) => /Alle Accounts wieder online/.test(t.discord.text(m))), alle().map(t.discord.text))
    t.chk('Log: alle online', t.logEnthaelt(/Start: alle Accounts online \(nach/))

    // Danach wie gewohnt - jetzt mit Servernamen auch beim Standardserver
    await t.warte(20000)
    const fest = start().edits
    await t.api('POST', '/api/start/delta')
    await einloggen('mc.test', 'delta')
    t.chk('delta gestartet: keine Meldung, Start-Meldung bleibt', await t.warteBis(async () => (await status('delta')) === 'online', 10000) && start().edits === fest)
    const v = alle().length
    for (const n of ['alpha', 'bravo', 'charlie', 'delta']) bot('mc.test', n).kick(JSON.stringify({ text: 'Server startet neu' }))
    t.chk('Sammel-Kick mit Servername', await t.warteBis(() => alle().slice(v).some((m) => /4 Accounts wurden gekickt \(mc\.test\)/.test(t.discord.text(m))), 15000), alle().slice(v).map(t.discord.text))
    t.chk('Danach "Alle Accounts wieder online (mc.test)"', await t.alleEinloggenBis(() => alle().slice(v).some((m) => /🟢 Alle Accounts wieder online \(mc\.test\)/.test(t.discord.text(m)) && /4\/4 Accounts sind verbunden/.test(t.discord.text(m))), 300000), alle().slice(v).map(t.discord.text))
    t.chk('Start-Meldung bleibt danach unverändert', start().edits === fest && /alle Accounts online/.test(startText()), { fest, jetzt: start().edits })
    // für Phase 2 wieder wie am Anfang: delta gestoppt
    await t.api('POST', '/api/stop/delta')
    await t.warte(65 * 1000)
  },
}
