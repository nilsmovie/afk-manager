// Fuehrt alle Szenarien aus test/szenarien/ nacheinander aus (jedes in einem eigenen Prozess).
//   npm test                    alle
//   npm test -- warteschlange   nur Szenarien, deren Dateiname "warteschlange" enthaelt
// Szenarien mit "phasen: 2" laufen zweimal im selben Ordner (z.B. fuer einen Neustart).
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const dir = path.join(__dirname, 'szenarien')
const filter = process.argv[2] || ''
const dateien = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f.includes(filter)).sort()
let ok = 0
let fehler = 0
const kaputt = []

for (const f of dateien) {
  const datei = path.join(dir, f)
  const phasen = require(datei).phasen || 1
  const lauf = path.join(__dirname, '.lauf', path.basename(f, '.js'))
  for (let phase = 1; phase <= phasen; phase++) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'lib', 'harness.js'), datei], {
      env: { ...process.env, TEST_PHASE: String(phase), TEST_LAUF_DIR: lauf },
      encoding: 'utf8',
      timeout: 240000,
    })
    process.stdout.write(r.stdout || '')
    if (r.stderr && r.stderr.trim()) process.stdout.write(r.stderr.split('\n').filter((z) => z.trim()).map((z) => `  [stderr] ${z}`).join('\n') + '\n')
    const m = /ERGEBNIS (\d+) ok, (\d+) Fehler/.exec(r.stdout || '')
    if (m) { ok += Number(m[1]); fehler += Number(m[2]) } else { fehler++ }
    if (r.status !== 0) kaputt.push(`${f}${phasen > 1 ? ` (Phase ${phase})` : ''}`)
  }
}

process.stdout.write(`\nGESAMT: ${ok} ok, ${fehler} Fehler${kaputt.length ? ` - betroffen: ${kaputt.join(', ')}` : ''}\n`)
process.exit(kaputt.length ? 1 : 0)
