/**
 * Equalizer color math: per-channel hues and the blending/lerp helpers the
 * canvas loop uses to shift the bar gradient smoothly between activity modes.
 * Pure functions, unit-testable without DOM.
 * @module dsh-pulse/client/palette
 */

/** Base hue per activity mode (HSL hue degrees). */
export const MODE_HUES = {
  idle: 214,
  output: 187,
  thinking: 262,
  tools: 38,
  typing: 152,
  stuck: 4,
  offline: 210,
} as const

export type PulseMode = keyof typeof MODE_HUES

/** The idle hue used when nothing is active. */
export const IDLE_HUE = MODE_HUES.idle

/**
 * Weighted circular mean of hues (shortest-arc aware). Falls back to the
 * idle hue when no weight is positive.
 * @param entries - hue/weight pairs; weights are per-channel energy levels.
 * @returns the mean hue in [0, 360).
 */
export function circularMeanHue(
  entries: ReadonlyArray<{ readonly hue: number; readonly weight: number }>,
): number {
  let x = 0
  let y = 0
  for (const { hue, weight } of entries) {
    if (weight <= 0) continue
    const rad = (hue * Math.PI) / 180
    x += Math.cos(rad) * weight
    y += Math.sin(rad) * weight
  }
  if (x === 0 && y === 0) return IDLE_HUE
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** Linear interpolation with clamping. */
export function lerp(a: number, b: number, t: number): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t
  return a + (b - a) * k
}

/**
 * Interpolate between two hues along the shortest arc.
 * @param from - start hue in [0, 360).
 * @param to - target hue in [0, 360).
 * @param t - 0..1 blend factor.
 * @returns the blended hue in [0, 360).
 */
export function lerpHue(from: number, to: number, t: number): number {
  let delta = (to - from) % 360
  if (delta < 0) delta += 360
  if (delta > 180) delta -= 360
  const hue = from + delta * lerp(0, 1, t)
  return ((hue % 360) + 360) % 360
}

/**
 * Hue blend factor per frame: frame-rate independent approach toward the
 * target (1 - exp(-k·dt)).
 * @param dtSeconds - seconds since the previous frame.
 * @param speed - blend speed constant (higher = snappier).
 * @returns the 0..1 factor.
 */
export function frameBlend(dtSeconds: number, speed = 3): number {
  return 1 - Math.exp(-speed * Math.max(0, dtSeconds))
}
