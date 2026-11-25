// Discord kurz nicht erreichbar (Internet weg, z.B. Zwangstrennung des Routers, oder Störung bei
// Discord): Meldungen werden aufgehoben und danach vom BOT nachgeschickt - in der richtigen
// Reihenfolge, mit der Uhrzeit des Ereignisses, nicht über den Webhook. Erst nach über 15 Minuten
// geht es per Webhook raus. Darf der Bot im Kanal nicht schreiben, gleich der Webhook (wie bisher).
const http = require('http')
const HOOK_PORT = 5200 + (process.pid % 500)
module.exports = {
  name: 'Discord: Meldungen nachschicken statt Webhook',
  accounts: [{ username: 'alpha' }, { username: 'bravo' }, { username: 'charlie' }],
  env: { DISCORD_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/api/webhooks/123456789012345678/test-webhook-token-abcdef` },
  async run (t) {
    const hook = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { try { hook.push(JSON.parse(body)) } catch (_) { hook.push({ kaputt: body }) } res.writeHead(204); res.end() })
    })
    await new Promise((r) => server.listen(HOOK_PORT, '127.0.0.1', r))
    const hookText = () => hook.map((b) => [b.content || '', ...(b.embeds || []).map((e) => `${e.title || ''} ${e.description || ''}`)].join(' '))
    try {
      const meldungen = () => t.discord.nachrichten('MELDUNGEN')
      const texte = (ab = 0) => meldungen().slice(ab).map(t.discord.text)
      const alleOnline = async () => (await t.liste()).every((a) => a.status === 'online')
      const einloggen = async (namen) => {
        for (const n of namen) {
          await t.warteBis(() => t.java(n) && !t.java(n).beendet && !t.java(n).__eingeloggt, 60000)
          t.java(n).__eingeloggt = true
          t.java(n).einloggen()
        }
      }
      await einloggen(['alpha', 'bravo', 'charlie'])
      t.chk('Alle online', await t.warteBis(alleOnline, 10000))
      await t.warteBis(() => meldungen().length > 0, 10000)

      // ---- Internet weg ----
      const v1 = meldungen().length
      t.discord.offline('netz')
      const zeitKick = t.zeit.jetzt()
      t.java('bravo').kick(JSON.stringify({ text: 'Du warst zu lange AFK' }))
      await t.warte(9000)
      t.chk('Internet weg: Kick-Meldung kommt (noch) nicht an', meldungen().length === v1, texte(v1))
      t.chk('...und geht auch nicht über den Webhook', hook.length === 0, hookText())
      t.chk('Log: Discord nicht erreichbar, wird nachgeschickt', t.logEnthaelt(/Discord: gerade nicht erreichbar \(fetch failed\) - Meldungen werden aufgehoben/))
      t.chk('Log: kein "nutze 10 Minuten lang den Webhook"', !t.logEnthaelt(/nutze 10 Minuten lang den Webhook/))

      // Server startet neu -> alle gekickt, kommen wieder (wie nachts um 4)
      await t.warteBis(() => t.javaAlle('bravo').length === 2, 60000)
      await einloggen(['bravo'])
      await t.warteBis(alleOnline, 10000)
      for (const n of ['charlie', 'alpha', 'bravo']) t.java(n).kick(JSON.stringify({ text: 'Server startet neu' }))
      await t.warte(9000)
      for (const n of ['alpha', 'bravo', 'charlie']) {
        await t.warteBis(() => t.java(n) && !t.java(n).beendet && !t.java(n).__eingeloggt, 90000)
        t.java(n).__eingeloggt = true
        t.java(n).einloggen()
      }
      t.chk('Alle wieder online', await t.warteBis(alleOnline, 10000))
      t.java('alpha').chatEmpfangen('Spieler1: hallo während der Störung', { text: 'Spieler1: hallo während der Störung' })
      await t.warte(3 * 60 * 1000)
      t.chk('3 Minuten später: immer noch nichts gesendet', meldungen().length === v1 && hook.length === 0, { neu: texte(v1), hook: hookText() })

      // ---- Internet wieder da ----
      const zeitZurueck = t.zeit.jetzt()
      t.discord.offline(false)
      t.chk('Wieder da: alles wird nachgeschickt', await t.warteBis(() => texte(v1).some((m) => /Alle Accounts wieder online/.test(m)), 90000), texte(v1))
      const neu = meldungen().slice(v1)
      const nt = neu.map(t.discord.text)
      const iKick = nt.findIndex((m) => /bravo wurde gekickt/.test(m))
      const iMasse = nt.findIndex((m) => /3 Accounts wurden gekickt/.test(m))
      const iOnline = nt.findIndex((m) => /Alle Accounts wieder online/.test(m) && /3\/3/.test(m))
      t.chk('Nachgeschickt: Kick, Sammel-Kick, Alle wieder online', iKick >= 0 && iMasse >= 0 && iOnline >= 0, nt)
      t.chk('...in der richtigen Reihenfolge', iKick < iMasse && iMasse < iOnline, nt)
      t.chk('...jede nur einmal', nt.filter((m) => /Alle Accounts wieder online/.test(m)).length === 1 && nt.filter((m) => /bravo wurde gekickt/.test(m)).length === 1, nt)
      const ts = neu[iKick] && neu[iKick].embeds && neu[iKick].embeds[0] && Date.parse(neu[iKick].embeds[0].timestamp)
      t.chk('...mit der Uhrzeit des Kicks (nicht des Nachschickens)', ts && Math.abs(ts - zeitKick) < 60 * 1000 && neu[iKick].at >= zeitZurueck, { ts, zeitKick, at: neu[iKick] && neu[iKick].at })
      t.chk('...alles vom Bot, nichts über den Webhook', hook.length === 0, hookText())
      t.chk('Chat-Spiegel: Zeile aus der Störung kommt nach', await t.warteBis(() => t.discord.nachrichten('CHAT').map(t.discord.text).some((m) => /hallo während der Störung/.test(m)), 30000))
      t.chk('Log: wieder erreichbar, nachgeschickt', t.logEnthaelt(/Discord: wieder erreichbar \(nach ca\. \d+ Min\.\) - \d+ aufgehobene Meldung\(en\) nachgeschickt/))

      // Direkt danach: neue Meldungen gehen gleich über den Bot (keine 10 Minuten Webhook)
      const v2 = meldungen().length
      await t.api('POST', '/api/stop-all')
      t.chk('Danach sofort wieder über den Bot', await t.warteBis(() => texte(v2).some((m) => /Alle Accounts offline/.test(m)), 5000) && hook.length === 0, { neu: texte(v2), hook: hookText() })

      // ---- Störung bei Discord (503) ----
      t.discord.offline('stoerung')
      const v3 = meldungen().length
      await t.api('POST', '/api/start-all')
      for (const n of ['alpha', 'bravo', 'charlie']) {
        await t.warteBis(() => t.java(n) && !t.java(n).beendet && !t.java(n).__eingeloggt, 60000)
        t.java(n).__eingeloggt = true
        t.java(n).einloggen()
      }
      await t.warte(5000)
      t.chk('Discord-Störung (503): aufgehoben, kein Webhook', meldungen().length === v3 && hook.length === 0, { neu: texte(v3), hook: hookText() })
      t.discord.offline(false)
      t.chk('Störung vorbei: Bot schickt nach', await t.warteBis(() => texte(v3).some((m) => /Alle Accounts wieder online/.test(m)), 90000) && hook.length === 0, texte(v3))

      // ---- Lange weg (über 15 Minuten): dann doch per Webhook ----
      t.discord.offline('netz')
      const v4 = meldungen().length
      t.java('charlie').kick(JSON.stringify({ text: 'Lange Störung' }))
      await t.warte(10 * 60 * 1000)
      t.chk('Nach 10 Minuten: noch aufgehoben', hook.length === 0 && meldungen().length === v4, hookText())
      t.chk('Nach über 15 Minuten: per Webhook', await t.warteBis(() => hookText().some((m) => /charlie wurde gekickt/.test(m) && /Lange Störung/.test(m)), 8 * 60 * 1000), hookText())
      t.chk('Log: per Webhook nach über 15 Minuten', t.logEnthaelt(/Discord: Bot kommt seit über 15 Minuten nicht durch - 1 Meldung\(en\) per Webhook geschickt/))
      t.discord.offline(false)
      await t.warte(5000)
      t.chk('...nicht zusätzlich noch vom Bot', !texte(v4).some((m) => /charlie wurde gekickt/.test(m)), texte(v4))

      // ---- Bot darf nicht schreiben: wie bisher gleich per Webhook ----
      const h5 = hook.length
      t.discord.kaputt('MELDUNGEN')
      await t.warteBis(() => t.java('charlie') && !t.java('charlie').beendet && !t.java('charlie').__eingeloggt, 90000)
      t.java('charlie').__eingeloggt = true
      t.java('charlie').einloggen()
      await t.warte(2000)
      t.java('alpha').kick(JSON.stringify({ text: 'Rechte fehlen' }))
      t.chk('Fehlende Rechte: gleich per Webhook', await t.warteBis(() => hookText().slice(h5).some((m) => /alpha wurde gekickt/.test(m)), 15000), hookText().slice(h5))
      t.chk('Log: Hinweis auf die Rechte', t.logEnthaelt(/Bot kann nicht in Kanal MELDUNGEN schreiben \(Missing Access\) - nutze 10 Minuten lang den Webhook/))
      t.discord.kaputt('MELDUNGEN', false)
    } finally {
      t.discord.offline(false)
      server.close()
    }
  },
}
