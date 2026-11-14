// Umbenennen und Löschen nehmen alle Zustände des Accounts mit (Statistik, Auto-Chat, Rechte)
module.exports = {
  name: 'Umbenennen und Löschen',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }, { username: 'charlie' }],
  async run (t) {
    for (const n of ['alpha', 'bravo', 'charlie']) {
      await t.warteBis(() => t.java(n), 30000)
      t.java(n).einloggen()
    }
    await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['bravo', 'charlie'] })
    await t.api('POST', '/api/accounts/bravo/autochat', { text: '/afk', delaySeconds: 1 })
    await t.warte(10 * 60 * 1000)
    const vorher = (await t.liste()).find((a) => a.username === 'bravo').uptimeMs
    t.chk('Online-Zeit läuft', vorher >= 9 * 60 * 1000, vorher)

    // Umbenennen (nur gestoppt erlaubt)
    await t.api('POST', '/api/stop/bravo')
    let r = await t.api('POST', '/api/accounts/bravo/rename', { newUsername: 'bravo2' })
    t.chk('Umbenennen klappt', r.status === 200, r)
    const neu = (await t.liste()).find((a) => a.username === 'bravo2')
    t.chk('Online-Zeit zieht mit um', neu && neu.uptimeMs >= vorher, neu)
    t.chk('Kein alter Eintrag mehr', !(await t.liste()).some((a) => a.username === 'bravo'))
    t.chk('Rechte ziehen mit um', (await t.liste('paul')).map((a) => a.username).sort().join() === 'bravo2,charlie', await t.liste('paul'))
    await t.api('POST', '/api/start/bravo2')
    t.chk('Start unter neuem Namen', await t.warteBis(() => t.javaAlle('bravo').length === 2, 30000))
    t.java('bravo').einloggen()
    await t.warte(3000)
    t.chk('Auto-Chat bleibt', t.java('bravo').gesendet.includes('/afk'), t.java('bravo').gesendet)

    // Löschen eines laufenden Accounts
    r = await t.api('DELETE', '/api/accounts/charlie')
    t.chk('Löschen klappt', r.status === 200, r)
    t.chk('Bot wird beendet', await t.warteBis(() => t.java('charlie').beendet, 5000))
    t.chk('Aus accounts.json entfernt', !t.datei('accounts.json').some((a) => a.username === 'charlie'))
    t.chk('Aus den Rechten entfernt', (await t.liste('paul')).map((a) => a.username).join() === 'bravo2')
    const anzahl = t.javaAlle('charlie').length
    await t.warte(3 * 60 * 1000)
    t.chk('Kein Reconnect nach dem Löschen', t.javaAlle('charlie').length === anzahl)
  },
}
