// Neustart: Daten bleiben, Autostart in Reihenfolge, offene "anderswo"-Meldung wird aktualisiert
module.exports = {
  name: 'Neustart des AFK-Managers',
  phasen: 2,
  accounts: [{ username: 'alpha', notifyElsewhere: true }, { username: 'bravo' }],
  async run (t) {
    if (t.PHASE === 1) {
      await t.warteBis(() => t.java('alpha'), 20000)
      t.java('alpha').einloggen()
      await t.warteBis(() => t.java('bravo'), 20000)
      t.java('bravo').einloggen()
      await t.api('POST', '/api/accounts/bravo/autochat', { text: '/hide', delaySeconds: 1 })
      t.java('alpha').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
      t.chk('Meldung gemerkt', await t.warteBis(() => t.datei('accounts.json').find((a) => a.username === 'alpha').elsewhereNotice, 5000))
      require('fs').writeFileSync(require('path').join(t.lauf, 'phase1.json'), JSON.stringify(t.datei('accounts.json').find((a) => a.username === 'alpha').elsewhereNotice))
      return
    }
    // Phase 2: frisch gestartet
    const notice = t.datei('phase1.json')
    t.chk('Autostart: alpha zuerst', await t.warteBis(() => t.java('alpha'), 20000) && !t.java('bravo'))
    t.chk('Meldung nach Neustart aktualisiert', await t.warteBis(() => /nach einem Neustart des AFK-Managers wieder gestartet/.test((t.discord.nachrichten().find((m) => m.id === notice.messageId) || {}).content), 10000))
    t.java('alpha').einloggen()
    await t.warteBis(() => t.java('bravo'), 20000)
    t.java('bravo').einloggen()
    await t.warte(3000)
    t.chk('Auto-Chat und everJoined überleben den Neustart', t.java('bravo').gesendet.includes('/hide'), t.java('bravo').gesendet)
    t.chk('Benutzer bleiben (Login klappt)', await t.login('nils', 'testpw'))
  },
}
