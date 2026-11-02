'use strict'
// =============================================================================
//  nethernet-http.js - NetherNet-Beitritt per Server-Adresse ("HTTP-Signalisierung")
// =============================================================================
//  Seit Bedrock 26.60 treten Bedrock-Clients einem Server so bei:
//    1. GET  http(s)://host:port/v1/join?id=<eigene ID>
//           2xx = der Server bietet NetherNet an (404 = nicht)
//    2. POST http(s)://host:port/v1/join/<eigene ID>   Body: SDP-Angebot
//           Antwort: SDP-Antwort des Servers ("v=..."), danach WebRTC ueber UDP
//  Das Angebot enthaelt schon alle Verbindungs-Kandidaten und den signierten Ausweis
//  (a=identity mit dem Microsoft-Mehrspieler-Token) - beides erzeugen bedrock-protocol und
//  nethernet selbst. Hier fehlt nur der Transport der zwei Anfragen.
//  Vorbild: CloudburstMC/Network NetherNetHTTPClientSignaling (Geysers eigene Bibliothek):
//  erst HTTPS, bei "kein TLS" Klartext-HTTP, Zeitlimit 10 s je Anfrage.
//  WICHTIG: Klartext-HTTP geht wie beim Retail-Client an die IP-ADRESSE (auch im Host-Header).
//  Nur dann traegt der Server die vom Spieler "eingetippte" Adresse als Verbindungs-Kandidaten
//  in seine Antwort ein (Geyser: typedEndpoint). Mit einem Namen ("clashsmp.de") fehlt dieser
//  Kandidat - steckt der Server in Docker, nennt er dann nur interne Adressen.
// =============================================================================
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const net = require('net')
const dns = require('dns')
const path = require('path')

const TIMEOUT_MS = 10000

const REFUSALS = {
  401: 'Ausweis (Microsoft-Mehrspieler-Token) wird vom Server nicht akzeptiert',
  403: 'vom Server abgelehnt (z.B. Sperre, Whitelist, Filter)',
  404: 'der Server bietet hier kein NetherNet an',
  405: 'falsche Anfrage-Art (sollte nicht vorkommen)',
  409: 'diese Verbindung gibt es schon (doppelt)',
  426: 'der Server verlangt eine verschluesselte Verbindung (TLS)',
  429: 'zu viele Versuche in kurzer Zeit',
  500: 'Fehler auf dem Server',
  503: 'Server voll',
  504: 'der Server hat nicht rechtzeitig geantwortet'
}

