// Tagesstatistik übersteht einen Neustart des Managers (die Zeit dazwischen zählt nicht)
module.exports = {
  name: 'Tagesstatistik über einen Neustart',
  phasen: 2,
  accounts: [{ username: 'alpha', everJoined: true }, { username: 'bravo', everJoined: true }],
  async run (t) {
    const ms = async (n) => (await t.liste()).find((a) => a.username === n).uptimeMs
    if (t.PHASE === 1) {
      await t.alleEinloggenBis(async () => (await t.liste()).every((a) => a.status === 'online'), 100000)
      await t.warte(60 * 60 * 1000) // 1 h
      await t.api('POST', '/api/stop/bravo')
      await t.warte(30 * 60 * 1000) // alpha weitere 30 min
      const a1 = await ms('alpha'); const b1 = await ms('bravo')
      t.chk('Vor dem Neustart: alpha ~1,5 h, bravo ~1 h (gestoppt zählt nicht weiter)', a1 >= 89 * 60000 && b1 >= 59 * 60000 && b1 < 65 * 60000, { alpha: a1 / 60000, bravo: b1 / 60000 })
      await t.warte(70000) // mindestens einmal regelmäßig gespeichert
      t.chk('statistik.json geschrieben', !!(t.datei('statistik.json') || {}).totals)
      return
    }
    // Phase 2: frisch gestartet, gleicher Tag
    t.chk('Im Log vermerkt', t.logEnthaelt(/Online-Zeiten von heute übernommen/))
    t.chk('Nach dem Neustart: Werte übernommen', (await ms('alpha')) >= 89 * 60000 && (await ms('bravo')) >= 59 * 60000, { alpha: await ms('alpha'), bravo: await ms('bravo') })
    const vorher = await ms('alpha')
    await t.warte(10 * 60 * 1000)
    t.chk('Solange alpha offline ist, zählt nichts dazu', (await ms('alpha')) === vorher)
    await t.alleEinloggenBis(async () => (await t.status('alpha')) === 'online', 100000)
    await t.warte(20 * 60 * 1000)
    t.chk('Online zählt weiter', (await ms('alpha')) >= vorher + 19 * 60000)
    // Mitternacht: Zusammenfassung mit den Werten von vor UND nach dem Neustart
    const m = new Date(t.zeit.jetzt()); m.setHours(23, 59, 50, 0)
    t.zeit.setze(m)
    t.chk('Zusammenfassung zählt beide Teile', await t.warteBis(() => t.discord.nachrichten().some((x) => /Tageszusammenfassung \*\*alpha\*\*: (1[3-9]|2\d)h/.test(t.discord.text(x)) && /\*\*bravo\*\*: 1h/.test(t.discord.text(x))), 200000), t.discord.nachrichten().map(t.discord.text).filter((x) => /Tageszus/.test(x)))
  },
}
