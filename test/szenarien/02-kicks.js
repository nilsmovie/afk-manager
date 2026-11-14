// Kicks: Sammelmeldung, Einzelmeldung mit Drossel, Reconnect in Listenreihenfolge, Alle online/offline
module.exports = {
  name: 'Kicks, Reconnect und Alle-online/offline-Meldungen',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }, { username: 'charlie' }],
  async run (t) {
    const alleOnline = async () => (await t.liste()).every((a) => a.status === 'online')
    for (const n of ['alpha', 'bravo', 'charlie']) {
      await t.warteBis(() => t.java(n) && !t.java(n).beendet && !t.java(n).__eingeloggt, 20000)
      t.java(n).__eingeloggt = true
      t.java(n).einloggen()
    }
    t.chk('Alle online', await t.warteBis(alleOnline, 5000))
    const meldungen = () => t.discord.nachrichten('MELDUNGEN').map(t.discord.text)
    await t.warteBis(() => meldungen().length > 0, 5000)
    const vorher = meldungen().length

    // Massen-Kick (Server-Neustart): eine Sammelmeldung, keine "Alle offline"-Meldung
    for (const n of ['charlie', 'alpha', 'bravo']) t.java(n).kick(JSON.stringify({ text: 'Server startet neu' }))
    await t.warte(9000)
    const neu = meldungen().slice(vorher)
    t.chk('Eine Sammelmeldung für 3 Accounts', neu.filter((m) => /3 Accounts wurden gekickt/.test(m)).length === 1 && neu.some((m) => /Server startet neu/.test(m)), neu)
    t.chk('Sammelmeldung nennt alle', neu.some((m) => /alpha/.test(m) && /bravo/.test(m) && /charlie/.test(m)))
    t.chk('Keine "Alle offline"-Meldung bei Massen-Kick', !neu.some((m) => /Alle Accounts offline/.test(m)), neu)

    // Reconnect in Listenreihenfolge (nicht in Kick-Reihenfolge)
    t.chk('Reconnect: zuerst alpha', await t.warteBis(() => t.javaAlle('alpha').length === 2, 30000) && t.javaAlle('charlie').length === 1 && t.javaAlle('bravo').length === 1)
    t.java('alpha').einloggen()
    t.chk('dann bravo', await t.warteBis(() => t.javaAlle('bravo').length === 2, 30000) && t.javaAlle('charlie').length === 1)
    t.java('bravo').einloggen()
    t.chk('dann charlie', await t.warteBis(() => t.javaAlle('charlie').length === 2, 30000))
    const v2 = meldungen().length
    t.java('charlie').einloggen()
    t.chk('"Alle wieder online" nach dem letzten', await t.warteBis(() => meldungen().slice(v2).some((m) => /Alle Accounts wieder online/.test(m) && /3\/3/.test(m)), 5000), meldungen().slice(v2))

    // Einzelner Kick: Einzelmeldung, zweiter Kick innerhalb von 5 Minuten wird nicht gemeldet
    const v3 = meldungen().length
    t.java('bravo').kick(JSON.stringify({ text: 'Du warst zu lange AFK' }))
    await t.warte(9000)
    t.chk('Einzelmeldung', meldungen().slice(v3).some((m) => /bravo wurde gekickt/.test(m) && /zu lange AFK/.test(m)), meldungen().slice(v3))
    await t.warteBis(() => t.javaAlle('bravo').length === 3, 30000)
    // vor dem Login gleich nochmal gekickt -> keine zweite Meldung (Drossel)
    const v4 = meldungen().length
    t.java('bravo').kick(JSON.stringify({ text: 'Du warst zu lange AFK' }))
    await t.warte(9000)
    t.chk('Zweiter Kick kurz danach: keine neue Meldung', !meldungen().slice(v4).some((m) => /bravo wurde gekickt/.test(m)), meldungen().slice(v4))

    // Alle stoppen -> "Alle offline"; alle starten -> sobald alle da sind "Alle wieder online"
    await t.api('POST', '/api/stop-all')
    t.chk('Stop-all: "Alle Accounts offline"', await t.warteBis(() => meldungen().some((m) => /Alle Accounts offline/.test(m)), 5000))
    const v5 = meldungen().length
    await t.api('POST', '/api/start-all')
    for (const n of ['alpha', 'bravo', 'charlie']) {
      const anzahl = t.javaAlle(n).length
      await t.warteBis(() => t.javaAlle(n).length > anzahl, 30000)
      t.java(n).einloggen()
    }
    t.chk('Start-all: wieder "Alle online"', await t.warteBis(() => meldungen().slice(v5).some((m) => /Alle Accounts wieder online/.test(m)), 5000))
  },
}
