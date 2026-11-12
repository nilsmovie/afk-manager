// Uptime pro Tag und Tageszusammenfassung um Mitternacht
module.exports = {
  name: 'Uptime-Statistik und Tageszusammenfassung',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }],
  async run (t) {
    // Auf 22:00 Uhr stellen, damit wir gleich über Mitternacht kommen
    const d = new Date(t.zeit.jetzt()); d.setHours(22, 0, 0, 0)
    t.zeit.setze(d)
    await t.warteBis(() => t.java('alpha'), 20000)
    t.java('alpha').einloggen()
    await t.warteBis(() => t.java('bravo'), 20000)
    t.java('bravo').einloggen()
    await t.warte(60 * 60 * 1000) // 1 Stunde im Zeitraffer
    const liste = await t.liste()
    const up = (n) => liste.find((a) => a.username === n).uptimeMs
    t.chk('Uptime zählt (ca. 1 h)', up('alpha') > 55 * 60000 && up('alpha') < 65 * 60000, up('alpha'))
    t.java('bravo').trennen()
    await t.warte(30 * 60 * 1000)
    const liste2 = await t.liste()
    const upB = liste2.find((a) => a.username === 'bravo').uptimeMs
    const upA = liste2.find((a) => a.username === 'alpha').uptimeMs
    t.chk('Offline zählt nicht (bravo gleich geblieben, alpha weiter)', upA > up('alpha') + 25 * 60000 && Math.abs(upB - up('bravo')) < 3 * 60000, { upA, upB })

    // Kurz vor Mitternacht
    const m = new Date(t.zeit.jetzt()); m.setHours(23, 59, 59, 0)
    t.zeit.setze(m)
    t.chk('Tageszusammenfassung um 0:00', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((x) => /Tageszusammenfassung/.test(t.discord.text(x))), 120000))
    const z = t.discord.nachrichten('MELDUNGEN').find((x) => /Tageszusammenfassung/.test(t.discord.text(x)))
    t.chk('Zusammenfassung nennt beide Accounts mit Dauer', /\*\*alpha\*\*: \d+h/.test(t.discord.text(z)) && /\*\*bravo\*\*: /.test(t.discord.text(z)), t.discord.text(z))
    await t.warte(5000)
    const neu = (await t.liste()).find((a) => a.username === 'alpha').uptimeMs
    t.chk('Danach beginnt der Tag bei 0', neu < 10 * 60000, neu)
  },
}
