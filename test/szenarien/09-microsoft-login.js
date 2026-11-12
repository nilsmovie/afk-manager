// Microsoft-Login-Codes: Meldung, Warteschlange läuft weiter, Ablauf, Pause nach 4 Codes
module.exports = {
  name: 'Microsoft-Login-Codes',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }],
  async run (t) {
    await t.warteBis(() => t.java('alpha'), 20000)
    t.java('alpha').code({ user_code: 'CODE1', expires_in: 120 })
    t.chk('Status: Login nötig', await t.warteBis(async () => /Login nötig/.test(await t.status('alpha')), 5000))
    t.chk('Discord: Code-Meldung mit Link', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /Login nötig für alpha/.test(t.discord.text(m)) && /otc=CODE1/.test(t.discord.text(m))), 5000))
    const alt = t.discord.nachrichten('MELDUNGEN').find((m) => /otc=CODE1/.test(t.discord.text(m)))
    t.chk('Warteschlange läuft weiter (bravo startet)', await t.warteBis(() => t.java('bravo'), 30000))
    t.java('bravo').einloggen()

    // Code läuft ab (120 s + 30 s Puffer) -> neuer Versuch
    t.chk('Abgelaufener Code: neuer Versuch', await t.warteBis(() => t.javaAlle('alpha').length === 2, 200000))
    t.chk('Alte Code-Meldung wird aktualisiert', /abgelaufen/.test(t.discord.text(t.discord.nachrichten().find((m) => m.id === alt.id))))
    t.java('alpha').code({ user_code: 'CODE2', expires_in: 120 })
    await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /otc=CODE2/.test(t.discord.text(m))), 5000)
    const m2 = t.discord.nachrichten('MELDUNGEN').find((m) => /otc=CODE2/.test(t.discord.text(m)))
    t.java('alpha').einloggen()
    t.chk('Login -> online', await t.warteBis(async () => (await t.status('alpha')) === 'online', 5000))
    t.chk('Code-Meldung: angemeldet', await t.warteBis(() => /ist angemeldet/.test(t.discord.text(t.discord.nachrichten().find((m) => m.id === m2.id))), 5000))

    // 4 Codes ohne Eingabe -> Pause
    await t.api('POST', '/api/stop/bravo')
    await t.api('POST', '/api/start/bravo')
    for (let i = 1; i <= 4; i++) {
      await t.warteBis(() => t.javaAlle('bravo').length === 1 + i, 200000)
      t.java('bravo').code({ user_code: `B${i}`, expires_in: 60 })
    }
    t.chk('Nach 4 Codes: pausiert', await t.warteBis(async () => /Start drücken/.test(await t.status('bravo')), 200000), await t.status('bravo'))
    await t.warte(120000)
    t.chk('Pausiert: kein weiterer Versuch', t.javaAlle('bravo').length === 5)
    await t.api('POST', '/api/start/bravo')
    t.chk('Start hebt die Pause auf', await t.warteBis(() => t.javaAlle('bravo').length === 6, 5000))
  },
}
