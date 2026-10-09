// Procedural WebAudio: engine, siren, gunfire, impacts, and a synth radio.
// No audio files — everything is synthesized.

import { AUDIO } from '../config'

export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private sirenOsc: OscillatorNode | null = null
  private sirenGain: GainNode | null = null
  private radioTimer: number | null = null
  private radioNodes: AudioNode[] = []
  private radioStep = 0
  radioStation = 0
  radioOn = false
  private started = false

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return
    this.started = true
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = AUDIO.MASTER
    this.master.connect(this.ctx.destination)
  }

  resume() {
    this.ctx?.resume()
  }

  // --- Engine ---
  startEngine() {
    if (!this.ctx || !this.master || this.engineOsc) return
    this.engineOsc = this.ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 55
    this.engineFilter = this.ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 400
    this.engineGain = this.ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc.connect(this.engineFilter)
    this.engineFilter.connect(this.engineGain)
    this.engineGain.connect(this.master)
    this.engineOsc.start()
  }

  updateEngine(speed01: number, throttle: number) {
    if (!this.engineOsc || !this.engineGain || !this.engineFilter || !this.ctx) return
    const rpm = 50 + speed01 * 160 + Math.abs(throttle) * 30
    this.engineOsc.frequency.setTargetAtTime(rpm, this.ctx.currentTime, 0.05)
    this.engineFilter.frequency.setTargetAtTime(300 + speed01 * 1400, this.ctx.currentTime, 0.1)
    this.engineGain.gain.setTargetAtTime(AUDIO.ENGINE * (0.4 + Math.abs(throttle) * 0.6), this.ctx.currentTime, 0.08)
  }

  stopEngine() {
    if (!this.engineOsc || !this.ctx) return
    const t = this.ctx.currentTime
    this.engineGain?.gain.setTargetAtTime(0, t, 0.1)
    const osc = this.engineOsc
    setTimeout(() => { try { osc.stop() } catch { /* already stopped */ } }, 400)
    this.engineOsc = null
    this.engineGain = null
    this.engineFilter = null
  }

  // --- Siren ---
  setSiren(on: boolean) {
    if (!this.ctx || !this.master) return
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator()
      this.sirenOsc.type = 'triangle'
      this.sirenGain = this.ctx.createGain()
      this.sirenGain.gain.value = 0
      this.sirenOsc.connect(this.sirenGain)
      this.sirenGain.connect(this.master)
      this.sirenOsc.start()
      this.sirenGain.gain.setTargetAtTime(AUDIO.SIREN, this.ctx.currentTime, 0.1)
    } else if (!on && this.sirenOsc) {
      const t = this.ctx.currentTime
      this.sirenGain?.gain.setTargetAtTime(0, t, 0.1)
      const osc = this.sirenOsc
      setTimeout(() => { try { osc.stop() } catch { /* already stopped */ } }, 400)
      this.sirenOsc = null
      this.sirenGain = null
    }
  }

  updateSiren(time: number) {
    if (!this.sirenOsc || !this.ctx) return
    // Two-tone wail.
    const f = 650 + Math.sin(time * 2.4) * 220
    this.sirenOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.03)
  }

  // --- One-shots ---
  gunshot(pitch = 1) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(180 * pitch, t)
    osc.frequency.exponentialRampToValueAtTime(40 * pitch, t + 0.12)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.5, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t)
    osc.stop(t + 0.16)
    // Noise click.
    this.noiseBurst(0.08, 0.35, 1200 * pitch)
  }

  impact(strength = 1) {
    if (!this.ctx || !this.master) return
    this.noiseBurst(0.12, 0.25 * strength, 300)
  }

  explosion() {
    if (!this.ctx || !this.master) return
    this.noiseBurst(0.7, 0.8, 120)
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, t)
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.6)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.7, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t)
    osc.stop(t + 0.75)
  }

  private noiseBurst(duration: number, volume: number, cutoff: number) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const len = Math.floor(this.ctx.sampleRate * duration)
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const gain = this.ctx.createGain()
    gain.gain.value = volume
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    src.start(t)
  }

  // --- Radio (synth chiptune) ---
  setRadio(on: boolean, station = 0) {
    this.radioOn = on
    this.radioStation = station
    if (!this.ctx || !this.master) return
    if (on) {
      this.stopRadioNodes()
      this.radioTimer = window.setInterval(() => this.playRadioStep(), 180)
    } else {
      this.stopRadioNodes()
    }
  }

  private stopRadioNodes() {
    if (this.radioTimer !== null) {
      clearInterval(this.radioTimer)
      this.radioTimer = null
    }
    for (const n of this.radioNodes) {
      if (n instanceof OscillatorNode) { try { n.stop() } catch { /* already stopped */ } }
      n.disconnect()
    }
    this.radioNodes = []
  }

  private playRadioStep() {
    if (!this.ctx || !this.master || !this.radioOn) return
    const t = this.ctx.currentTime
    // Three stations: different scales/tempos.
    const scales = [
      [261.6, 293.7, 329.6, 392.0, 440.0, 523.3], // major
      [220.0, 261.6, 293.7, 329.6, 392.0, 440.0], // minor
      [329.6, 392.0, 440.0, 523.3, 587.3, 659.3], // pentatonic
    ]
    const scale = scales[this.radioStation % scales.length]!
    const note = scale[this.radioStep % scale.length]! * (this.radioStep % 12 < 6 ? 1 : 0.5)
    this.radioStep++
    const osc = this.ctx.createOscillator()
    osc.type = this.radioStation % 2 === 0 ? 'square' : 'triangle'
    osc.frequency.value = note
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(AUDIO.RADIO * 0.5, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t)
    osc.stop(t + 0.18)
    this.radioNodes.push(osc, gain)
    // Bass on beat.
    if (this.radioStep % 4 === 0) {
      const bass = this.ctx.createOscillator()
      bass.type = 'sine'
      bass.frequency.value = note / 4
      const bg = this.ctx.createGain()
      bg.gain.setValueAtTime(0.0001, t)
      bg.gain.exponentialRampToValueAtTime(AUDIO.RADIO, t + 0.03)
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      bass.connect(bg)
      bg.connect(this.master)
      bass.start(t)
      bass.stop(t + 0.32)
      this.radioNodes.push(bass, bg)
    }
  }

  dispose() {
    this.stopEngine()
    this.setSiren(false)
    this.stopRadioNodes()
    this.ctx?.close()
    this.ctx = null
  }
}
