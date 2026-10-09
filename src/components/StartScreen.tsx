'use client'

import { useSyncExternalStore } from 'react'
import { hud } from '../game/systems/HudStore'

export function StartScreen({ onStart }: { onStart: () => void }) {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )

  if (state.phase !== 'menu' && state.phase !== 'loading') return null

  return (
    <div className="menu-overlay">
      <div className="game-title">NEON HAVEN</div>
      <div className="game-subtitle">Open-World Crime Sandbox</div>

      {state.phase === 'loading' ? (
        <div style={{ marginTop: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 10 }}>
            {state.loadLabel}…
          </div>
          <div className="loading-bar">
            <div className="loading-fill" style={{ width: `${state.loadFrac * 100}%` }} />
          </div>
        </div>
      ) : (
        <>
          <button className="btn btn-primary" onClick={onStart} style={{ marginTop: 40 }}>
            START GAME
          </button>
          <div className="controls-grid">
            <span className="key">W A S D</span><span>Move / Drive</span>
            <span className="key">MOUSE</span><span>Look / Aim</span>
            <span className="key">LMB</span><span>Shoot</span>
            <span className="key">F</span><span>Enter / Exit car</span>
            <span className="key">SPACE</span><span>Jump / Handbrake</span>
            <span className="key">SHIFT</span><span>Sprint</span>
            <span className="key">R</span><span>Radio on/off</span>
            <span className="key">M</span><span>Fullscreen map</span>
            <span className="key">1–4</span><span>Switch weapon</span>
            <span className="key">ESC</span><span>Pause</span>
          </div>
          <div style={{ marginTop: 24, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
            All art assets are Kenney (CC0). Built with Next.js + Three.js.
          </div>
        </>
      )}
    </div>
  )
}