// ---------------------------------------------------------------------------
// WebRTC (werift) toleranter einstellen
// werift prueft alle ~5 s, ob die Gegenseite noch antwortet (ICE "Consent", RFC 7675): wartet
// nur 0,5-1 s auf die Antwort und gibt die Verbindung 30 s nach der letzten gueltigen Antwort
// auf. Ist der Prozess mit vielen Bots ausgelastet (Event-Loop haengt regelmaessig ~1 s),
// kommen Antworten "zu spaet" und gesunde Verbindungen werden abgebrochen. Daher: 2 s Antwortzeit,
// Aufgabe erst nach 120 s ohne Antwort. (Die Werte liest werift bei jeder Pruefung neu.)
// ---------------------------------------------------------------------------
let weriftTuning = null
function tuneWerift () {
  if (weriftTuning) return weriftTuning
  try {
    const bp = path.dirname(require.resolve('bedrock-protocol'))
    const nnDir = path.dirname(require.resolve('nethernet/package.json', { paths: [bp] }))
    const weriftMain = require.resolve('werift', { paths: [nnDir] }) // .../werift/lib/webrtc/src/index.js
    const weriftRoot = path.resolve(path.dirname(weriftMain), '..', '..', '..')
    const iceBase = require(path.join(weriftRoot, 'lib', 'ice', 'src', 'iceBase.js'))
    iceBase.CONSENT_TIMEOUT = Math.max(Number(iceBase.CONSENT_TIMEOUT) || 0, 120)
    iceBase.CONSENT_RESPONSE_TIMEOUT = Math.max(Number(iceBase.CONSENT_RESPONSE_TIMEOUT) || 0, 2000)
    iceBase.CONSENT_RESPONSE_TIMEOUT_MIN = Math.max(Number(iceBase.CONSENT_RESPONSE_TIMEOUT_MIN) || 0, 2000)
    weriftTuning = { ok: true, consentTimeoutS: iceBase.CONSENT_TIMEOUT, responseMs: iceBase.CONSENT_RESPONSE_TIMEOUT_MIN, delayedAck: false }

    // Empfangsbestaetigungen (SCTP-SACK): werift schickt fuer JEDES empfangene Datenpaket sofort
    // eine eigene, verschluesselte UDP-Antwort ("prefer immediate DATA ACK"). Bei 1000+ Paketen
    // pro Sekunde und Bot ist das fast die Haelfte der Rechenzeit (gemessen: Verschluesseln +
    // UDP-Senden). Normal nach RFC 9260 6.2: jedes 2. Paket bestaetigen, spaetestens nach 200 ms,
    // bei Luecken oder doppelten Paketen sofort. Nur wenn der Code so aussieht wie erwartet.
    try {
      const sctpMod = require(path.join(weriftRoot, 'lib', 'sctp', 'src', 'sctp.js'))
      const proto = sctpMod.SCTP && sctpMod.SCTP.prototype
      const src = proto && typeof proto.receiveDataChunk === 'function' ? proto.receiveDataChunk.toString() : ''
      if (proto && proto.__afkDelayedAck) {
        weriftTuning.delayedAck = true
      } else if (src.includes('prefer immediate DATA ACK') && src.includes('markReceived') && src.includes('popMessages')) {
        proto.receiveDataChunk = function receiveDataChunk (chunk) {
          this.sackNeeded = true
          if (this.markReceived(chunk.tsn)) { // doppelt -> sofort bestaetigen
            this.sackImmediate = true
            return
          }
          this.sackHasNewDataInPacket = true // zaehlt in handleData(): jedes 2. Paket -> SACK
          if (this.sackMisOrdered.size > 0) this.sackImmediate = true // Luecke -> sofort
          const inboundStream = this.getInboundStream(chunk.streamId)
          inboundStream.addChunk(chunk)
          this.advertisedRwnd -= chunk.userData.length
          for (const message of inboundStream.popMessages()) {
            this.advertisedRwnd += message[2].length
            this.receive(...message)
          }
        }
        proto.__afkDelayedAck = true
        weriftTuning.delayedAck = true
      }
    } catch (_) { /* bleibt beim Original */ }
  } catch (e) {
    weriftTuning = { ok: false, error: e.message }
  }
  return weriftTuning
}

function randomNetworkId () {
  return crypto.randomBytes(8).readBigUInt64BE().toString()
}

function shortBody (body) {
  const s = String(body || '').replace(/[^\x20-\x7e]/g, ' ').trim()
  return s.length > 200 ? s.slice(0, 200) + '...' : s
}

function httpError (message, extra) {
  return Object.assign(new Error(message), extra)
}

// IP-Adresse zum Servernamen - IPv4 bevorzugt (wie Java/Retail), sonst die erste gefundene
const literalCache = new Map()
async function resolveLiteral (host) {
  if (net.isIP(host)) return host
  if (literalCache.has(host)) return literalCache.get(host)
  let ip
  try {
    ip = (await dns.promises.lookup(host, { family: 4 })).address
  } catch (_) {
    ip = (await dns.promises.lookup(host)).address
  }
  literalCache.set(host, ip)
  return ip
}
const hostHeader = (h, port) => (net.isIPv6(h) ? `[${h}]:${port}` : `${h}:${port}`)

