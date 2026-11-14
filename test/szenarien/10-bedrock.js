// Bedrock: Thread-Client, Fehlschläge mit Backoff, Bedrock-Pause mit Probe, Kurzverbindungs-Pause
module.exports = {
  name: 'Bedrock-Accounts',
  env: { MC_BEDROCK_PAUSE_AFTER_FAILS: '3', MC_BEDROCK_PAUSE_MIN: '15' },
  accounts: [{ username: '.eins' }, { username: '.zwei' }, { username: 'java1' }],
  async run (t) {
    t.chk('Start: .eins als Thread-Client', await t.warteBis(() => t.bedrock('eins'), 20000))
    const c = t.bedrock('eins')
    t.chk('Bedrock-Port und Gamertag ohne Punkt', c.cfg.client.host === 'mc.test' && c.cfg.client.port === 19132 && c.cfg.client.username === 'eins' && c.cfg.client.transport === 'nethernet', c.cfg.client)
    c.spawn()
    t.chk('online', await t.warteBis(async () => (await t.status('.eins')) === 'online', 5000))
    t.chk('Dann .zwei', await t.warteBis(() => t.bedrock('zwei'), 30000))
    t.bedrock('zwei').spawn()
    await t.warteBis(() => t.java('java1'), 30000)
    t.java('java1').einloggen()

    // Bedrock-Chat und Befehl
    let r = await t.api('POST', '/api/chat', { username: '.eins', message: '/spawn' })
    t.chk('Befehl über Bedrock', r.status === 200 && t.bedrock('eins').pakete.some((p) => p[0] === 'command_request' && p[1].command === '/spawn'), r)
    r = await t.api('POST', '/api/chat', { username: '.eins', message: 'hallo' })
    t.chk('Chat über Bedrock', t.bedrock('eins').pakete.some((p) => p[0] === 'text' && p[1].message === 'hallo'))

    // Beide fallen aus und kommen nicht mehr durch -> nach 3 Fehlschlägen Pause für alle Bedrock-Accounts
    t.bedrock('eins').trennen()
    t.bedrock('zwei').trennen()
    let fails = 0
    for (let i = 0; i < 8 && !t.logEnthaelt(/alle Bedrock-Accounts pausieren/); i++) {
      const vorher = t.bedrockClients.length
      if (!await t.warteBis(() => t.bedrockClients.length > vorher || t.logEnthaelt(/alle Bedrock-Accounts pausieren/), 400000)) break
      if (t.bedrockClients.length > vorher) { t.bedrockClients[t.bedrockClients.length - 1].aufbauScheitert(9); fails++ }
    }
    t.chk('Bedrock-Pause nach 3 Fehlschlägen', t.logEnthaelt(/3 Verbindungsversuche hintereinander gescheitert/), fails)
    t.chk('Discord-Hinweis "kommen nicht auf den Server"', await t.warteBis(() => t.discord.nachrichten('MELDUNGEN').some((m) => /Bedrock-Accounts kommen nicht auf den Server/.test(t.discord.text(m))), 5000))
    t.chk('Status zeigt die Pause (auch beim Account, dessen Wartezeit gerade lief)', await t.warteBis(async () => (await t.liste()).filter((a) => a.username.startsWith('.')).every((a) => /Bedrock-Pause bis/.test(a.status)), 120000), (await t.liste()).map((a) => a.status))
    const liste = await t.liste()
    t.chk('Java-Account ist nicht betroffen', liste.find((a) => a.username === 'java1').status === 'online')
    const anzahl = t.bedrockClients.length
    await t.warte(10 * 60 * 1000)
    t.chk('Während der Pause keine Versuche', t.bedrockClients.length === anzahl)
    t.chk('Nach der Pause probiert es einer', await t.warteBis(() => t.bedrockClients.length === anzahl + 1, 10 * 60 * 1000))
    t.chk('...der oberste', t.bedrockClients[t.bedrockClients.length - 1].username === 'eins')
    t.bedrockClients[t.bedrockClients.length - 1].spawn()
    t.chk('Probe klappt -> die anderen folgen', await t.warteBis(() => t.bedrockClients.length === anzahl + 2 && t.bedrockClients[anzahl + 1].username === 'zwei', 60000))
    t.bedrockClients[anzahl + 1].spawn()
    t.chk('Beide wieder online', await t.warteBis(async () => (await t.liste()).filter((a) => a.status === 'online').length === 3, 5000))

    // Kurzverbindungen: 3x unter 5 Minuten -> 5 Minuten Pause
    for (let i = 0; i < 3; i++) {
      const n = t.bedrockAlle('zwei').length
      await t.warte(60000)
      t.bedrock('zwei').trennen()
      if (i < 2) { await t.warteBis(() => t.bedrockAlle('zwei').length > n, 120000); t.bedrock('zwei').spawn() }
    }
    t.chk('Kurzverbindungen: Pause', await t.warteBis(async () => /Bricht immer wieder ab/.test(await t.status('.zwei')), 5000), await t.status('.zwei'))
    const nZwei = t.bedrockAlle('zwei').length
    await t.api('POST', '/api/start/.zwei')
    t.chk('Start-Klick hebt sie auf', await t.warteBis(() => t.bedrockAlle('zwei').length === nZwei + 1, 30000))
  },
}
