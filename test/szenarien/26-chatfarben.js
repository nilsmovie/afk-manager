// Chat-Farben wie in Minecraft: Ränge/Namen farbig, Vererbung vom Eltern-Teil (nicht vom
// Nachbarn), §-Codes im Text, Hex-Farben; nur sichere Werte; Discord/Erweiterungen bleiben Text
module.exports = {
  name: 'Chat-Farben',
  accounts: [{ username: 'alpha', everJoined: true }],
  async run (t) {
    await t.alleEinloggenBis(async () => (await t.status('alpha')) === 'online', 60000)
    const json = {
      text: '',
      extra: [
        { text: '[', color: 'gray' }, { text: 'Admin', color: 'red', bold: true }, { text: '] ', color: 'gray' },
        { text: 'Bob', color: '#55FFAA' },
        { text: ': hallo <img src=x onerror=alert(1)> §6gold§r normal' },
        { text: ' kaputt', color: 'red;background:url(x)' },
      ],
    }
    t.java('alpha').chatEmpfangen('[Admin] Bob: hallo <img src=x onerror=alert(1)> gold normal kaputt', json)
    t.java('alpha').chatEmpfangen('ohne Farbe', { text: 'ohne Farbe' })
    await t.warte(3000)
    const h = (await t.api('GET', '/api/chat-state')).data.history
    const e = h.find((x) => /\[Admin\] Bob/.test(x.text))
    t.chk('Farbige Stücke mitgeschickt', e && Array.isArray(e.segs), e)
    const s = e.segs
    const farbe = (txt) => (s.find((x) => x.t.includes(txt)) || {}).c
    t.chk('Rang rot und fett', farbe('Admin') === '#FF5555' && s.find((x) => x.t === 'Admin').b === 1, s)
    t.chk('Klammern grau', farbe('[') === '#AAAAAA')
    t.chk('Name mit Hex-Farbe', farbe('Bob') === '#55FFAA')
    t.chk('Nachricht erbt nicht die Farbe des Namens', farbe(': hallo') === undefined, s)
    t.chk('§-Code im Text', farbe('gold') === '#FFAA00' && farbe(' normal') === undefined, s)
    t.chk('Kaputte Farbe wird ignoriert (keine CSS-Einschleusung)', farbe(' kaputt') === undefined && s.every((x) => !x.c || /^#[0-9A-F]{6}$/.test(x.c)), s)
    t.chk('Text bleibt Text (HTML nicht ausgewertet, im Browser escaped)', s.some((x) => x.t.includes('<img src=x onerror=alert(1)>')))
    t.chk('Ohne Farben: keine Stücke', !h.find((x) => x.text === 'ohne Farbe').segs)
    t.chk('Discord-Chat bekommt nur Text', t.discord.nachrichten('CHAT').some((m) => /Bob`?: hallo/.test(m.content)) && !t.discord.nachrichten('CHAT').some((m) => /#55FFAA|segs/.test(m.content)))
  },
}
