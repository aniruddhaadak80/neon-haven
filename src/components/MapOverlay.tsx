'use client'

import { useSyncExternalStore, useRef, useEffect } from 'react'
import { hud } from '../game/systems/HudStore'

interface MapApi {
  setBigMapCanvas: (c: HTMLCanvasElement | null) => void
}

/** Fullscreen city map (hold M). The game paints into the canvas. */
export function MapOverlay({ gameRef }: { gameRef: React.MutableRefObject<MapApi | null> }) {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current && gameRef.current) {
      gameRef.current.setBigMapCanvas(canvasRef.current)
    }
    return () => gameRef.current?.setBigMapCanvas(null)
  }, [gameRef])

  if (!state.mapOpen || state.phase !== 'playing') return null

  const size = Math.min(window.innerWidth, window.innerHeight) - 80

  return (
    <div className="map-overlay">
      <canvas ref={canvasRef} width={size} height={size} className="minimap" />
      <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
        release <b>M</b> to close · <b>1–4</b> switch weapon
      </div>
    </div>
  )
}
