// Auto-Chat: nicht beim allerersten Beitritt, danach bei jedem Verbinden einmal (nicht bei Dimensionswechseln)
module.exports = {
  name: 'Auto-Chat und everJoined',
  accounts: [
    { username: 'alpha', everJoined: false, autoChat: [{ text: '/hide', delaySeconds: 5 }] },
    { username: 'bravo', everJoined: true, autoChat: [{ text: '/hide', delaySeconds: 5 }, { text: 'hallo', delaySeconds: 20 }] },
  ],
  async run (t) {
    await t.warteBis(() => t.java('alpha'), 20000)
    t.java('alpha').einloggen()
    await t.warte(10000)
    t.chk('Erster Beitritt: kein Auto-Chat', t.java('alpha').gesendet.length === 0, t.java('alpha').gesendet)
    t.chk('everJoined wird gespeichert', t.datei('accounts.json').find((a) => a.username === 'alpha').everJoined === true)

    await t.warteBis(() => t.java('bravo'), 20000)
    t.java('bravo').einloggen()
    await t.warte(3000)
    t.chk('Auto-Chat wartet die Verzögerung ab', t.java('bravo').gesendet.length === 0)
    await t.warte(25000)
    t.chk('Auto-Chat in Reihenfolge', JSON.stringify(t.java('bravo').gesendet) === JSON.stringify(['/hide', 'hallo']), t.java('bravo').gesendet)
    t.java('bravo').spawn() // Dimensionswechsel
    await t.warte(25000)
    t.chk('Dimensionswechsel: nicht nochmal', t.java('bravo').gesendet.length === 2, t.java('bravo').gesendet)

    // alpha nach Reconnect: jetzt mit Auto-Chat
    t.java('alpha').trennen()
    await t.warteBis(() => t.javaAlle('alpha').length === 2, 30000)
    t.java('alpha').einloggen()
    await t.warte(8000)
    t.chk('Nach Reconnect: Auto-Chat', JSON.stringify(t.java('alpha').gesendet) === JSON.stringify(['/hide']), t.java('alpha').gesendet)

    // Auto-Chat über die API pflegen
    let r = await t.api('POST', '/api/accounts/alpha/autochat', { text: '/spawn', delaySeconds: 2 })
    t.chk('Auto-Chat hinzufügen', r.status === 200 && r.data.autoChat.length === 2)
    r = await t.api('DELETE', '/api/accounts/alpha/autochat/0')
    t.chk('Auto-Chat entfernen', r.status === 200 && r.data.autoChat.length === 1 && r.data.autoChat[0].text === '/spawn')
    t.chk('Gespeichert', JSON.stringify(t.datei('accounts.json').find((a) => a.username === 'alpha').autoChat) === JSON.stringify([{ text: '/spawn', delaySeconds: 2 }]))
    r = await t.api('GET', '/api/accounts/alpha/autochat')
    t.chk('Auto-Chat lesen', r.data.autoChat.length === 1)

    // Stop bricht ausstehende Auto-Chats ab
    t.java('alpha').trennen()
    await t.warteBis(() => t.javaAlle('alpha').length === 3, 30000)
    t.java('alpha').einloggen()
    await t.api('POST', '/api/stop/alpha')
    await t.warte(5000)
    t.chk('Stop: ausstehender Auto-Chat entfällt', t.java('alpha').gesendet.length === 0, t.java('alpha').gesendet)
  },
}
