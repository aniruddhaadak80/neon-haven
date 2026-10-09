'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Game } from '../game/Game'
import { hud } from '../game/systems/HudStore'
import { Hud } from './Hud'
import { StartScreen } from './StartScreen'
import { PauseMenu } from './PauseMenu'
import { MapOverlay } from './MapOverlay'
import { DeathScreen } from './DeathScreen'
import { TouchControls } from './TouchControls'
import type { Input } from '../game/input'

interface GameApi {
  setMinimapCanvas: (c: HTMLCanvasElement | null) => void
  setBigMapCanvas: (c: HTMLCanvasElement | null) => void
  getInput: () => Input
}

/**
 * Owns the game lifecycle.
 *
 * The canvas is created imperatively (not via JSX) so that a React 19
 * StrictMode double-mount gets a *fresh* canvas each time — reusing one
 * canvas element for two WebGLRenderers silently produces a black screen.
 */
export default function GameClient() {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const hudApiRef = useRef<{ setMinimapCanvas: (c: HTMLCanvasElement | null) => void } | null>(null)
  const mapApiRef = useRef<GameApi | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Fresh canvas per mount.
    const canvas = document.createElement('canvas')
    canvas.style.position = 'fixed'
    canvas.style.inset = '0'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const game = new Game(canvas)
    gameRef.current = game
    hudApiRef.current = game as unknown as { setMinimapCanvas: (c: HTMLCanvasElement | null) => void }
    mapApiRef.current = game as unknown as GameApi

    return () => {
      hudApiRef.current?.setMinimapCanvas(null)
      mapApiRef.current?.setBigMapCanvas(null)
      game.dispose()
      canvas.remove()
      gameRef.current = null
      hudApiRef.current = null
      mapApiRef.current = null
    }
  }, [])

  const handleStart = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    void game.start()
  }, [])

  const handleResume = useCallback(() => {
    gameRef.current?.resume()
  }, [])

  const handleRespawn = useCallback(() => {
    gameRef.current?.respawn()
  }, [])

  const handleQuit = useCallback(() => {
    gameRef.current?.dispose()
    hud.set({ phase: 'menu' })
    window.location.reload()
  }, [])

  return (
    <>
      <div ref={containerRef} />
      <Hud gameRef={hudApiRef} />
      <MapOverlay gameRef={mapApiRef} />
      <TouchControls gameRef={mapApiRef} />
      <StartScreen onStart={handleStart} />
      <PauseMenu onResume={handleResume} onQuit={handleQuit} />
      <DeathScreen onRespawn={handleRespawn} />
    </>
  )
}
