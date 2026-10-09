'use client'

import { useSyncExternalStore, useRef, useEffect } from 'react'
import { hud } from '../game/systems/HudStore'
import { Minimap } from './Minimap'

export function Hud({ gameRef }: { gameRef: React.MutableRefObject<{ setMinimapCanvas: (c: HTMLCanvasElement | null) => void } | null> }) {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )

  const minimapRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (minimapRef.current && gameRef.current) {
      gameRef.current.setMinimapCanvas(minimapRef.current)
    }
  }, [gameRef])

  if (state.phase === 'menu' || state.phase === 'loading') return null

  const xpForLevel = (state.level - 1) * 500
  const xpIntoLevel = state.xp - xpForLevel
  const xpPct = Math.min(100, (xpIntoLevel / 500) * 100)

  return (
    <div className="hud-layer">
      {/* Damage flash */}
      {state.damageFlash > 0.02 && (
        <div className="damage-flash" style={{ opacity: state.damageFlash }} />
      )}

      {/* Top-left: money + level */}
      <div className="hud-top-left">
        <div className="money">${state.money.toLocaleString()}</div>
        <div className="level-badge">LVL {state.level}</div>
        <div className="xp-bar">
          <div className="xp-fill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      {/* Top-right: wanted stars */}
      <div className="hud-top-right">
        <div className={`wanted-stars ${state.wantedFlash ? 'flash' : ''}`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={i <= state.wanted ? 'active' : ''}>
              ★
            </span>
          ))}
        </div>
        {state.radioOn && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            ♪ RADIO {state.radioStation + 1}
          </div>
        )}
      </div>

      {/* Top-center: mission */}
      {state.mission && (
        <div className="hud-top-center">
          <div className="mission-text">
            {state.mission.title}
            {state.mission.dist && (
              <span style={{ marginLeft: 12, color: '#00e5ff' }}>{state.mission.dist}</span>
            )}
          </div>
          <div className="mission-timer">{state.mission.time}</div>
        </div>
      )}

      {/* Bottom-left: minimap */}
      <div className="hud-bottom-left">
        <Minimap ref={minimapRef} />
      </div>

      {/* Bottom-right: speed + health */}
      <div className="hud-bottom-right">
        {state.inCar && (
          <>
            <div className="speedo">{Math.round(state.speedKmh)}</div>
            <div className="speedo-unit">KM/H</div>
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <div className="health-bar">
            <div className="health-fill" style={{ width: `${state.health}%` }} />
          </div>
          {state.armor > 0 && (
            <div className="armor-bar">
              <div className="armor-fill" style={{ width: `${state.armor}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Center: crosshair */}
      {!state.inCar && <div className="hud-center crosshair" />}

      {/* Toasts */}
      <div style={{ position: 'absolute', bottom: 130, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        {state.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
