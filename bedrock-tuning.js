// Entlastung fuer Bedrock-Bots - benutzt vom Haupt-Thread (server.js) UND von jedem
// Bedrock-Thread (bedrock-worker.js). Ein Thread hat eigene Module, deshalb muss jeder
// Thread die Anpassungen selbst einschalten.
'use strict'

const path = require('path')

// bedrock-protocol entpackt JEDES empfangene Datenpaket mit einem 500-KB-Puffer (zlib chunkSize
// 512000). Bei den vielen kleinen Paketen pro Sekunde ist das rund 5x langsamer als der normale
// Puffer und erzeugt jede Menge Speichermuell - das Ergebnis ist mit kleinem Puffer identisch.
function enableFastInflate () {
  const zlib = require('zlib')
  if (zlib.inflateRawSync.__afkFast) return
  const origInflateRawSync = zlib.inflateRawSync
  const fast = function inflateRawSync (buffer, opts) {
    if (opts && opts.chunkSize === 512000) opts = { ...opts, chunkSize: 16 * 1024 }
    return origInflateRawSync.call(this, buffer, opts)
  }
  fast.__afkFast = true
  zlib.inflateRawSync = fast
}

// Pakete, die bedrock-protocol fuer Anmeldung, Verschluesselung und Spawn selbst braucht, dazu die
// Latenz-Abfrage des Servers (wird beantwortet - Geyser leitet darueber die Keep-Alives des
// Java-Servers weiter) und die Warnung bei fehlerhaften Paketen von uns.
// (item_registry braucht er nur fuer Inventar-Pakete, die der Filter sowieso verwirft)
const DEFAULT_KEEP_PACKETS = [
  'network_settings', 'server_to_client_handshake', 'play_status', 'disconnect',
  'resource_packs_info', 'resource_pack_stack', 'start_game',
  'network_stack_latency', 'packet_violation_warning'
]
// Ohne diese kommt kein Bot ins Spiel - fehlt einer in den Protokolldaten, bleibt der Filter aus
const REQUIRED_PACKETS = ['network_settings', 'server_to_client_handshake', 'play_status', 'disconnect', 'resource_packs_info', 'resource_pack_stack', 'start_game']

function keepPacketNames (extra) {
  return [...DEFAULT_KEEP_PACKETS, ...String(extra || '').split(',').map((s) => s.trim()).filter(Boolean)]
}

const keepIdCache = new Map() // "Version|Namen" -> Set der Paket-IDs (oder null = Filter aus)

function keepIds (version, names, { quiet = false } = {}) {
  const key = `${version}|${names.join(',')}`
  if (keepIdCache.has(key)) return keepIdCache.get(key)
  let ids = null
  try {
    // minecraft-data so laden, wie bedrock-protocol es selbst tut (gleiche Version der Daten)
    const bpDir = path.dirname(require.resolve('bedrock-protocol'))
    const mcData = require(require.resolve('minecraft-data', { paths: [bpDir] }))('bedrock_' + version)
    const header = mcData.protocol.types.mcpe_packet[1].find((f) => f.name === 'name')
    const mappings = header.type[1].mappings
    const found = new Set()
    ids = new Set()
    for (const [id, name] of Object.entries(mappings)) {
      if (names.includes(name)) { ids.add(Number(id)); found.add(name) }
    }
    const missing = REQUIRED_PACKETS.filter((n) => !found.has(n))
    if (missing.length) {
      if (!quiet) console.warn(`[Bedrock] Paketfilter aus: ${missing.join(', ')} fehlt in den Protokolldaten fuer ${version}`)
      ids = null
    } else if (!quiet) {
      console.log(`[Bedrock] Paketfilter an (${version}): ${ids.size} von ${Object.keys(mappings).length} Pakettypen werden gelesen, der Rest verworfen`)
    }
  } catch (e) {
    if (!quiet) console.warn(`[Bedrock] Paketfilter aus: Protokolldaten fuer ${version} nicht lesbar (${e.message})`)
    ids = null
  }
  keepIdCache.set(key, ids)
  return ids
}

// Haengt den Filter vor das Lesen der Pakete. Jedes Paket beginnt mit einer varint-Kopfzeile,
// deren untere 10 Bit die Paket-ID sind - mehr muss fuer die Entscheidung nicht gelesen werden.
// counters: { read, dropped } wird hochgezaehlt; onCount(read?) optional fuer Summen.
function installPacketFilter (client, { names, counters, quiet = false, onCount } = {}) {
  if (!client || typeof client.readPacket !== 'function') return false
  const version = client.options && client.options.version
  const keep = version ? keepIds(version, names || DEFAULT_KEEP_PACKETS, { quiet }) : null
  if (!keep) return false
  const readPacket = client.readPacket.bind(client)
  client.readPacket = (packet) => {
    let id = 0
    let shift = 0
    let i = 0
    let b
    do {
      b = packet[i++]
      if (b === undefined) return readPacket(packet) // kaputter Kopf: normal lesen lassen
      id |= (b & 0x7f) << shift
      shift += 7
    } while ((b & 0x80) && shift < 35)
    if (keep.has(id & 0x3ff)) {
      counters.read++
      if (onCount) onCount(true)
      return readPacket(packet)
    }
    counters.dropped++
    if (onCount) onCount(false)
    return undefined
  }
  return true
}

module.exports = { enableFastInflate, keepPacketNames, keepIds, installPacketFilter, DEFAULT_KEEP_PACKETS, REQUIRED_PACKETS }
