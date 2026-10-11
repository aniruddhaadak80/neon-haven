'use client'

import { useSyncExternalStore } from 'react'
import { hud } from '../game/systems/HudStore'

/** Lifetime stats overlay (hold K). Reads straight from the save. */
export function StatsPanel() {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )

  if (!state.statsOpen || state.phase !== 'playing') return null

  const s = state.save.stats
  const rows: [string, string][] = [
    ['Cash', `$${state.money.toLocaleString()}`],
    ['Level', `${state.level} (${state.xp.toLocaleString()} XP)`],
    ['Distance driven', `${(s.distance / 1000).toFixed(1)} km`],
    ['Crimes committed', `${s.crimes}`],
    ['Jobs completed', `${s.jobs}`],
    ['Cars destroyed', `${s.carsDestroyed}`],
    ['Pedestrians hit', `${s.pedsHit}`],
    ['Best wanted level', `${'★'.repeat(state.save.bestWanted) || '—'}`],
  ]

  return (
    <div className="map-overlay">
      <div className="stats-card">
        <div className="stats-title">CAREER STATS</div>
        {rows.map(([k, v]) => (
          <div key={k} className="stats-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
        <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
          release <b>K</b> to close
        </div>
      </div>
    </div>
  )
}
