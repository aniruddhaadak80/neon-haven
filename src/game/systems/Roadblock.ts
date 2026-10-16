export interface RoadblockPlan {
  /** World center of the trap. */
  x: number
  z: number
  /** 'x' = cruisers spread along X (road runs along Z) and vice versa. */
  axis: 'x' | 'z'
}

function nearest(street: number[], target: number): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const s of street) {
    const d = Math.abs(s - target)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

/**
 * Choose a spot directly in the player's path: look ahead along the heading
 * and snap the cross-axis coordinate onto the nearest street line, so the
 * trap lands on a road instead of inside a building.
 */
export function planRoadblock(
  px: number,
  pz: number,
  heading: number,
  streetsX: readonly number[],
  streetsZ: readonly number[],
  lookahead: number,
): RoadblockPlan | null {
  if (lookahead <= 0) return null
  const ax = px + Math.sin(heading) * lookahead
  const az = pz + Math.cos(heading) * lookahead

  // Travelling mostly along Z → we're on an N-S street (fixed X).
  if (Math.abs(Math.cos(heading)) >= Math.abs(Math.sin(heading))) {
    const x = nearest([...streetsX], ax)
    if (x === null) return null
    return { x, z: az, axis: 'x' }
  }
  // Travelling mostly along X → we're on an E-W street (fixed Z).
  const z = nearest([...streetsZ], az)
  if (z === null) return null
  return { x: ax, z, axis: 'z' }
}
