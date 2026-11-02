// Stellvertreter im Haupt-Thread fuer einen Bedrock-Account, der in einem eigenen Thread laeuft
// (bedrock-worker.js). Verhaelt sich nach aussen wie ein bedrock-protocol-Client:
//   Ereignisse: session, spawn, disconnect, kick, packet_violation_warning, error, close
//   Methoden:   queue(name, params), write(name, params), disconnect(grund), close()
//   Felder:     options.version, options.protocolVersion, username, profile
// close() meldet 'close' sofort (wie bedrock-protocol) und beendet danach den Thread.
'use strict'

const path = require('path')
const EventEmitter = require('events')
const { Worker } = require('worker_threads')

const reviveError = (e) => Object.assign(new Error((e && e.message) || 'Fehler im Bedrock-Thread'), {
  name: (e && e.name) || 'Error',
  ...(e && e.code !== undefined ? { code: e.code } : {})
})

class BedrockThreadClient extends EventEmitter {
  /**
   * @param {object} cfg        geht als workerData an bedrock-worker.js
   * @param {object} callbacks  { onInfo(options), onMsaCode(data), onStep(name, info), onStats({read, dropped}), onSendError(name, err), onExit(code) }
   */
  constructor (cfg, callbacks = {}) {
    super()
    this.cb = callbacks
    this.options = { version: cfg.client && cfg.client.version, protocolVersion: undefined }
    this.username = cfg.client && cfg.client.username
    this.profile = null
    this.isThread = true
    this._closed = false
    this._exited = false
    this.worker = new Worker(path.join(__dirname, 'bedrock-worker.js'), { workerData: cfg })
    this.worker.on('message', (m) => this._onMessage(m))
    this.worker.on('error', (e) => {
      // Thread ist abgestuerzt (nicht abgefangener Fehler beim Laden o.ae.)
      this._emitError(e)
      this._finish()
    })
    this.worker.on('exit', (code) => {
      this._exited = true
      if (this.cb.onExit) this.cb.onExit(code)
      this._finish()
    })
  }

  _emitError (e) {
    if (this._closed) return
    if (this.listenerCount('error') > 0) this.emit('error', e)
  }

  _onMessage (m) {
    if (!m) return
    switch (m.type) {
      case 'info':
        Object.assign(this.options, m.options || {})
        if (m.username) this.username = m.username
        if (this.cb.onInfo) this.cb.onInfo(this.options)
        break
      case 'msa':
        if (!this._closed && this.cb.onMsaCode) this.cb.onMsaCode(m.data)
        break
      case 'step':
        if (!this._closed && this.cb.onStep) {
          const info = m.info && m.info.error ? { ...m.info, error: reviveError(m.info.error) } : (m.info || {})
          this.cb.onStep(m.name, info)
        }
        break
      case 'stats':
        if (this.cb.onStats) this.cb.onStats(m)
        break
      case 'session':
        this.profile = m.profile
        if (!this._closed) this.emit('session', m.profile)
        break
      case 'event':
        if (!this._closed) this.emit(m.name, m.data)
        break
      case 'error':
        this._emitError(reviveError(m.error))
        break
      case 'sendError':
        if (this.cb.onSendError) this.cb.onSendError(m.name, reviveError(m.error))
        break
      case 'close':
        this._finish()
        break
      case 'log':
        (console[m.level] || console.log)(m.text)
        break
    }
  }

  _send (msg) {
    if (this._closed) throw new Error('Verbindung ist geschlossen')
    this.worker.postMessage(msg)
  }

  queue (name, params) { this._send({ type: 'queue', name, params }) }
  write (name, params) { this._send({ type: 'write', name, params }) }
  disconnect (reason) { if (!this._closed) this.worker.postMessage({ type: 'disconnect', reason }) }

  close () {
    if (this._closed) return
    try { this.worker.postMessage({ type: 'close' }) } catch (_) { /* Thread schon weg */ }
    this._finish()
  }

  _finish () {
    if (this._closed) return
    this._closed = true
    try {
      this.emit('close')
    } finally {
      this.removeAllListeners()
      // Raeumt der Thread nicht selbst auf, wird er nach 3 s beendet
      const t = setTimeout(() => { if (!this._exited) this.worker.terminate().catch(() => {}) }, 3000)
      if (t.unref) t.unref()
    }
  }
}

module.exports = { BedrockThreadClient }
