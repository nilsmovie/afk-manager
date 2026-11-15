// Nach erfolgreicher Microsoft-Anmeldung (Code eingegeben) steht nicht mehr "Login nötig", auch
// wenn die Verbindung zum Server noch dauert (bei Bedrock oft länger). Der Code-Zähler startet
// neu, die Discord-Meldung zeigt "angemeldet", und die Frist des Codes bricht die Verbindung nicht ab.
module.exports = {
  name: 'Code eingegeben, Verbindung läuft noch',
  accounts: [{ username: '.nils' }, { username: 'alpha' }, { username: 'bravo' }],
  async run (t) {
    // ---------- Bedrock ----------
    t.chk('Bedrock-Account startet', await t.warteBis(() => t.bedrock('nils'), 20000))
    const c = t.bedrock('nils')
    c.code({ user_code: 'BCODE1', expires_in: 300 })
    t.chk('Bedrock: Login nötig', await t.warteBis(async () => (await t.status('.nils')) === 'Login nötig (Code eingeben)', 5000), await t.status('.nils'))
    t.chk('Bedrock: Code in Discord', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /otc=BCODE1/.test(t.discord.text(m))), 5000))
    const meldung = t.discord.nachrichten('MELDUNGEN').find((m) => /otc=BCODE1/.test(t.discord.text(m)))
    c.angemeldet()
    t.chk('Bedrock: nach der Anmeldung "verbinde..."', await t.warteBis(async () => (await t.status('.nils')) === 'verbinde...', 5000), await t.status('.nils'))
    t.chk('Bedrock: Discord-Meldung "angemeldet"', await t.warteBis(() => /ist angemeldet/.test(t.discord.text(t.discord.nachrichten().find((m) => m.id === meldung.id))), 5000))
    t.chk('Bedrock: im Log vermerkt', t.logEnthaelt(/\[\.nils\] --- Microsoft-Login erfolgreich, verbinde mit dem Server ---/))
    // Die Frist des Codes (300 s + Puffer) darf die laufende Verbindung nicht mehr abbrechen
    const anzahl = t.bedrockClients.length
    await t.warte(8 * 60 * 1000)
    t.chk('Bedrock: Code-Frist bricht die Verbindung nicht ab', t.bedrockClients.length === anzahl && !c._closed && !/Login nötig/.test(await t.status('.nils')), [t.bedrockClients.length, anzahl, c._closed, await t.status('.nils')])
    c.spawn()
    t.chk('Bedrock: dann online', await t.warteBis(async () => (await t.status('.nils')) === 'online', 5000))

    // ---------- Java ----------
    t.chk('Java-Account startet', await t.warteBis(() => t.java('alpha'), 60000))
    const a = t.java('alpha')
    a.code({ user_code: 'JCODE1', expires_in: 300 })
    t.chk('Java: Login nötig', await t.warteBis(async () => (await t.status('alpha')) === 'Login nötig (Code eingeben)', 5000))
    a.angemeldet()
    t.chk('Java: nach der Anmeldung "verbinde..."', await t.warteBis(async () => (await t.status('alpha')) === 'verbinde...', 5000), await t.status('alpha'))
    a.einloggen()
    t.chk('Java: dann online', await t.warteBis(async () => (await t.status('alpha')) === 'online', 5000))

    // ---------- Ohne Code (Login aus dem Speicher) ändert sich nichts ----------
    t.chk('bravo startet', await t.warteBis(() => t.java('bravo'), 60000))
    const vorher = await t.status('bravo')
    t.java('bravo').angemeldet()
    await t.warte(2000)
    t.chk('Ohne offenen Code: Status bleibt, kein Log-Eintrag', (await t.status('bravo')) === vorher && !t.logEnthaelt(/\[bravo\] --- Microsoft-Login erfolgreich/), [vorher, await t.status('bravo')])
    t.java('bravo').einloggen()
    t.chk('bravo online', await t.warteBis(async () => (await t.status('bravo')) === 'online', 5000))
  },
}
