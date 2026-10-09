'use client'

import { useSyncExternalStore, useRef, useEffect, useState } from 'react'
import { hud } from '../game/systems/HudStore'
import type { Input } from '../game/input'

interface TouchApi {
  getInput: () => Input
}

/**
 * Mobile controls: left virtual joystick + FIRE / ACTION / BRAKE / JUMP buttons.
 * Only renders on touch devices while playing.
 */
export function TouchControls({ gameRef }: { gameRef: React.MutableRefObject<TouchApi | null> }) {
  const state = useSyncExternalStore(
    (cb) => hud.subscribe(cb),
    () => hud.state,
    () => hud.state,
  )
  const [isTouch, setIsTouch] = useState(false)
  const joyRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef<HTMLDivElement>(null)
  const joyId = useRef<number | null>(null)

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  if (!isTouch || state.phase !== 'playing') return null

  const input = () => gameRef.current?.getInput()

  const onJoyStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0]!
    joyId.current = t.identifier
    onJoyMove(e)
  }

  const onJoyMove = (e: React.TouchEvent) => {
    const el = joyRef.current
    const stick = stickRef.current
    if (!el) return
    let t: React.Touch | null = null
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i]!.identifier === joyId.current) t = e.changedTouches[i]!
    }
    if (!t && e.touches.length > 0 && joyId.current === null) return
    const touch = t ?? e.touches[0]!
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const max = r.width / 2
    let dx = (touch.clientX - cx) / max
    let dy = (touch.clientY - cy) / max
    const len = Math.hypot(dx, dy)
    if (len > 1) { dx /= len; dy /= len }
    input()?.setTouch({ active: true, x: dx, y: dy })
    if (stick) stick.style.transform = `translate(calc(-50% + ${dx * 38}px), calc(-50% + ${dy * 38}px))`
  }

  const onJoyEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i]!.identifier === joyId.current) {
        joyId.current = null
        input()?.setTouch({ active: false, x: 0, y: 0 })
        if (stickRef.current) stickRef.current.style.transform = 'translate(-50%, -50%)'
      }
    }
  }

  const hold = (key: 'fire' | 'brake', down: boolean) => {
    input()?.setTouch({ [key]: down } as Partial<{ fire: boolean; brake: boolean }>)
  }

  const tapAction = () => {
    // Pulsed: setTouch() raises the 'interact' edge, which the game consumes once.
    input()?.setTouch({ action: true })
    window.setTimeout(() => input()?.setTouch({ action: false }), 200)
  }

  return (
    <div className="touch-layer">
      <div
        ref={joyRef}
        className="touch-joystick"
        onTouchStart={onJoyStart}
        onTouchMove={onJoyMove}
        onTouchEnd={onJoyEnd}
        onTouchCancel={onJoyEnd}
      >
        <div ref={stickRef} className="touch-stick" />
      </div>
      <button
        className="touch-btn"
        style={{ right: 30, bottom: 170 }}
        onTouchStart={(e) => { e.preventDefault(); hold('fire', true) }}
        onTouchEnd={() => hold('fire', false)}
      >
        Fire
      </button>
      <button
        className="touch-btn"
        style={{ right: 110, bottom: 90 }}
        onTouchStart={(e) => { e.preventDefault(); tapAction() }}
      >
        Use
      </button>
      <button
        className="touch-btn"
        style={{ right: 30, bottom: 90 }}
        onTouchStart={(e) => { e.preventDefault(); input()?.setJump(true) }}
        onTouchEnd={() => input()?.setJump(false)}
      >
        Jump
      </button>
      <button
        className="touch-btn"
        style={{ right: 190, bottom: 90 }}
        onTouchStart={(e) => { e.preventDefault(); hold('brake', true) }}
        onTouchEnd={() => hold('brake', false)}
      >
        Brake
      </button>
    </div>
  )
}
