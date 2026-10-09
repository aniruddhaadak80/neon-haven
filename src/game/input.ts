// Keyboard + mouse input with pointer lock. The game reads `state` each frame.

export interface InputState {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  sprint: boolean
  handbrake: boolean
  jump: boolean
  /** Edge-triggered actions consumed by the game. */
  interact: boolean
  shoot: boolean
  shootHeld: boolean
  radio: boolean
  pause: boolean
  map: boolean
  camera: boolean
  /** Mouse look delta since last frame. */
  lookX: number
  lookY: number
  /** Pointer is locked (mouse look active). */
  locked: boolean
  /** Touch joystick vector (-1..1) and buttons. */
  touch: { active: boolean; x: number; y: number; fire: boolean; action: boolean; brake: boolean }
}

const KEY_MAP: Record<string, keyof InputState> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'handbrake',
}

export class Input {
  state: InputState = {
    forward: false, back: false, left: false, right: false,
    sprint: false, handbrake: false, jump: false,
    interact: false, shoot: false, shootHeld: false,
    radio: false, pause: false, map: false, camera: false,
    lookX: 0, lookY: 0, locked: false,
    touch: { active: false, x: 0, y: 0, fire: false, action: false, brake: false },
  }

  private keys = new Set<string>()
  private canvas: HTMLElement
  onPause?: () => void
  onMap?: (down: boolean) => void
  private edge = new Set<string>()

  constructor(canvas: HTMLElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.blur)
    document.addEventListener('pointerlockchange', this.lockChange)
    document.addEventListener('mousemove', this.mouseMove)
    document.addEventListener('mousedown', this.mouseDown)
    document.addEventListener('mouseup', this.mouseUp)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  dispose() {
    window.removeEventListener('keydown', this.keyDown)
    window.removeEventListener('keyup', this.keyUp)
    window.removeEventListener('blur', this.blur)
    document.removeEventListener('pointerlockchange', this.lockChange)
    document.removeEventListener('mousemove', this.mouseMove)
    document.removeEventListener('mousedown', this.mouseDown)
    document.removeEventListener('mouseup', this.mouseUp)
  }

  requestLock() {
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock()
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  private keyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    this.keys.add(e.code)
    const action = KEY_MAP[e.code]
    if (action) {
      ;(this.state as unknown as Record<string, boolean>)[action] = true
      this.edge.add(action)
    }
    if (e.code === 'KeyF') { this.state.interact = true; this.edge.add('interact') }
    if (e.code === 'KeyR') { this.state.radio = true; this.edge.add('radio') }
    if (e.code === 'KeyV') { this.state.camera = true; this.edge.add('camera') }
    if (e.code === 'KeyM') { this.state.map = true; this.edge.add('map'); this.onMap?.(true) }
    if (e.code === 'Escape' || e.code === 'KeyP') { this.edge.add('pause'); this.onPause?.() }
    if (e.code === 'Space') { this.state.jump = true; this.edge.add('jump') }
  }

  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
    const action = KEY_MAP[e.code]
    if (action) (this.state as unknown as Record<string, boolean>)[action] = false
    if (e.code === 'KeyF') this.state.interact = false
    if (e.code === 'KeyR') this.state.radio = false
    if (e.code === 'KeyV') this.state.camera = false
    if (e.code === 'KeyM') { this.state.map = false; this.onMap?.(false) }
    if (e.code === 'Space') this.state.jump = false
  }

  private blur = () => {
    this.keys.clear()
    const s = this.state as unknown as Record<string, boolean>
    for (const k of Object.keys(s)) {
      if (typeof s[k] === 'boolean') s[k] = false
    }
  }

  private lockChange = () => {
    this.state.locked = document.pointerLockElement === this.canvas
  }

  private mouseMove = (e: MouseEvent) => {
    if (!this.state.locked) return
    this.state.lookX += e.movementX
    this.state.lookY += e.movementY
  }

  private mouseDown = (e: MouseEvent) => {
    if (e.button === 0) { this.state.shoot = true; this.state.shootHeld = true; this.edge.add('shoot') }
  }

  private mouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.state.shootHeld = false
  }

  /** Consume edge-triggered actions (returns true once per press). */
  consume(action: string): boolean {
    if (this.edge.has(action)) {
      this.edge.delete(action)
      return true
    }
    return false
  }

  /** Clear per-frame deltas. Call at end of frame. */
  endFrame() {
    this.state.lookX = 0
    this.state.lookY = 0
    this.state.shoot = false
  }
}
