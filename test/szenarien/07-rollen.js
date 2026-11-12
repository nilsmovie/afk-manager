// Rollen: User sehen und steuern nur ihre Accounts, Protokoll nur für den Owner
module.exports = {
  name: 'Rollen und Rechte',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }],
  async run (t) {
    await t.warteBis(() => t.java('alpha'), 20000)
    t.java('alpha').einloggen()
    await t.warteBis(() => t.java('bravo'), 20000)
    t.java('bravo').einloggen()
    let r = await t.api('POST', '/api/users', { username: 'toni', password: 'geheim123', role: 'admin', allowedAccounts: [] })
    t.chk('Admin anlegen', r.status === 200, r)
    r = await t.api('POST', '/api/users', { username: 'paul', password: 'geheim123', role: 'user', allowedAccounts: ['alpha'] })
    t.chk('User anlegen', r.status === 200, r)

    const paulListe = await t.liste('paul')
    t.chk('User sieht nur seinen Account', paulListe.length === 1 && paulListe[0].username === 'alpha', paulListe)
    t.chk('User: fremden Account starten verboten', (await t.api('POST', '/api/stop/bravo', undefined, 'paul')).status === 403)
    t.chk('User: eigenen Account stoppen erlaubt', (await t.api('POST', '/api/stop/alpha', undefined, 'paul')).status === 200)
    t.chk('User: Chat über fremden Account verboten', (await t.api('POST', '/api/chat', { username: 'bravo', message: 'x' }, 'paul')).status === 403)
    t.chk('User: Steuerung fremder Account verboten', (await t.api('POST', '/api/control/bravo/move', { direction: 'forward', state: true }, 'paul')).status === 403)
    t.chk('User: Account anlegen verboten', (await t.api('POST', '/api/accounts', { username: 'neu' }, 'paul')).status === 403)
    t.chk('User: Protokoll verboten', (await t.api('GET', '/api/audit', undefined, 'paul')).status === 403)
    t.chk('Admin: Protokoll verboten', (await t.api('GET', '/api/audit', undefined, 'toni')).status === 403)
    t.chk('Admin: sieht alle Accounts', (await t.liste('toni')).length === 2)
    t.chk('Admin: Account anlegen erlaubt', (await t.api('POST', '/api/accounts', { username: 'delta' }, 'toni')).status === 200)
    const audit = await t.api('GET', '/api/audit')
    t.chk('Owner: Protokoll mit den Aktionen', audit.status === 200 && audit.data.entries.some((e) => e.action === 'Gestoppt' && e.target === 'alpha' && e.who === 'paul'), audit.data && audit.data.entries && audit.data.entries.slice(0, 5))
    t.chk('Ohne Anmeldung: API gesperrt', (await fetch(`http://127.0.0.1:${process.env.PORT}/api/accounts`)).status === 401)

    // Steuerung
    r = await t.api('POST', '/api/control/bravo/move', { direction: 'forward', state: true })
    t.chk('Steuerung: Laufen', r.status === 200 && t.java('bravo').steuerung.some((s) => s[0] === 'forward' && s[1] === true), t.java('bravo').steuerung)
    r = await t.api('POST', '/api/control/bravo/hotbar', { slot: 3 })
    t.chk('Steuerung: Hotbar', r.status === 200 && t.java('bravo').steuerung.some((s) => s[0] === 'hotbar' && s[1] === 3), r)
    t.java('bravo').players = { bravo: {}, Steve: {} }
    r = await t.api('GET', '/api/players/bravo')
    t.chk('Spielerliste ohne sich selbst', JSON.stringify(r.data.players) === '["Steve"]', r.data)

    // Ungueltige Namen
    t.chk('Account mit <script> abgelehnt', (await t.api('POST', '/api/accounts', { username: '<script>' })).status === 400)
  },
}
