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
        <span className="key">LMB / E</span><span>Shoot / Melee</span>
        <span className="key">F</span><span>Enter / Exit car</span>
        <span className="key">SPACE</span><span>Jump / Handbrake</span>
        <span className="key">1–4</span><span>Weapons</span>
        <span className="key">R / T</span><span>Radio / Station</span>
        <span className="key">M / K</span><span>Map / Stats</span>
      </div>
    </div>
  )
}
