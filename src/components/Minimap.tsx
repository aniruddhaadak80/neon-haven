'use client'

import { forwardRef } from 'react'

/** The Game draws the map into this canvas; this component just hosts it. */
export const Minimap = forwardRef<HTMLCanvasElement>(function Minimap(_, ref) {
  return (
    <canvas
      ref={ref}
      width={200}
      height={200}
      className="minimap"
      style={{ width: 200, height: 200 }}
    />
  )
})
