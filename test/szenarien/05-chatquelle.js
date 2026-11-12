// Chat-Quelle: nur deren Chat landet im Verlauf, in Discord und bei Erweiterungen; automatischer Wechsel
const EXT = `module.exports = (api) => {
  const zeilen = []
  api.onChat((e) => zeilen.push(e))
  api.app.get('/api/test-chat', api.requireOwner, (req, res) => res.json(zeilen))
}`
module.exports = {
  name: 'Chat-Quelle und Chat-Spiegel',
  accounts: [{ username: 'alpha', preferredChatSource: true }, { username: 'bravo' }, { username: 'charlie' }],
  dateien: { 'erweiterungen/test-chat.js': EXT },
  async run (t) {
    for (const n of ['alpha', 'bravo', 'charlie']) { await t.warteBis(() => t.java(n), 20000); t.java(n).einloggen() }
    const cs = async () => (await t.api('GET', '/api/chat-state')).data
    t.chk('Chat-Quelle alpha', (await cs()).primary === 'alpha' && (await cs()).active === true)
    t.java('alpha').chatEmpfangen('[Spieler] Bob: hallo zusammen')
    t.java('bravo').chatEmpfangen('[Spieler] Bob: hallo zusammen')
    await t.warte(3000)
    const verlauf = (await cs()).history.filter((h) => /hallo zusammen/.test(h.text))
    t.chk('Verlauf: Zeile genau einmal (von alpha)', verlauf.length === 1 && verlauf[0].username === 'alpha', verlauf)
    t.chk('Discord-Chat-Kanal bekommt die Zeile', await t.warteBis(() => t.discord.nachrichten('CHAT').some((m) => /hallo zusammen/.test(m.content)), 5000))
    const ext = (await t.api('GET', '/api/test-chat')).data
    t.chk('Erweiterung bekommt die Zeile mit Account und Zeit', ext.filter((e) => /hallo zusammen/.test(e.text)).length === 1 && ext.find((e) => /hallo zusammen/.test(e.text)).account === 'alpha' && typeof ext[0].ts === 'number', ext)

    // alpha fällt aus (normaler Trennung) -> beim nächsten Login wird die Quelle neu bewertet
    t.java('alpha').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
    t.chk('alpha anderswo -> Quelle bravo', await t.warteBis(async () => (await cs()).primary === 'bravo', 5000))
    t.java('bravo').chatEmpfangen('[Spieler] Eve: jetzt über bravo')
    await t.warte(2000)
    t.chk('Verlauf jetzt von bravo', (await cs()).history.some((h) => h.username === 'bravo' && /über bravo/.test(h.text)))

    // Manuell festlegen
    let r = await t.api('POST', '/api/accounts/charlie/make-primary')
    t.chk('make-primary', r.status === 200 && (await cs()).primary === 'charlie')
    t.chk('preferredChatSource gespeichert', t.datei('accounts.json').filter((a) => a.preferredChatSource).map((a) => a.username).join() === 'charlie')
    // alpha kommt zurück: bleibt bei charlie (charlie ist jetzt der bevorzugte)
    await t.api('POST', '/api/start/alpha')
    await t.warteBis(() => t.javaAlle('alpha').length === 2, 5000)
    t.java('alpha').einloggen()
    await t.warte(2000)
    t.chk('Bevorzugte Quelle charlie bleibt', (await cs()).primary === 'charlie')

    // Bevorzugte Quelle fällt aus und kommt zurück -> automatischer Rückwechsel
    t.java('charlie').kick(JSON.stringify({ translate: 'multiplayer.disconnect.duplicate_login' }))
    t.chk('charlie weg -> Quelle wechselt', await t.warteBis(async () => (await cs()).primary !== 'charlie', 5000))
    await t.api('POST', '/api/start/charlie')
    await t.warteBis(() => t.javaAlle('charlie').length === 2, 5000)
    t.java('charlie').einloggen()
    t.chk('charlie zurück -> Quelle wieder charlie', await t.warteBis(async () => (await cs()).primary === 'charlie', 5000))

    // Nachricht senden über das Dashboard
    r = await t.api('POST', '/api/chat', { username: 'bravo', message: '/spawn' })
    t.chk('Dashboard-Chat über bravo', r.status === 200 && t.java('bravo').gesendet.includes('/spawn'))
    r = await t.api('POST', '/api/chat', { username: 'alpha', message: 'x' })
    t.chk('Dashboard-Chat ohne laufenden Bot: Fehler', r.status === 200 || r.status === 400)
  },
}
