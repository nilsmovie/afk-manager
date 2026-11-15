// Microsoft lehnt die Anmeldung nach der Code-Eingabe ab ("user interaction is required"):
// (1) Die Login-Bibliothek wartet nicht mehr 15 Minuten weiter, sondern meldet es sofort.
// (2) Der Manager pausiert den Login mit verständlichem Status, Chat- und Discord-Meldung;
//     Start drücken versucht es neu. Gilt für Java und Bedrock.
const path = require('path')

module.exports = {
  name: 'Microsoft lehnt Login ab',
  accounts: [{ username: 'alpha' }, { username: '.nils' }, { username: 'bravo' }],
  async run (t) {
    // ---------- (1) Login-Bibliothek ----------
    const ml = require(path.join(__dirname, '..', '..', 'microsoft-login'))
    ml.install()
    const LTM = require(path.join(__dirname, '..', '..', 'node_modules', 'prismarine-auth', 'src', 'TokenManagers', 'LiveTokenManager'))
    const echt = global.fetch
    const ablauf = async (antworten) => {
      const anfragen = []
      global.fetch = async (url, opts) => {
        anfragen.push(String(url))
        if (/oauth20_connect/.test(url)) {
          return { status: 200, headers: { get: () => 'MSPOK=abc; path=/' }, json: async () => ({ user_code: 'ABCD1234', device_code: 'dev', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, interval: 1 }) }
        }
        const a = antworten.shift()
        if (a instanceof Error) throw a
        return { status: 200, json: async () => a || { error: 'authorization_pending' } }
      }
      const m = new LTM('00000000441cc96b', ['service::user.auth.xboxlive.com::MBI_SSL'], { setCachedPartial: async () => {} })
      let code = null
      const start = Date.now()
      try {
        const r = await m.authDeviceCode((d) => { code = d })
        return { ok: true, r, code, anfragen, ms: Date.now() - start }
      } catch (e) {
        return { ok: false, e, code, anfragen, ms: Date.now() - start }
      } finally {
        global.fetch = echt
      }
    }
    let r = await ablauf([{ error: 'authorization_pending' }, { error: 'invalid_grant', error_description: 'The user could not be authenticated or user interaction is required.' }, { error: 'invalid_grant', error_description: 'already been used' }])
    t.chk('Ablehnung: sofort Fehler statt 15 Min. warten', !r.ok && r.e.code === ml.REJECTED && /abgelehnt \(invalid_grant\): The user could not be authenticated/.test(r.e.message) && r.anfragen.length === 3, r.e && r.e.message)
    t.chk('Code wurde wie gewohnt gemeldet', r.code && r.code.user_code === 'ABCD1234' && /otc=ABCD1234/.test(r.code.message))
    r = await ablauf([{ error: 'authorization_pending' }, new Error('fetch failed'), { error: 'slow_down' }, { access_token: 'TOKEN', refresh_token: 'R' }])
    t.chk('Netzwerkfehler und slow_down: weiter warten, dann klappt es', r.ok && r.r.accessToken === 'TOKEN', r.e && r.e.message)
    t.chk('Netzwerkfehler: einmal im Log', t.logEnthaelt(/\[Microsoft-Login\] Nachfragen bei Microsoft fehlgeschlagen \(fetch failed\)/))

    // ---------- (2) Manager: Java ----------
    t.chk('alpha startet', await t.warteBis(() => t.java('alpha'), 20000))
    const a = t.java('alpha')
    a.code({ user_code: 'JCODE', expires_in: 900 })
    t.chk('Java: Login nötig', await t.warteBis(async () => /Login nötig \(Code/.test(await t.status('alpha')), 5000))
    t.chk('Java: Code in Discord', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /otc=JCODE/.test(t.discord.text(m))), 5000))
    const meldung = t.discord.nachrichten('MELDUNGEN').find((m) => /otc=JCODE/.test(t.discord.text(m)))
    const err = Object.assign(new Error('Microsoft hat die Anmeldung abgelehnt (invalid_grant): The user could not be authenticated or user interaction is required.'), { code: ml.REJECTED })
    a.emit('error', err)
    t.chk('Java: Status "Microsoft lehnt Login ab"', await t.warteBis(async () => (await t.status('alpha')) === 'Microsoft lehnt Login ab – Konto prüfen', 5000), await t.status('alpha'))
    t.chk('Java: Erklärung im Chat', t.logEnthaelt(/\[alpha\] --- Microsoft hat die Anmeldung abgelehnt \(invalid_grant\): The user could not be authenticated/) && t.logEnthaelt(/\[alpha\] --- Bitte das Microsoft-Konto prüfen/))
    t.chk('Java: Discord-Meldung "abgelehnt" mit Start-Knopf', await t.warteBis(() => {
      const m = t.discord.nachrichten().find((x) => x.id === meldung.id)
      return m && /Login für alpha abgelehnt/.test(t.discord.text(m)) && /user interaction is required/.test(t.discord.text(m)) && JSON.stringify(m.components || []).includes('start')
    }, 5000), t.discord.text(t.discord.nachrichten().find((x) => x.id === meldung.id)))
    const anzahl = t.javaAlle('alpha').length
    await t.warte(20 * 60 * 1000)
    t.chk('Java: kein neuer Versuch, kein neuer Code von selbst', t.javaAlle('alpha').length === anzahl && (await t.status('alpha')) === 'Microsoft lehnt Login ab – Konto prüfen', [t.javaAlle('alpha').length, anzahl, await t.status('alpha')])
    t.chk('Andere Accounts laufen weiter', await t.warteBis(() => t.java('bravo'), 5000))
    await t.api('POST', '/api/start/alpha')
    t.chk('Java: Start versucht es neu', await t.warteBis(() => t.javaAlle('alpha').length === anzahl + 1, 10000))
    t.java('alpha').einloggen()
    t.chk('Java: dann online', await t.warteBis(async () => (await t.status('alpha')) === 'online', 5000))

    // ---------- Bedrock ----------
    // frisch starten (der erste Versuch von .nils ist im Test längst ohne Antwort abgebrochen)
    await t.api('POST', '/api/stop/.nils')
    const vorStart = t.bedrockClients.length
    await t.api('POST', '/api/start/.nils')
    t.chk('.nils startet', await t.warteBis(() => t.bedrockClients.length > vorStart && t.bedrock('nils'), 60000))
    const c = t.bedrock('nils')
    c.code({ user_code: 'BCODE' })
    t.chk('Bedrock: Login nötig', await t.warteBis(async () => /Login nötig \(Code/.test(await t.status('.nils')), 5000))
    // so kommt es aus dem Bedrock-Thread an: Fehler, dann schließt der Client
    c.emit('error', Object.assign(new Error('Microsoft hat die Anmeldung abgelehnt (invalid_grant): The user could not be authenticated or user interaction is required.'), { code: ml.REJECTED }))
    c.close()
    t.chk('Bedrock: Status "Microsoft lehnt Login ab"', await t.warteBis(async () => (await t.status('.nils')) === 'Microsoft lehnt Login ab – Konto prüfen', 5000), await t.status('.nils'))
    const bAnzahl = t.bedrockClients.length
    await t.warte(10 * 60 * 1000)
    t.chk('Bedrock: kein neuer Versuch von selbst', t.bedrockClients.length === bAnzahl && (await t.status('.nils')) === 'Microsoft lehnt Login ab – Konto prüfen', [t.bedrockClients.length, bAnzahl, await t.status('.nils')])
    await t.api('POST', '/api/start/.nils')
    t.chk('Bedrock: Start versucht es neu', await t.warteBis(() => t.bedrockClients.length > bAnzahl, 10000))
  },
}
