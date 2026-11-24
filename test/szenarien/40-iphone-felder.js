// iPhone/Safari: Beim Neuladen darf die Seite nicht in ein Feld hineinzoomen und Safari darf das
// Feld "Account hinzufügen" nicht für ein Login-Feld halten (gespeichertes Passwort vorschlagen).
// Geprüft wird, was Safari dafür auswertet: Schriftgröße der Felder (unter 16px = Zoom), kein
// automatischer Fokus beim Laden, Viewport ohne Zoom-Sperre, Feldnamen/autocomplete, kein
// Passwortfeld im Dashboard und ein sauber ausgezeichnetes Login-Formular.
module.exports = {
  name: 'iPhone: kein Zoom, kein Passwort-Vorschlag',
  accounts: [{ username: 'alpha', everJoined: true }],
  async run (t) {
    let playwright
    try { playwright = require('playwright') } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const { chromium, devices } = playwright
    const ZR = Math.max(1, Number(process.env.TEST_ZEITRAFFER || 40))
    const base = `http://127.0.0.1:${process.env.PORT}`
    const browser = await chromium.launch()
    const iphone = { ...devices['iPhone 13'] }
    delete iphone.defaultBrowserType
    const keks = async () => {
      const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      return [{ name: k, value: v, domain: '127.0.0.1', path: '/' }]
    }
    const neueSeite = async (opts, mitLogin) => {
      const ctx = await browser.newContext(opts)
      if (mitLogin) await ctx.addCookies(await keks())
      const p = await ctx.newPage()
      p.fehler = []
      p.on('pageerror', (err) => p.fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      return { ctx, p }
    }
    // Schriftgrößen aller Eingabefelder (auch versteckte - die Regel muss überall greifen)
    const kleineFelder = (p) => p.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')]
      .map((el) => [el.id || el.className || el.tagName, parseFloat(getComputedStyle(el).fontSize)])
      .filter(([, px]) => px < 16))
    const viewportOk = (p) => p.evaluate(() => { const m = document.querySelector('meta[name=viewport]'); return m ? m.content : null })
    const fokus = (p) => p.evaluate(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement.id || document.activeElement.tagName : null))

    // ---------- Dashboard auf dem iPhone ----------
    let { ctx, p } = await neueSeite(iphone, true)
    await p.goto(`${base}/`)
    await p.waitForSelector('.account-row')
    t.chk('iPhone: Touch-Gerät erkannt (hover: none)', await p.evaluate(() => matchMedia('(hover: none)').matches))
    let vp = await viewportOk(p)
    t.chk('Dashboard: Viewport ohne Zoom-Sperre', vp === 'width=device-width, initial-scale=1', vp)
    t.chk('Dashboard: beim Laden ist kein Feld ausgewählt', (await fokus(p)) === null, await fokus(p))
    // ein paar Aktualisierungen später immer noch nicht
    await p.evaluate(() => { document.querySelector('.account-row').__alt = true })
    await p.waitForFunction(() => !document.querySelector('.account-row').__alt, null, { timeout: 8000 * ZR })
    t.chk('Dashboard: auch nach dem Aktualisieren kein Feld ausgewählt', (await fokus(p)) === null, await fokus(p))
    t.chk('Dashboard: alle Felder mindestens 16px (kein Safari-Zoom)', (await kleineFelder(p)).length === 0, await kleineFelder(p))
    const auswahl = await p.evaluate(() => ['themeSelect', 'fontSelect', 'mcNameInput', 'chatInput'].map((id) => [id, getComputedStyle(document.getElementById(id)).fontSize]))
    t.chk('Dashboard: Farbschema, Schriftart, Account-Feld, Chat mit 16px', auswahl.every(([, f]) => f === '16px'), auswahl)
    // aufgeklappte Bereiche (Auto-Chat) ebenfalls
    await p.locator('.account-row', { hasText: 'alpha' }).first().locator('button[title*="Auto-Chat"], button:has-text("⚙️")').first().tap().catch(() => {})
    t.chk('Dashboard: auch Auto-Chat-Felder mit 16px', (await kleineFelder(p)).length === 0, await kleineFelder(p))

    const feld = await p.evaluate(() => {
      const el = document.getElementById('mcNameInput')
      const a = (n) => el.getAttribute(n)
      return { id: el.id, name: a('name'), typ: a('type'), platzhalter: a('placeholder'), autocomplete: a('autocomplete'), autocapitalize: a('autocapitalize'), autocorrect: a('autocorrect'), spellcheck: a('spellcheck'), lp: a('data-lpignore'), op: el.hasAttribute('data-1p-ignore'), inForm: !!el.closest('form') }
    })
    t.chk('Account-Feld: kein username/user/login/email in id oder name', !/user|login|e-?mail/i.test(`${feld.id} ${feld.name}`), feld)
    t.chk('Account-Feld: name="mc-ingame-name"', feld.name === 'mc-ingame-name', feld)
    t.chk('Account-Feld: Platzhalter ohne "Benutzername"', feld.platzhalter === 'Minecraft-Name', feld)
    t.chk('Account-Feld: autocomplete/autocapitalize/autocorrect aus, keine Rechtschreibprüfung', feld.autocomplete === 'off' && feld.autocapitalize === 'off' && feld.autocorrect === 'off' && feld.spellcheck === 'false', feld)
    t.chk('Account-Feld: Passwort-Apps ignorieren es', feld.lp === 'true' && feld.op, feld)
    t.chk('Account-Feld: in keinem Formular', !feld.inForm, feld)
    const pw = await p.evaluate(() => ({ felder: document.querySelectorAll('input[type=password]').length, formulare: document.querySelectorAll('form').length, autocomplete: [...document.querySelectorAll('[autocomplete=username],[autocomplete=current-password]')].length }))
    t.chk('Dashboard: kein Passwortfeld, kein Login-Formular', pw.felder === 0 && pw.formulare === 0 && pw.autocomplete === 0, pw)
    const breit = await p.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
    t.chk('Dashboard: nichts ragt seitlich heraus (390px)', breit <= 0, breit)
    if (process.env.TEST_SCREENSHOTS) await p.screenshot({ path: `${process.env.TEST_SCREENSHOTS}/iphone-dashboard.png`, fullPage: true })

    // Account hinzufügen klappt weiter, auch mit Enter
    await p.tap('#mcNameInput')
    await p.fill('#mcNameInput', 'delta')
    await p.press('#mcNameInput', 'Enter')
    t.chk('Account-Feld: Enter fügt hinzu', await t.warteBis(async () => (await t.liste()).some((a) => a.username === 'delta'), 10000))
    t.chk('Account-Feld: danach leer', (await p.inputValue('#mcNameInput')) === '')
    t.chk('Protokoll: Account angelegt', ((await t.api('GET', '/api/audit')).data.entries || []).some((e) => e.action === 'Account angelegt' && e.target === 'delta'))
    t.chk('Dashboard (iPhone): keine JS-Fehler', p.fehler.length === 0, p.fehler)
    await ctx.close()

    // ---------- Dashboard am Computer: Schrift bleibt wie bisher ----------
    ;({ ctx, p } = await neueSeite({ viewport: { width: 1280, height: 900 } }, true))
    await p.goto(`${base}/`)
    await p.waitForSelector('.account-row')
    const pc = await p.evaluate(() => getComputedStyle(document.getElementById('mcNameInput')).fontSize)
    t.chk('Computer: Felder behalten ihre Größe (14px)', pc === '14px', pc)
    await ctx.close()

    // ---------- Login-Seite auf dem iPhone ----------
    ;({ ctx, p } = await neueSeite(iphone, false))
    await p.goto(`${base}/login`)
    await p.waitForSelector('#loginForm')
    vp = await viewportOk(p)
    t.chk('Login: Viewport ohne Zoom-Sperre', vp === 'width=device-width, initial-scale=1', vp)
    t.chk('Login (iPhone): kein Feld automatisch ausgewählt', (await fokus(p)) === null, await fokus(p))
    t.chk('Login: Felder mit 16px', (await kleineFelder(p)).length === 0, await kleineFelder(p))
    const login = await p.evaluate(() => {
      const u = document.getElementById('usernameInput')
      const w = document.getElementById('passwordInput')
      return { u: u.getAttribute('autocomplete'), w: w.getAttribute('autocomplete'), un: u.name, wn: w.name, gleichesFormular: !!u.form && u.form === w.form, autofocus: u.hasAttribute('autofocus') }
    })
    t.chk('Login: autocomplete="username" und "current-password" im selben Formular', login.u === 'username' && login.w === 'current-password' && login.gleichesFormular && !login.autofocus, login)
    // Enter im Namensfeld -> weiter zum Passwort, noch nicht abschicken
    await p.fill('#usernameInput', 'nils')
    await p.press('#usernameInput', 'Enter')
    t.chk('Login: Enter im Namensfeld springt zum Passwort', (await fokus(p)) === 'passwordInput' && p.url().endsWith('/login'))
    // falsches Passwort
    await p.fill('#passwordInput', 'falsch')
    await p.press('#passwordInput', 'Enter')
    await p.waitForFunction(() => document.getElementById('errorMsg').textContent.length > 0, null, { timeout: 5000 * ZR })
    t.chk('Login: falsches Passwort -> Fehler, bleibt auf der Seite', p.url().endsWith('/login') && (await p.inputValue('#passwordInput')) === '')
    // richtig -> Dashboard, Login-Formular ist weg
    await p.fill('#passwordInput', 'testpw')
    await p.tap('#loginBtn')
    await p.waitForSelector('.account-row', { timeout: 8000 * ZR })
    const danach = await p.evaluate(() => ({ pfad: location.pathname, login: !!document.getElementById('loginForm'), pw: document.querySelectorAll('input[type=password]').length }))
    t.chk('Login: danach Dashboard ohne Login-Formular und ohne Passwortfeld', danach.pfad === '/' && !danach.login && danach.pw === 0, danach)
    await p.goBack().catch(() => null)
    t.chk('Login: "Zurück" führt nicht wieder zum Login-Formular', !p.url().endsWith('/login'), p.url())
    t.chk('Login (iPhone): keine JS-Fehler', p.fehler.length === 0, p.fehler)
    await ctx.close()

    // ---------- Login-Seite am Computer: Cursor gleich im Namensfeld ----------
    ;({ ctx, p } = await neueSeite({ viewport: { width: 1280, height: 900 } }, false))
    await p.goto(`${base}/login`)
    await p.waitForSelector('#loginForm')
    t.chk('Login (Computer): Cursor steht im Namensfeld', (await fokus(p)) === 'usernameInput', await fokus(p))
    await ctx.close()

    // ---------- Verwaltung auf dem iPhone ----------
    ;({ ctx, p } = await neueSeite(iphone, true))
    await p.goto(`${base}/admin`)
    await p.waitForSelector('#newUserName')
    vp = await viewportOk(p)
    t.chk('Verwaltung: Viewport ohne Zoom-Sperre', vp === 'width=device-width, initial-scale=1', vp)
    t.chk('Verwaltung: kein Feld automatisch ausgewählt', (await fokus(p)) === null, await fokus(p))
    t.chk('Verwaltung: alle Felder mit 16px', (await kleineFelder(p)).length === 0, await kleineFelder(p))
    const neu = await p.evaluate(() => ({ n: document.getElementById('newUserName').getAttribute('autocomplete'), w: document.getElementById('newUserPassword').getAttribute('autocomplete') }))
    t.chk('Verwaltung: "Benutzer anlegen" schlägt kein gespeichertes Passwort vor', neu.n === 'off' && neu.w === 'new-password', neu)
    t.chk('Verwaltung (iPhone): keine JS-Fehler', p.fehler.length === 0, p.fehler)
    await ctx.close()
    await browser.close()
  },
}
