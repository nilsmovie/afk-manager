// Protokoll: wer hat wann was gemacht - auf der Webseite und in Discord.
//
// Jede Aktion wird als eine JSON-Zeile in audit.log (im Programmordner) geschrieben und
// zusaetzlich als "[Protokoll] ..." ins normale Log. audit.log wird ab 5 MB zu audit.log.1
// (die alte .1 wird ersetzt), es ist also immer ein gutes Stueck Vergangenheit da.
//
// Nachschauen:  im Dashboard unter Admin -> Protokoll
//          oder: tail -n 50 ~/afk-manager/audit.log
'use strict'

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, 'audit.log')
const OLD_FILE = FILE + '.1'
const KNOWN_FILE = path.join(__dirname, 'audit-known-ips.json')
const MAX_BYTES = 5 * 1024 * 1024

// Kurzer, lesbarer Geraetename aus dem User-Agent, z.B. "iPhone / Safari" oder "Windows / Chrome"
function deviceFromUA (ua) {
  const s = String(ua || '')
  if (!s) return 'unbekanntes Geraet'
  const os = /iPhone/.test(s) ? 'iPhone'
    : /iPad/.test(s) ? 'iPad'
      : /Android/.test(s) ? 'Android'
        : /Windows/.test(s) ? 'Windows'
          : /Mac OS X|Macintosh/.test(s) ? 'Mac'
            : /CrOS/.test(s) ? 'Chromebook'
              : /Linux/.test(s) ? 'Linux'
                : 'anderes System'
  const browser = /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
      : /SamsungBrowser/.test(s) ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
          : /Chrome\/|CriOS/.test(s) ? 'Chrome'
            : /Safari\//.test(s) ? 'Safari'
              : /curl|python|node|axios|wget|Go-http/i.test(s) ? 'Skript/Programm'
                : 'anderer Browser'
  return `${os} / ${browser}`
}

function clip (v, n) {
  const s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ')
  return s.length > n ? s.slice(0, n) + '...' : s
}

function rotateIfNeeded () {
  try {
    const st = fs.statSync(FILE)
    if (st.size >= MAX_BYTES) fs.renameSync(FILE, OLD_FILE)
  } catch (_) { /* Datei gibt es noch nicht */ }
}

// Eine Zeile fuer das normale Log (journalctl)
function describe (e) {
  const where = e.src === 'web'
    ? `Webseite, ${e.ip || '?'}${e.device ? `, ${e.device}` : ''}`
    : e.src === 'discord'
      ? `Discord${e.channel ? ` #${e.channel}` : ''}`
      : e.src
  const who = e.who || '?'
  const target = e.target ? ` "${e.target}"` : ''
  const detail = e.detail ? ` - ${e.detail}` : ''
  return `${who} (${where}): ${e.action}${target}${detail}`
}

/**
 * Schreibt einen Eintrag.
 * @param {object} e { src: 'web'|'discord'|'system', who, role?, ip?, device?, ua?, session?,
 *                     channel?, action, target?, detail?, ok? }
 */
function write (e) {
  const entry = { ts: new Date().toISOString(), ...e }
  for (const k of ['who', 'target', 'detail', 'ua', 'device', 'channel']) {
    if (entry[k] != null) entry[k] = clip(entry[k], k === 'ua' ? 300 : 300)
  }
  try {
    rotateIfNeeded()
    fs.appendFileSync(FILE, JSON.stringify(entry) + '\n')
  } catch (err) {
    console.error('[Protokoll] konnte nicht geschrieben werden:', err.message)
  }
  console.log(`[Protokoll] ${describe(entry)}`)
  return entry
}

// Die letzten `limit` Eintraege, neueste zuerst
function readRecent (limit = 500) {
  const out = []
  for (const f of [FILE, OLD_FILE]) {
    let text = ''
    try { text = fs.readFileSync(f, 'utf8') } catch (_) { continue }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue
      try { out.push(JSON.parse(lines[i])) } catch (_) { /* kaputte Zeile ueberspringen */ }
    }
    if (out.length >= limit) break
  }
  return out
}

// Merkt sich, von welchen IP-Adressen sich ein Dashboard-Nutzer schon angemeldet hat.
// Gibt true zurueck, wenn die Adresse fuer diesen Nutzer neu ist.
let known = null
function isNewIpFor (username, ip) {
  if (!known) {
    try { known = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')) } catch (_) { known = {} }
  }
  const key = String(username || '').toLowerCase()
  const list = Array.isArray(known[key]) ? known[key] : []
  if (list.includes(ip)) return false
  known[key] = [...list, ip].slice(-50)
  try { fs.writeFileSync(KNOWN_FILE, JSON.stringify(known, null, 2)) } catch (_) { /* egal */ }
  return true
}

module.exports = { write, readRecent, deviceFromUA, isNewIpFor, describe, FILE }
