'use client'

import { useSyncExternalStore } from 'react'
import { hud } from '../game/systems/HudStore'

export function DeathScreen({ onRespawn }: { onRespawn: () => void }) {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )

  if (state.phase !== 'dead') return null

  return (
    <div className="menu-overlay" style={{ background: 'rgba(20, 2, 6, 0.88)' }}>
      <div className="game-title" style={{ background: 'linear-gradient(135deg, #ef4444, #7c2d12)', WebkitBackgroundClip: 'text', backgroundClip: 'text' }}>
        WASTED
      </div>
      <div className="game-subtitle">The city got you this time</div>
      <div style={{ marginTop: 20, fontSize: 15, color: 'rgba(255,255,255,0.65)', textAlign: 'center' }}>
        Hospital bill: <b style={{ color: '#f87171' }}>-${Math.floor(state.money * 0.1).toLocaleString()}</b>
        <br />
        Wanted level cleared · mission dropped
      </div>
      <button className="btn btn-primary" onClick={onRespawn} style={{ marginTop: 32 }}>
        RESPAWN
      </button>
    </div>
  )
}
