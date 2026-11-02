// Ein Bedrock-Account in einem eigenen Thread (worker_threads).
//
// Warum: Ein Account an einer Farm bekommt ueber NetherNet mehrere tausend Nachrichten pro
// Sekunde. werift (WebRTC in JavaScript) muss jede davon entschluesseln und bestaetigen. Liefen
// alle Accounts im Haupt-Thread, war ein Prozessorkern voll, die Bestaetigungen kamen zu spaet,
// und der Server hat die Verbindung nach 2-3 Minuten abgebrochen (SCTP-ABORT). Hier hat jeder
// Account seinen eigenen Thread und damit seinen eigenen Kern.
//
// Der Haupt-Thread (bedrock-thread.js) sieht nur ein Stellvertreter-Objekt mit denselben
// Ereignissen wie ein bedrock-protocol-Client (spawn, disconnect, error, close ...).
'use strict'

const { parentPort, workerData } = require('worker_threads')
const tuning = require('./bedrock-tuning')

const cfg = workerData
if (cfg.fastInflate) tuning.enableFastInflate()
const bedrock = require('bedrock-protocol')
const nnhttp = require('./nethernet-http')

function post (msg) {
  try {
    parentPort.postMessage(msg)
  } catch (e) {
    try { parentPort.postMessage({ type: 'log', level: 'warn', text: `[${cfg.label}] Thread-Nachricht "${msg && msg.type}" nicht uebertragbar: ${e.message}` }) } catch (_) { /* egal */ }
  }
}

const errInfo = (e) => ({ message: String((e && e.message) || e), name: e && e.name, code: e && e.code })

// Einzelne kaputte Pakete o.ae. sollen den Thread nicht beenden (wie im Haupt-Thread)
process.on('uncaughtException', (e) => post({ type: 'error', error: errInfo(e) }))
process.on('unhandledRejection', (e) => post({ type: 'error', error: errInfo(e) }))

// Paketzaehler: alle 2 s die Differenz an den Haupt-Thread
const counters = { read: 0, dropped: 0 }
let reported = { read: 0, dropped: 0 }
function flushStats () {
  const read = counters.read - reported.read
  const dropped = counters.dropped - reported.dropped
  if (!read && !dropped) return
  reported = { read: counters.read, dropped: counters.dropped }
  post({ type: 'stats', read, dropped })
}
const statsTimer = setInterval(flushStats, 2000)

let client
let ended = false
function end () {
  if (ended) return
  ended = true
  clearInterval(statsTimer)
  flushStats()
  post({ type: 'close' })
  // NetherNet raeumt asynchron auf - kurz Zeit lassen, dann ist der Thread fertig
  setTimeout(() => process.exit(0), 500).unref()
}

try {
  client = bedrock.createClient({
    ...cfg.client,
    onMsaCode: (data) => post({ type: 'msa', data: JSON.parse(JSON.stringify(data)) })
  })
} catch (e) {
  post({ type: 'error', error: errInfo(e) })
  end()
}

if (client) {
  client.viewDistance = cfg.viewDistance
  post({ type: 'info', options: { version: client.options.version, protocolVersion: client.options.protocolVersion }, username: client.username })

  if (cfg.keepPackets) {
    tuning.installPacketFilter(client, { names: cfg.keepPackets, counters, quiet: true })
  }

  if (cfg.attach) {
    nnhttp.attach(client, {
      ...cfg.attach,
      onStep: (name, info = {}) => {
        if (name === 'webrtc-getrennt') flushStats() // Zahlen sollen in der Diagnose-Zeile stimmen
        post({ type: 'step', name, info: info.error ? { ...info, error: errInfo(info.error) } : info })
      }
    })
  }

  client.on('session', (profile) => post({ type: 'session', profile: profile ? { name: profile.name, uuid: profile.uuid, xuid: profile.xuid } : null }))
  for (const name of ['spawn', 'disconnect', 'kick', 'packet_violation_warning']) {
    client.on(name, (data) => post({ type: 'event', name, data }))
  }
  client.on('error', (e) => post({ type: 'error', error: errInfo(e) }))
  client.on('close', end)

  parentPort.on('message', (m) => {
    if (!m || ended) return
    try {
      if (m.type === 'queue') client.queue(m.name, m.params)
      else if (m.type === 'write') client.write(m.name, m.params)
      else if (m.type === 'disconnect') client.disconnect(m.reason)
      else if (m.type === 'close') { client.close(); end() }
    } catch (e) {
      if (m.type === 'queue' || m.type === 'write') post({ type: 'sendError', name: m.name, error: errInfo(e) })
      else post({ type: 'error', error: errInfo(e) })
    }
  })
}
