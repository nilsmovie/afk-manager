// Server mit eigenem Ressourcenpaket: im Spiel angenommen (ohne Download), während der
// Konfiguration übernimmt das mineflayer selbst; der Account bleibt online
module.exports = {
  name: 'Ressourcenpaket',
  accounts: [{ username: 'alpha' }],
  async run (t) {
    await t.warteBis(() => t.java('alpha'), 20000)
    t.java('alpha').ressourcenpaket('configuration')
    t.chk('Während der Konfiguration: nicht doppelt beantworten', t.java('alpha').paketeAngenommen === 0)
    t.java('alpha').einloggen()
    t.java('alpha').ressourcenpaket('play')
    await t.warte(500)
    t.chk('Im Spiel: angenommen', t.java('alpha').paketeAngenommen === 1)
    t.chk('Im Log vermerkt', t.logEnthaelt(/Ressourcenpaket - angenommen/))
    t.chk('Account bleibt online', (await t.status('alpha')) === 'online')
  },
}
