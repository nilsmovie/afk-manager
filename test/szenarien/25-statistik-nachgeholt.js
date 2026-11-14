// Manager war um Mitternacht aus: die Zusammenfassung des Vortags wird beim Start nachgeholt
const gestern = new Date(Date.now() - 24 * 60 * 60 * 1000)
const tag = `${gestern.getFullYear()}-${String(gestern.getMonth() + 1).padStart(2, '0')}-${String(gestern.getDate()).padStart(2, '0')}`
module.exports = {
  name: 'Zusammenfassung nachholen',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }],
  dateien: { 'statistik.json': { version: 1, day: tag, savedAt: 0, summarySentFor: null, totals: { alpha: 5 * 3600000 + 7 * 60000, bravo: 42 * 60000, weg: 1000 } } },
  async run (t) {
    t.chk('Zusammenfassung vom Vortag nachgeholt', await t.warteBis(() => t.discord.nachrichten().some((x) => /\(nachgeholt\)/.test(t.discord.text(x)) && /\*\*alpha\*\*: 5h 7m/.test(t.discord.text(x)) && /\*\*bravo\*\*: 42m/.test(t.discord.text(x)) && !/weg/.test(t.discord.text(x))), 10000), t.discord.nachrichten().map(t.discord.text))
    t.chk('Heute beginnt bei 0', (await t.liste()).every((a) => a.uptimeMs === 0))
    await t.warte(70000)
    t.chk('Gemerkt, dass sie gesendet ist', (t.datei('statistik.json') || {}).summarySentFor === tag)
  },
}
