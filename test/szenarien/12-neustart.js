// Neustart: Daten bleiben, Autostart; ein "anderswo eingeloggter" Account bleibt gestoppt
// (sonst würfe der Neustart den echten Spieler raus), seine Meldung wird beim Start aktualisiert
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
    const inhalt = () => (t.discord.nachrichten().find((m) => m.id === notice.messageId) || {}).content || ''
    t.chk('Autostart: bravo startet', await t.warteBis(() => t.java('bravo'), 20000))
    t.chk('"anderswo eingeloggter" alpha bleibt gestoppt', !t.java('alpha') && (await t.status('alpha')) === 'gestoppt', await t.status('alpha'))
    t.chk('Im Log vermerkt', t.logEnthaelt(/Auto-Start übersprungen \(war gestoppt.*alpha/))
    t.java('bravo').einloggen()
    await t.warte(3000)
    t.chk('Auto-Chat und everJoined überleben den Neustart', t.java('bravo').gesendet.includes('/hide'), t.java('bravo').gesendet)
    t.chk('Meldung mit Knopf bleibt, solange alpha aus ist', !/wieder gestartet/.test(inhalt()), inhalt())
    await t.api('POST', '/api/start/alpha')
    t.chk('Start: alpha verbindet', await t.warteBis(() => t.java('alpha'), 20000))
    t.chk('Meldung beim Start aktualisiert', await t.warteBis(() => /über das Dashboard \(nils\) wieder gestartet/.test(inhalt()), 10000), inhalt())
    t.chk('Merker "gestoppt" ist weg', !t.datei('accounts.json').find((a) => a.username === 'alpha').stopped)
    t.chk('Benutzer bleiben (Login klappt)', await t.login('nils', 'testpw'))
  },
}
