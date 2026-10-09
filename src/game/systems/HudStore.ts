import type { GamePhase, SaveData } from '../types'

// A tiny external store the game writes to and React subscribes to.
// Keeps the 3D loop free of React re-renders.

export interface HudState {
  phase: GamePhase
  money: number
  xp: number
  level: number
  health: number
  armor: number
  wanted: number
  wantedFlash: boolean
  speedKmh: number
  inCar: boolean
  mission: { title: string; time: string; dist: string } | null
  radioOn: boolean
  radioStation: number
  /** Transient toast notifications. */
  toasts: { id: number; text: string; kind: 'info' | 'good' | 'bad' }[]
  /** Loading progress 0..1. */
  loadFrac: number
  loadLabel: string
  /** Damage flash 0..1. */
  damageFlash: number
  /** True while the map overlay is open. */
  mapOpen: boolean
  /** Currently equipped weapon id. */
  weapon: string
  /** Owned weapon ids. */
  weapons: string[]
  save: SaveData
}

let toastId = 1

class HudStore {
  state: HudState = {
    phase: 'menu',
    money: 0,
    xp: 0,
    level: 1,
    health: 100,
    armor: 0,
    wanted: 0,
    wantedFlash: false,
    speedKmh: 0,
    inCar: false,
    mission: null,
    radioOn: false,
    radioStation: 0,
    toasts: [],
    loadFrac: 0,
    loadLabel: '',
    damageFlash: 0,
    mapOpen: false,
    weapon: 'pistol',
    weapons: ['pistol'],
    save: {
      money: 0, xp: 0, level: 1,
      stats: { distance: 0, crimes: 0, jobs: 0, carsDestroyed: 0, pedsHit: 0 },
      bestWanted: 0,
    },
  }

  private listeners = new Set<() => void>()
  private toastTimers = new Map<number, number>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  set(partial: Partial<HudState>) {
    Object.assign(this.state, partial)
    this.emit()
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const id = toastId++
    this.state.toasts = [...this.state.toasts.slice(-3), { id, text, kind }]
    this.emit()
    const timer = window.setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((t) => t.id !== id)
      this.emit()
    }, 3200)
    this.toastTimers.set(id, timer)
  }

  dispose() {
    for (const t of this.toastTimers.values()) clearTimeout(t)
    this.toastTimers.clear()
    this.listeners.clear()
  }
}

export const hud = new HudStore()
