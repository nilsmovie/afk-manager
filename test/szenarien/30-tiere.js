// Tier im Widget (Katze, Hund, Fuchs ...) per Auswahl wechseln: Widget, Überschrift, Sprüche und
// das Tier, das unten hin und her läuft; Auswahl wird im Browser gemerkt
module.exports = {
  name: 'Tiere',
  accounts: [{ username: 'alpha', everJoined: true }],
  async run (t) {
    let chromium
    try { ({ chromium } = require('playwright')) } catch (_) { console.log('  --    Browser-Test übersprungen (Playwright nicht installiert)'); return }
    const browser = await chromium.launch()
    const shot = process.env.TEST_SCREENSHOTS
    const TIERE = { cat: 'Katzenpause', dog: 'Hundepause', fox: 'Fuchspause', rabbit: 'Hasenpause', panda: 'Pandapause', penguin: 'Pinguinpause', axolotl: 'Axolotlpause' }
    for (const [breite, theme] of [[1280, 'dark'], [390, 'light']]) {
      const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nils', password: 'testpw' }) })
      const [k, v] = (res.headers.get('set-cookie') || '').split(';')[0].split('=')
      const ctx = await browser.newContext({ viewport: { width: breite, height: 1200 }, deviceScaleFactor: 1 })
      await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }])
      const p = await ctx.newPage()
      const fehler = []
      p.on('pageerror', (err) => fehler.push(err.message))
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.abort())
      await p.addInitScript((th) => { try { localStorage.setItem('afk-manager-theme', th) } catch (e) {} }, theme)
      await p.goto(`http://127.0.0.1:${process.env.PORT}/`)
      await p.waitForSelector('#petSelect')
      const ww = `(${breite}px)`
      t.chk(`${ww} Standard: Katze`, (await p.textContent('#petTitle')) === 'Katzenpause' && (await p.$eval('#petSelect', (s) => s.value)) === 'cat')
      const katzeGross = await p.$eval('#catSvg', (s) => s.innerHTML)
      const katzeKlein = await p.$eval('#roamCat svg', (s) => s.innerHTML)
      for (const [tier, titel] of Object.entries(TIERE)) {
        await p.selectOption('#petSelect', tier)
        await p.waitForTimeout(150)
        const info = await p.evaluate(() => ({
          titel: document.getElementById('petTitle').textContent,
          gross: document.getElementById('catSvg').innerHTML,
          klein: document.querySelector('#roamCat svg').innerHTML,
          pupillen: document.querySelectorAll('#catSvg .cat-pupil').length,
          blase: document.getElementById('catBubble').textContent,
          pet: document.documentElement.dataset.pet,
        }))
        const anders = tier === 'cat' ? info.gross === katzeGross && info.klein === katzeKlein : info.gross !== katzeGross && info.klein !== katzeKlein
        t.chk(`${ww} ${tier}: Überschrift, Widget und laufendes Tier`, info.titel === titel && anders && info.pupillen === 2 && info.pet === tier, { titel: info.titel, anders, pupillen: info.pupillen })
        t.chk(`${ww} ${tier}: begrüßt beim Wechsel`, info.blase.length > 0, info.blase)
        if (shot) {
          await p.locator('.cat-card').screenshot({ path: `${shot}/tier-${tier}-${breite}.png` })
          await p.locator('#roamStrip').screenshot({ path: `${shot}/tier-${tier}-laufen-${breite}.png`, animations: 'disabled' })
        }
      }
      // Klick: Spruch passt zum Tier
      await p.selectOption('#petSelect', 'dog')
      await p.waitForTimeout(2500)
      // direkt auslösen: das Tier "atmet" (Animation) und weicht dem Mauszeiger aus - ein echter
      // Mausklick ist unter Last deshalb nicht zuverlässig
      await p.$eval('#catSvg', (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      const spruch = await p.textContent('#catBubble')
      const hundeSprueche = ['Wuff!', 'Wuff wuff!', 'Gassi? 🦴', 'Stöckchen!', 'Alles online?', 'Mach Pause!']
      t.chk(`${ww} Klick auf den Hund: Hunde-Spruch`, hundeSprueche.includes(spruch), spruch)
      // traurig/fröhlich geht mit jedem Tier
      const trauer = await p.evaluate(() => { catSad(); const svg = document.getElementById('catSvg'); return { sad: svg.classList.contains('sad'), blase: document.getElementById('catBubble').textContent, mund: [...svg.querySelectorAll('.cat-mouth-sad')].some((m) => getComputedStyle(m).display !== 'none') } })
      t.chk(`${ww} Hund traurig: anderer Mund und eigener Text`, trauer.sad && trauer.mund && /offline/.test(trauer.blase), trauer)
      await p.evaluate(() => catHappy())
      t.chk(`${ww} Hund fröhlich: eigener Text`, /Wuff, alle online/.test(await p.textContent('#catBubble')))
      // läuft unten weiter
      const x1 = await p.$eval('#roamCat', (el) => el.style.transform)
      await p.waitForTimeout(600)
      const x2 = await p.$eval('#roamCat', (el) => el.style.transform)
      t.chk(`${ww} Tier unten läuft`, x1 !== x2, [x1, x2])
      // gemerkt nach dem Neuladen
      await p.selectOption('#petSelect', 'axolotl')
      await p.reload()
      await p.waitForSelector('#petSelect')
      await p.waitForTimeout(200)
      t.chk(`${ww} Auswahl bleibt nach dem Neuladen`, (await p.textContent('#petTitle')) === 'Axolotlpause' && (await p.$eval('#petSelect', (s) => s.value)) === 'axolotl' && (await p.$$('#roamCat .ax-skin')).length > 0)
      // ungültiger Wert im Speicher -> Katze
      await p.evaluate(() => localStorage.setItem('afk-manager-pet', '<img src=x onerror=alert(1)>'))
      await p.reload()
      await p.waitForSelector('#petSelect')
      t.chk(`${ww} Unbekanntes Tier im Speicher: Katze`, (await p.textContent('#petTitle')) === 'Katzenpause')
      t.chk(`${ww} kein seitliches Scrollen`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= breite)
      t.chk(`${ww} keine JS-Fehler`, fehler.length === 0, fehler)
      await ctx.close()
    }
    await browser.close()
  },
}