async function request ({ host, port, secure, method, path, body, headers }) {
  // Verbunden wird immer mit der IP (IPv4 bevorzugt). TLS bekommt zusaetzlich den Namen
  // (Zertifikat), Klartext traegt die IP auch im Host-Header (siehe oben).
  const address = await resolveLiteral(host)
  const res = await new Promise((resolve, reject) => {
    const lib = secure ? https : http
    const req = lib.request({
      host: address,
      port,
      method,
      path,
      ...(secure && !net.isIP(host) ? { servername: host } : {}),
      // Jede Anfrage auf eigener, danach geschlossener Verbindung: der Server erlaubt nur wenige
      // gleichzeitige Anmelde-Verbindungen pro IP (Geyser: 8), alle Bots teilen sich eine IP
      agent: false,
      headers: { 'User-Agent': 'afk-manager-nethernet', Host: secure ? hostHeader(host, port) : hostHeader(address, port), ...headers },
      timeout: TIMEOUT_MS,
      // Wie der Retail-Client: ein vorhandenes, gueltiges Zertifikat wird geprueft
      rejectUnauthorized: true
    }, (res) => {
      const chunks = []
      let length = 0
      res.on('data', (c) => {
        length += c.length
        if (length > 1024 * 1024) { req.destroy(new Error('Antwort zu gross')); return }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(httpError(`keine Antwort innerhalb von ${TIMEOUT_MS / 1000} s`, { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
  res.address = address
  return res
}

// Antwortet am anderen Ende etwas, das KEIN TLS spricht (dann ist Klartext-HTTP richtig)?
function isTlsProblem (err) {
  const text = `${err && err.code} ${err && err.message}`
  return /EPROTO|ERR_SSL|SSL|TLS|wrong version number|packet length|CERT|self.signed|unable to verify/i.test(text)
}

function describeNetError (err) {
  const code = err && err.code
  if (code === 'ECONNREFUSED') return 'Verbindung abgelehnt (TCP-Port zu)'
  if (code === 'ETIMEDOUT') return err.message
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Servername nicht gefunden (DNS)'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Server nicht erreichbar (Netz)'
  if (code === 'ECONNRESET') return 'Verbindung vom Server getrennt'
  return (err && err.message) || String(err)
}

/**
 * Fragt den Server, ob er NetherNet anbietet - erst ueber HTTPS, bei "kein TLS" ueber HTTP.
 * @returns {Promise<{scheme: 'https'|'http', status: number, pong: object|null, raw: string, tlsNote: string|null}>}
 */
async function probe ({ host, port, networkId = randomNetworkId(), scheme = 'auto' }) {
  const path = `/v1/join?id=${encodeURIComponent(networkId)}`
  const headers = { Accept: 'application/json' }
  const read = (res, usedScheme, tlsNote) => {
    if (res.status >= 200 && res.status < 300) {
      let pong = null
      if (res.body && res.body.trim()) {
        try { pong = JSON.parse(res.body) } catch (_) {
          throw httpError(`Der Server hat auf die NetherNet-Anfrage etwas anderes als einen Status geschickt: ${shortBody(res.body)}`, { code: 'NN_BAD_PROBE' })
        }
      }
      return { scheme: usedScheme, status: res.status, pong, raw: res.body, tlsNote, address: res.address }
    }
    const why = REFUSALS[res.status] || `HTTP ${res.status}`
    throw httpError(`Server antwortet ${res.status}: ${why}${res.body ? ` (${shortBody(res.body)})` : ''}`,
      { code: res.status === 404 ? 'NN_NOT_OFFERED' : 'NN_REFUSED', status: res.status })
  }
  if (scheme === 'http') return read(await request({ host, port, secure: false, method: 'GET', path, headers }), 'http', null)
  if (scheme === 'https') return read(await request({ host, port, secure: true, method: 'GET', path, headers }), 'https', null)
  let res
  try {
    res = await request({ host, port, secure: true, method: 'GET', path, headers })
  } catch (err) {
    // Es hat jemand geantwortet, aber nicht mit (gueltigem) TLS -> wie der Retail-Client: Klartext.
    // (Auch bei anderen Fehlern noch einmal unverschluesselt versuchen, bevor aufgegeben wird.)
    const plain = await request({ host, port, secure: false, method: 'GET', path, headers })
      .catch((e) => {
        const why = isTlsProblem(err) ? describeNetError(e) : `${describeNetError(err)} / ${describeNetError(e)}`
        throw httpError(`${host}:${port} ist ueber TCP nicht erreichbar: ${why}`, { code: 'NN_UNREACHABLE', cause: e })
      })
    return read(plain, 'http', `HTTPS ging nicht (${err.code || err.message}), deshalb unverschluesselt`)
  }
  return read(res, 'https', null)
}

/** Schickt das SDP-Angebot und liefert die SDP-Antwort des Servers. */
async function postOffer ({ host, port, scheme, networkId, sdp }) {
  const res = await request({
    host,
    port,
    secure: scheme === 'https',
    method: 'POST',
    path: `/v1/join/${encodeURIComponent(networkId)}`,
    headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp', 'Content-Length': Buffer.byteLength(sdp) },
    body: sdp
  }).catch((e) => { throw httpError(`Angebot konnte nicht gesendet werden: ${describeNetError(e)}`, { code: 'NN_UNREACHABLE', cause: e }) })
  if (res.status < 200 || res.status >= 300) {
    const why = REFUSALS[res.status] || `HTTP ${res.status}`
    throw httpError(`Server lehnt den Beitritt ab (${res.status}: ${why})${res.body ? ` - ${shortBody(res.body)}` : ''}`,
      { code: 'NN_REFUSED', status: res.status })
  }
  // Eine Ablehnung kann auch als 2xx mit kurzem Text kommen - also auf die SDP-Form pruefen
  if (!res.body || !res.body.startsWith('v=')) {
    throw httpError(`Server hat ohne SDP-Antwort geantwortet: ${shortBody(res.body)}`, { code: 'NN_REFUSED', status: res.status })
  }
  return res.body
}

/** Kandidaten (IP/Port/Art) aus einem SDP, z.B. zur Fehlersuche. */
function candidates (sdp) {
  const out = []
  for (const line of String(sdp || '').split(/\r?\n/)) {
    const m = line.match(/^a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\S+)/i)
    if (m) out.push({ protocol: m[1].toLowerCase(), ip: m[2], port: Number(m[3]), type: m[4] })
  }
  return out
}

// Nur IPv4 fuer WebRTC: Bietet der Client auch IPv6 an, antwortet der Server teils ueber IPv6,
// waehrend der Client ueber IPv4 sendet. Die IPv6-Firewall des Routers (z.B. FritzBox) laesst
// die Antworten dann nur ein paar Minuten durch, weil auf IPv6 nichts mehr hinausgeht - danach
// reisst die Verbindung ab. Mit nur IPv4 laufen Hin- und Rueckweg ueber dieselbe NAT-Zuordnung.
function isWerift (RTCPeerConnectionClass) {
  return !!(RTCPeerConnectionClass && RTCPeerConnectionClass.prototype && 'iceTransports' in RTCPeerConnectionClass.prototype)
}

// IPv6-Adressen vergleichbar machen (2001:db8:0:0:0:0:0:0 und 2001:db8:: sind dieselbe)
function normalizeIp (ip) {
  const s = String(ip || '')
  if (!net.isIPv6(s)) return s
  try { return new URL(`http://[${s}]/`).hostname.slice(1, -1) } catch (_) { return s }
}

// ipv6: false = nur IPv4 (Standard), true = beides, 'only' = nur IPv6
function ipMode (ipv6) {
  return ipv6 === 'only' ? 'only' : ipv6 ? 'both' : 'v4'
}

// WebRTC nur mit einer Adressfamilie Kandidaten sammeln lassen (nur werift kennt diese
// Einstellung; beim nativen WebRTC filtern wir stattdessen die SDPs, siehe filterSdp)
function restrictFamily (nn, ipv6) {
  const mode = ipMode(ipv6)
  if (mode === 'both') return
  const base = nn.webrtc
  if (!base || !base.RTCPeerConnection || base.__ipFamily) return
  const Orig = base.RTCPeerConnection
  if (!isWerift(Orig)) return
  const family = mode === 'only' ? { iceUseIpv4: false, iceUseIpv6: true } : { iceUseIpv4: true, iceUseIpv6: false }
  class FamilyPeerConnection extends Orig {
    constructor (config = {}) {
      super({ ...config, ...family })
    }
  }
  nn.webrtc = { ...base, RTCPeerConnection: FamilyPeerConnection, __ipFamily: mode }
}
const useIpv4Only = (nn) => restrictFamily(nn, false) // alter Name, fuer bestehende Aufrufer

// Kandidaten der unerwuenschten Adressfamilie aus einem SDP entfernen (Angebot und Antwort)
function filterSdp (sdp, { ipv6 }) {
  const mode = ipMode(ipv6)
  if (mode === 'both') return sdp
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  return sdp.split(/\r?\n/).filter((line) => {
    const m = line.match(/^a=candidate:\S+ \d+ \S+ \d+ (\S+) /i)
    if (!m) return true
    const isV6 = m[1].includes(':')
    return mode === 'only' ? isV6 : !isV6
  }).join(eol)
}

// Kandidaten, die nachgereicht wurden (natives WebRTC sammelt sie nach und nach), ins Angebot
// einsetzen - ueber HTTP gibt es kein Nachreichen, alles muss in der einen Anfrage stehen.
function addCandidates (sdp, lines) {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  const present = new Set(sdp.split(/\r?\n/).filter((l) => l.startsWith('a=candidate:')))
  const add = lines.map((c) => (c.startsWith('a=') ? c : `a=${c}`)).filter((l) => !present.has(l))
  if (!add.length) return sdp
  const parts = sdp.split(/\r?\n/)
  while (parts.length && parts[parts.length - 1] === '') parts.pop()
  const endIdx = parts.indexOf('a=end-of-candidates')
  if (endIdx >= 0) parts.splice(endIdx, 0, ...add)
  else parts.push(...add, 'a=end-of-candidates')
  return parts.join(eol) + eol
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Haengt die HTTP-Signalisierung an einen bedrock-protocol-Client (transport: 'nethernet').
 * Muss direkt nach createClient() aufgerufen werden.
 * @param {object} client     bedrock-protocol Client
 * @param {object} opts       { host, port, scheme?, ipv6? (false = nur IPv4 (Standard), true = beides, 'only' = nur IPv6), onStep?(name, info) }
 */
function attach (client, { host, port, scheme, ipv6 = false, onStep = () => {} }) {
  tuneWerift()
  const nethernetLib = require(require.resolve('nethernet', { paths: [require.resolve('bedrock-protocol')] }))
  const { SignalStructure, SignalType } = nethernetLib
  let usedScheme = scheme && scheme !== 'auto' ? scheme : null

  // createClient baut den NetherNet-Client je nach Optionen sofort (skipPing) oder erst nach
  // der Server-Suche. Deshalb: ist er schon da, gleich einhaengen, sonst beim 'connect_allowed'
  // (vor dem Listener von createClient, der sofort den Login startet).
  const install = () => {
    const nn = client.connection && client.connection.nethernet
    if (!nn) {
      client.emit('error', new Error('NetherNet-Client fehlt (transport muss "nethernet" sein)'))
      return
    }
    // Keine LAN-Suche (UDP 7551) - der Weg zum Server laeuft hier ueber HTTP
    clearInterval(nn.pingInterval)
    nn.pingInterval = null
    restrictFamily(nn, ipv6)

    // Der Server bekommt ICE + DTLS + Datenkanal nach seiner Antwort nur 5 s Zeit (Standard der
    // Bibliothek). Unter Last oder bei langsamem Netz reicht das knapp nicht - 15 s wie ein
    // normaler Client, der auch nicht nach 5 s aufgibt.
    if (!(nn.inactivityTimeoutMs >= 15000)) nn.inactivityTimeoutMs = 15000

    // Fuer die Fehlersuche: wann ICE/WebRTC welchen Zustand hatte (wer hat zuerst aufgegeben?)
    const diag = { offerAt: 0, connectedAt: 0, pc: null, events: [], pair: null, lastDataAt: 0, msgs: 0 }
    const since = () => {
      const t0 = diag.connectedAt || diag.offerAt
      return t0 ? `${Math.round((Date.now() - t0) / 1000)}s` : '?'
    }
    const watched = new WeakSet()
    const watchPc = (pc) => { // Zustandswechsel mitschreiben - schon ab dem Angebot, nicht erst ab 'connected'
      if (!pc || watched.has(pc)) return
      watched.add(pc)
      try {
        if (pc.iceConnectionStateChange && pc.connectionStateChange) { // werift
          pc.iceConnectionStateChange.subscribe((st) => diag.events.push(`ICE ${st} nach ${since()}`))
          pc.connectionStateChange.subscribe((st) => diag.events.push(`WebRTC ${st} nach ${since()}`))
        } else if (typeof pc.addEventListener === 'function') { // natives WebRTC
          pc.addEventListener('iceconnectionstatechange', () => diag.events.push(`ICE ${pc.iceConnectionState} nach ${since()}`))
          pc.addEventListener('connectionstatechange', () => diag.events.push(`WebRTC ${pc.connectionState} nach ${since()}`))
        }
      } catch (_) { /* ohne Verlauf */ }
    }
    nn.on('connected', () => {
      diag.connectedAt = Date.now()
      diag.pc = nn.rtcConnection
      diag.events.push('Datenkanal offen')
      watchPc(diag.pc)
      try { // welcher Weg (Adresse:Port -> Adresse:Port) gewaehlt wurde
        const ice = diag.pc.iceTransports && diag.pc.iceTransports[0] && diag.pc.iceTransports[0].connection
        const nom = ice && ice.nominated
        if (nom) diag.pair = `${nom.localCandidate.host}:${nom.localCandidate.port} -> ${nom.remoteCandidate.host}:${nom.remoteCandidate.port}`
      } catch (_) { /* egal */ }
      try { // Hat der SERVER die Verbindung beendet (SCTP ABORT/SHUTDOWN)?
        const sctp = diag.pc.sctpTransport && diag.pc.sctpTransport.sctp
        if (sctp && typeof sctp.receiveChunk === 'function') {
          const orig = sctp.receiveChunk
          sctp.receiveChunk = function (chunk) {
            const n = chunk && chunk.constructor && chunk.constructor.name
            if (n === 'AbortChunk') diag.events.push(`SCTP-ABORT vom Server nach ${since()}`)
            else if (n === 'ShutdownChunk') diag.events.push(`SCTP-SHUTDOWN vom Server nach ${since()}`)
            else if (n === 'ReconfigChunk') diag.events.push(`Datenkanal vom Server geschlossen (Stream-Reset) nach ${since()}`)
            else if (n === 'ErrorChunk') diag.events.push(`SCTP-Fehler vom Server nach ${since()}`)
            return orig.call(this, chunk)
          }
        }
      } catch (_) { /* egal */ }
      try {
        for (const d of diag.pc.dtlsTransports || []) d.onStateChange.subscribe((st) => diag.events.push(`DTLS ${st} nach ${since()}`))
      } catch (_) { /* egal */ }
      const native = !isWerift(diag.pc && diag.pc.constructor)
      onStep('webrtc-verbunden', { ipv6, backend: native ? 'nativ' : 'werift', pair: diag.pair })
    })
    nn.on('encapsulated', () => { diag.lastDataAt = Date.now(); diag.msgs++ })
    // prependListener: VOR dem Listener von bedrock-protocol, der den Client sofort schliesst -
    // sonst kaeme der Grund (z.B. connecterror:9) erst an, wenn schon alles abgeraeumt ist
    nn.prependListener('disconnect', (_id, reason) => {
      const pc = diag.pc
      onStep('webrtc-getrennt', {
        reason,
        pair: diag.pair,
        msgs: diag.msgs,
        lastDataAgoS: diag.lastDataAt ? Math.round((Date.now() - diag.lastDataAt) / 1000) : null,
        connectedForMs: diag.connectedAt ? Date.now() - diag.connectedAt : null,
        iceState: pc && pc.iceConnectionState,
        pcState: pc && pc.connectionState,
        events: diag.events.slice(-6)
      })
    })

    const trickled = []
    nn.signalHandler = (signal) => {
      if (signal.type === SignalType.CandidateAdd) { trickled.push(signal.data); return } // kommt ins Angebot

      if (signal.type === SignalType.ConnectError) {
        onStep('verhandlung-fehler', { code: signal.data })
        return
      }
      if (signal.type !== SignalType.ConnectRequest) return
      const localId = String(nn.networkId)
      ;(async () => {
        // Natives WebRTC sammelt die Kandidaten erst nach dem Angebot (werift ist sofort fertig):
        // bis zu 3 s warten, bis alles beisammen ist
        const pc = nn.rtcConnection
        diag.offerAt = Date.now()
        if (pc) { diag.pc = pc; watchPc(pc) }
        const t0 = Date.now()
        while (pc && pc.iceGatheringState !== 'complete' && Date.now() - t0 < 3000) await sleep(50)
        const offer = filterSdp(addCandidates(signal.data, trickled), { ipv6 })
        onStep('angebot', {
          candidates: candidates(offer),
          hasIdentity: /^a=identity:/m.test(offer)
        })
        if (!usedScheme) usedScheme = (await probe({ host, port, networkId: localId })).scheme
        const answer = filterSdp(await postOffer({ host, port, scheme: usedScheme, networkId: localId, sdp: offer }), { ipv6 })
        const remote = candidates(answer)
        onStep('antwort', { candidates: remote, hasIdentity: /^a=identity:/m.test(answer) })
        nn.handleSignal(new SignalStructure(SignalType.ConnectResponse, signal.connectionId, answer, nn.serverNetworkId))
        // Rueckfall: nennt der Server seine oeffentliche Adresse nicht (z.B. hinter Docker), die
        // Adresse dazunehmen, unter der wir ihn gerade erreicht haben - mit dem UDP-Port aus seiner Antwort.
        const ip = ipMode(ipv6) === 'only'
          ? await dns.promises.lookup(host, { family: 6 }).then((r) => r.address, () => null)
          : await resolveLiteral(host).catch(() => null)
        if (ip && !remote.some((c) => normalizeIp(c.ip) === normalizeIp(ip))) {
          const udpPort = (remote.find((c) => c.protocol === 'udp') || {}).port || port
          const extra = `candidate:afk${Date.now() % 100000} 1 udp 1677729535 ${ip} ${udpPort} typ srflx raddr 0.0.0.0 rport 0`
          nn.handleSignal(new SignalStructure(SignalType.CandidateAdd, signal.connectionId, extra, nn.serverNetworkId))
          onStep('zusatz-kandidat', { ip, port: udpPort })
        }
      })().catch((err) => {
        onStep('signalisierung-fehler', { error: err })
        if (typeof client.onConnectionError === 'function') client.onConnectionError(err)
        else client.emit('error', err)
      })
    }
    // Lief connect() schon (z.B. offline ohne Wartezeit beim Login), wartet der Client auf eine
    // LAN-Antwort, die nie kommt -> Angebot jetzt selbst anstossen
    if (nn._pendingConnect && !nn.connection) {
      nn._pendingConnect = false
      nn.startOffer()
    }
  }
  if (client.connection && client.connection.nethernet) install()
  else client.prependOnceListener('connect_allowed', install)
}

module.exports = { probe, postOffer, attach, candidates, randomNetworkId, resolveLiteral, tuneWerift, filterSdp, addCandidates, REFUSALS }
