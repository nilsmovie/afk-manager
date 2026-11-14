// "Anderswo eingeloggt": kein Auto-Reconnect, Meldung mit Knopf, Aktualisierung beim Start, Chat-Quelle weicht aus
module.exports = {
  name: 'Anderswo eingeloggt',
  accounts: [{ username: 'alpha', preferredChatSource: true, notifyElsewhere: true }, { username: 'bravo', notifyElsewhere: false }],
  async run (t) {
    for (const n of ['alpha', 'bravo']) { await t.warteBis(() => t.java(n), 20000); t.java(n).einloggen() }
    await t.warteBis(async () => (await t.liste()).every((a) => a.status === 'online'), 5000)
    const chatState = async () => (await t.api('GET', '/api/chat-state')).data
    t.chk('Chat-Quelle ist alpha', (await chatState()).primary === 'alpha')

    t.java('alpha').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
    await t.warteBis(() => t.datei('accounts.json').find((a) => a.username === 'alpha').elsewhereNotice, 5000)
    const notice = t.datei('accounts.json').find((a) => a.username === 'alpha').elsewhereNotice
    const msg = notice && t.discord.nachrichten('MELDUNGEN').find((m) => m.id === notice.messageId)
    t.chk('Meldung mit Start-Knopf', msg && /alpha\*\* ist anderswo eingeloggt/.test(msg.content) && JSON.stringify(msg.components).includes('start_alpha'), msg)
    t.chk('Chat-Quelle weicht auf bravo aus', (await chatState()).primary === 'bravo')
    await t.warte(60000)
    t.chk('Kein Auto-Reconnect', t.javaAlle('alpha').length === 1)
    t.chk('Status gestoppt', (await t.status('alpha')) === 'gestoppt', await t.status('alpha'))

    // Start über das Dashboard -> Meldung wird bearbeitet
    await t.api('POST', '/api/start/alpha')
    t.chk('Meldung bearbeitet (Dashboard)', await t.warteBis(() => /über das Dashboard \(nils\) wieder gestartet/.test(t.discord.nachrichten().find((m) => m.id === notice.messageId).content), 5000))
    t.chk('Knopf entfernt', t.discord.nachrichten().find((m) => m.id === notice.messageId).components.length === 0)
    await t.warteBis(() => t.javaAlle('alpha').length === 2, 5000)
    t.java('alpha').einloggen()
    t.chk('alpha zurück -> Chat-Quelle wieder alpha', await t.warteBis(async () => (await chatState()).primary === 'alpha', 5000))

    // Knopf drücken
    t.java('alpha').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
    await t.warteBis(() => { const n = t.datei('accounts.json').find((a) => a.username === 'alpha').elsewhereNotice; return n && n.messageId !== notice.messageId }, 5000)
    const n2 = t.datei('accounts.json').find((a) => a.username === 'alpha').elsewhereNotice
    const m2 = t.discord.nachrichten().find((m) => m.id === n2.messageId)
    const antworten = t.discord.knopf('start_alpha', m2)
    t.chk('Knopf: Account startet', await t.warteBis(() => t.javaAlle('alpha').length === 3, 5000))
    t.chk('Knopf: Antwort "wird jetzt gestartet"', antworten.length === 1 && /wird jetzt gestartet/.test(antworten[0].content))
    t.chk('Knopf: keine zusätzliche Bearbeitung', !t.discord.nachrichten().find((m) => m.id === n2.messageId).edits)
    t.java('alpha').einloggen()

    // Ohne Glocke: keine Meldung
    const vorher = t.discord.nachrichten('MELDUNGEN').length
    t.java('bravo').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
    await t.warte(9000)
    t.chk('Glocke aus: keine Discord-Meldung', !t.discord.nachrichten('MELDUNGEN').slice(vorher).some((m) => /bravo/.test(t.discord.text(m))), t.discord.nachrichten('MELDUNGEN').slice(vorher).map(t.discord.text))
    t.chk('Glocke aus: trotzdem kein Auto-Reconnect', (await t.warte(30000), t.javaAlle('bravo').length === 1))
  },
}
