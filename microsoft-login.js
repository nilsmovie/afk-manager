// Microsoft-Login per Geraete-Code (prismarine-auth, Ablauf "live") robuster machen.
//
// Problem: Lehnt Microsoft die Anmeldung nach der Code-Eingabe ab (z.B. "The user could not be
// authenticated or user interaction is required"), fragt prismarine-auth trotzdem bis zum Ablauf
// des Codes (15 Minuten) alle 5 Sekunden weiter nach - jedes Mal mit der Antwort "device_code has
// already been used", die nur still ins Log geschrieben wird. Der Account stand so lange auf
// "Login nötig", obwohl die Eingabe auf der Microsoft-Seite "erfolgreich" aussah.
//
// Hier ersetzt: Endgueltige Antworten von Microsoft beenden das Warten sofort mit einem Fehler
// (code MSA_LOGIN_REJECTED), den der Manager verstaendlich anzeigt. Ausserdem hat jede Anfrage
// ein Zeitlimit, und "slow_down" wird beachtet. Sonst verhaelt es sich wie das Original.
'use strict'

const path = require('path')

const REQUEST_TIMEOUT_MS = 20000
const REJECTED = 'MSA_LOGIN_REJECTED'

function patch (file) {
  const LiveTokenManager = require(file)
  if (!LiveTokenManager || !LiveTokenManager.prototype || LiveTokenManager.prototype.__afkPatched) return false
  const { Endpoints } = require(path.join(path.dirname(file), '..', 'common', 'Constants'))
  if (!Endpoints || !Endpoints.live || !Endpoints.live.deviceCodeRequest || !Endpoints.live.tokenRequest) return false

  LiveTokenManager.prototype.authDeviceCode = async function authDeviceCode (deviceCodeCallback) {
    const acquireTime = Date.now()
    const cookies = []
    const resp = await fetch(Endpoints.live.deviceCodeRequest, {
      method: 'post',
      body: new URLSearchParams({ scope: this.scopes, client_id: this.clientId, response_type: 'device_code' }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }).then(async (r) => {
      if (r.status !== 200) {
        const text = await r.text().catch(() => '')
        throw new Error(`Microsoft hat keinen Login-Code ausgegeben (HTTP ${r.status}) ${text.slice(0, 200)}`.trim())
      }
      const cookie = r.headers.get('set-cookie')
      if (cookie) cookies.push(cookie.split(';')[0])
      return r.json()
    })
    resp.message = `To sign in, use a web browser to open the page ${resp.verification_uri} and use the code ${resp.user_code} or visit http://microsoft.com/link?otc=${resp.user_code}`
    deviceCodeCallback(resp)

    const expireTime = acquireTime + (Number(resp.expires_in) || 900) * 1000 - 100
    let interval = Math.max(1, Number(resp.interval) || 5)
    let netWarned = false
    this.polling = true
    try {
      while (this.polling && expireTime > Date.now()) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000))
        if (!this.polling) break
        let body
        try {
          const r = await fetch(Endpoints.live.tokenRequest + '?client_id=' + this.clientId, {
            method: 'post',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies.join('; ') },
            body: new URLSearchParams({
              client_id: this.clientId,
              device_code: resp.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            }).toString(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          })
          body = await r.json()
        } catch (e) {
          // Netzwerkproblem: weiter nachfragen (wie das Original), aber nur einmal ins Log
          if (!netWarned) console.warn(`[Microsoft-Login] Nachfragen bei Microsoft fehlgeschlagen (${e.message}) - versuche es weiter`)
          netWarned = true
          continue
        }
        if (body && body.error) {
          if (body.error === 'authorization_pending') continue
          if (body.error === 'slow_down') { interval += 5; continue }
          const desc = String(body.error_description || '').split(/\r?\n/)[0].slice(0, 300)
          const err = new Error(`Microsoft hat die Anmeldung abgelehnt (${body.error}): ${desc}`)
          err.code = REJECTED
          throw err
        }
        if (!body || !body.access_token) continue
        try {
          await this.updateCache(body)
        } catch (e) {
          console.warn(`[Microsoft-Login] Anmeldung konnte nicht gespeichert werden: ${e.message}`)
        }
        return { accessToken: body.access_token }
      }
    } finally {
      this.polling = false
    }
    throw Error('Authentication failed, timed out')
  }
  LiveTokenManager.prototype.__afkPatched = true
  return true
}

// Alle prismarine-auth-Kopien (die eigene und ggf. die von minecraft-protocol / bedrock-protocol)
function install () {
  const roots = [__dirname]
  for (const lib of ['minecraft-protocol', 'bedrock-protocol']) {
    try { roots.push(path.dirname(require.resolve(lib))) } catch (e) { /* nicht installiert */ }
  }
  const files = new Set()
  for (const root of roots) {
    try { files.add(require.resolve('prismarine-auth/src/TokenManagers/LiveTokenManager', { paths: [root] })) } catch (e) { /* fehlt */ }
  }
  let n = 0
  for (const f of files) {
    try { if (patch(f)) n++ } catch (e) { console.warn(`[Microsoft-Login] Anpassung fuer ${f} nicht moeglich: ${e.message}`) }
  }
  return n
}

module.exports = { install, REJECTED }
