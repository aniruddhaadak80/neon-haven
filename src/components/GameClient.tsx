'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Game } from '../game/Game'
import { hud } from '../game/systems/HudStore'
import { Hud } from './Hud'
import { StartScreen } from './StartScreen'
import { PauseMenu } from './PauseMenu'

export default function GameClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const minimapGameRef = useRef<{ setMinimapCanvas: (c: HTMLCanvasElement | null) => void } | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const game = new Game(canvasRef.current)
    gameRef.current = game
    minimapGameRef.current = game as unknown as { setMinimapCanvas: (c: HTMLCanvasElement | null) => void }

    return () => {
      game.dispose()
      gameRef.current = null
      minimapGameRef.current = null
    }
  }, [])

  const handleStart = useCallback(() => {
    gameRef.current?.start()
  }, [])

  const handleResume = useCallback(() => {
    gameRef.current?.resume()
  }, [])

  const handleQuit = useCallback(() => {
    gameRef.current?.dispose()
    hud.set({ phase: 'menu' })
    // Remount by reloading the route
    window.location.reload()
  }, [])

  return (
    <>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0 }} />
      <Hud gameRef={minimapGameRef} />
      <StartScreen onStart={handleStart} />
      <PauseMenu onResume={handleResume} onQuit={handleQuit} />
    </>
  )
}
