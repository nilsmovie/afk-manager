// Warteschlange: strikt einer nach dem anderen, von oben nach unten; bei Fehlschlag derselbe nochmal
module.exports = {
  name: 'Warteschlange beim Start und bei Fehlschlägen',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }, { username: 'charlie' }],
  async run (t) {
    await t.warteBis(() => t.javaBots.length >= 1, 5000)
    t.chk('Start: zuerst nur alpha', t.javaBots.length === 1 && t.javaBots[0].username === 'alpha', t.javaBots.map((b) => b.username))
    t.chk('Verbindet mit dem Standardserver', t.javaBots[0].opts.host === 'mc.test' && t.javaBots[0].opts.port === 25565)
    t.chk('Login über den festen Cache-Schlüssel', t.javaBots[0].opts.username === 'alpha' && t.javaBots[0].opts.auth === 'microsoft')
    await t.warte(30000)
    t.chk('Ohne Login von alpha startet bravo nicht', t.javaBots.length === 1)

    // Zeit auf der Testuhr messen statt fest zu warten - auf einem ausgelasteten Rechner
    // (z.B. neben dem laufenden Manager) dauern die Abfragen sonst zu lange
    const loginZeit = t.zeit.jetzt()
    t.java('alpha').einloggen()
    t.chk('alpha ist online', await t.warteBis(async () => (await t.status('alpha')) === 'online', 5000))
    let bravoZeit = null
    const bravoKam = await t.warteBis(() => {
      if (t.java('bravo')) { bravoZeit = t.zeit.jetzt(); return true }
      return false
    }, 30000)
    t.chk('bravo kommt erst nach der Pause von 10 s', bravoKam && bravoZeit - loginZeit >= 9500, bravoZeit && `${Math.round((bravoZeit - loginZeit) / 100) / 10} s`)
    t.chk('Danach startet bravo', bravoKam)

    // bravo scheitert vor dem Login -> nach 60 s nochmal bravo, charlie wartet
    t.java('bravo').trennen()
    await t.warte(2000)
    t.chk('Status: erneuter Versuch', /Erneuter Versuch in 60s/.test(await t.status('bravo')), await t.status('bravo'))
    await t.warte(40000)
    t.chk('In der Zwischenzeit startet charlie nicht', !t.java('charlie'))
    t.chk('Nach 60 s wird bravo erneut versucht', await t.warteBis(() => t.javaAlle('bravo').length === 2, 30000))
    t.java('bravo').einloggen()
    t.chk('Dann charlie', await t.warteBis(() => t.java('charlie'), 15000))
    t.java('charlie').einloggen()
    await t.warte(2000)
    const liste = await t.liste()
    t.chk('Alle drei online', liste.every((a) => a.status === 'online'), liste.map((a) => `${a.username}:${a.status}`))

    // Watchdog: haengt ein Login ohne login/end, wird nach 45 s abgebrochen und erneut versucht
    await t.api('POST', '/api/stop/charlie')
    await t.warte(1000)
    t.chk('Stop -> gestoppt', (await t.status('charlie')) === 'gestoppt')
    await t.api('POST', '/api/start/charlie')
    t.chk('Start -> neuer Versuch', await t.warteBis(() => t.javaAlle('charlie').length === 2, 5000))
    t.chk('Hängender Login: Sicherheitsnetz nach 45 s', await t.warteBis(() => t.logEnthaelt(/Sequenz-Sicherheitsnetz ausgeloest fuer charlie/), 60000))
    t.chk('...und nach 60 s ein neuer Versuch', await t.warteBis(() => t.javaAlle('charlie').length === 3, 70000))
  },
}
