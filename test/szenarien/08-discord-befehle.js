// Discord-Befehle: !list, !start/!stop, !mc, !primary, !rename, !add, Rollenprüfung
module.exports = {
  name: 'Discord-Befehle',
  env: { DISCORD_ALLOWED_ROLE_IDS: 'MOD' },
  accounts: [{ username: 'alpha', preferredChatSource: true }, { username: 'bravo' }],
  async run (t) {
    await t.warteBis(() => t.java('alpha'), 20000)
    t.java('alpha').einloggen()
    await t.warteBis(() => t.java('bravo'), 20000)
    t.java('bravo').einloggen()
    await t.warte(2000)

    let b = t.discord.befehl('!list')
    await t.warte(500)
    t.chk('!list', b.antworten.length === 1 && /2\/2 online/.test(b.antworten[0]) && /alpha/.test(b.antworten[0]), b.antworten)

    b = t.discord.befehl('!mc alpha  /spawn')
    await t.warte(500)
    t.chk('!mc sendet über den Account', t.java('alpha').gesendet.includes('/spawn') && b.reaktionen.includes('✅'), t.java('alpha').gesendet)
    b = t.discord.befehl('!mc gibtsnicht hallo')
    await t.warte(500)
    t.chk('!mc unbekannter Account', /Unbekannter Account/.test(b.antworten[0] || ''))

    b = t.discord.befehl('!stop bravo')
    await t.warte(1000)
    t.chk('!stop', (await t.status('bravo')) === 'gestoppt')
    b = t.discord.befehl('!start bravo')
    t.chk('!start', await t.warteBis(() => t.javaAlle('bravo').length === 2, 5000))
    t.java('bravo').einloggen()

    b = t.discord.befehl('!primary bravo')
    await t.warte(500)
    t.chk('!primary', (await t.api('GET', '/api/chat-state')).data.primary === 'bravo' && /Chat-Quelle/.test(b.antworten[0]))

    b = t.discord.befehl('!rename bravo bravo2')
    await t.warte(500)
    t.chk('!rename nur gestoppt', /zuerst stoppen/.test(b.antworten[0] || ''), b.antworten)
    t.discord.befehl('!stop bravo')
    await t.warte(500)
    b = t.discord.befehl('!rename bravo bravo2')
    await t.warte(500)
    const acc = t.datei('accounts.json').find((a) => a.username === 'bravo2')
    t.chk('!rename', acc && acc.authCacheId === 'bravo' && /umbenannt/.test(b.antworten[0]), t.datei('accounts.json'))
    b = t.discord.befehl('!start bravo2')
    t.chk('Umbenannter Account nutzt den alten Login-Cache', await t.warteBis(() => t.javaAlle('bravo').length === 3, 5000))
    t.java('bravo').einloggen()

    b = t.discord.befehl('!add delta')
    t.chk('!add legt an und startet', await t.warteBis(() => t.java('delta'), 30000) && t.datei('accounts.json').some((a) => a.username === 'delta'))

    b = t.discord.befehl('!stop all')
    await t.warte(1000)
    t.chk('!stop all', (await t.liste()).every((a) => a.status === 'gestoppt'), (await t.liste()).map((a) => a.status))

    const nAlpha = t.javaAlle('alpha').length
    b = t.discord.befehl('!start alpha', { rollen: false })
    await t.warte(2000)
    t.chk('Ohne Rolle: abgelehnt', /keine Berechtigung/.test(b.antworten[0] || '') && t.javaAlle('alpha').length === nAlpha, { antworten: b.antworten, n: t.javaAlle('alpha').length, nAlpha })
    const audit = (await t.api('GET', '/api/audit')).data.entries
    t.chk('Discord-Aktionen im Protokoll', audit.some((e) => e.src === 'discord' && e.action === 'Gestoppt' && e.target === 'bravo') && audit.some((e) => /abgelehnt/.test(e.action)))
  },
}
