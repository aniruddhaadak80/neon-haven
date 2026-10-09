'use client'

import { useSyncExternalStore } from 'react'
import { hud } from '../game/systems/HudStore'

export function PauseMenu({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )

  if (state.phase !== 'paused') return null

  return (
    <div className="menu-overlay">
      <div className="game-title" style={{ fontSize: 56 }}>PAUSED</div>
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button className="btn btn-primary" onClick={onResume}>
          RESUME
        </button>
        <button className="btn" onClick={onQuit}>
          QUIT TO MENU
        </button>
      </div>
      <div className="controls-grid" style={{ marginTop: 32 }}>
        <span className="key">W A S D</span><span>Move / Drive</span>
        <span className="key">LMB</span><span>Shoot</span>
        <span className="key">F</span><span>Enter / Exit car</span>
        <span className="key">SPACE</span><span>Jump / Handbrake</span>
        <span className="key">R</span><span>Radio</span>
        <span className="key">M</span><span>Map</span>
      </div>
    </div>
  )
}
