/**
 * Equalizer painting for the pulse bar. `barHeights` is pure geometry
 * (unit-testable); `drawPulse` is the thin canvas painter driven by the
 * animation loop.
 * @module dsh-pulse/client/draw
 */

import type { MeterReading, PulseChannel } from './meter.ts'
import { circularMeanHue, frameBlend, lerpHue, MODE_HUES } from './palette.ts'

/** Number of equalizer bars drawn across the strip. */
export const BAR_COUNT = 48

/** Vertical padding inside the canvas, in CSS pixels. */
export const BAR_PAD_Y = 3

/** Idle breathing peak amplitude (fraction of the bar height). */
export const IDLE_AMPLITUDE = 0.16

/** Per-channel Gaussian width in normalized [0, 1] bar space. */
const CHANNEL_WIDTH: Record<PulseChannel, number> = {
  output: 0.20,
  thinking: 0.16,
  tools: 0.09,
  typing: 0.26,
}

/** Max boost applied to a full-energy channel's Gaussian. Typing sits at the
 *  top: its level rarely approaches 1 (each keystroke is a single character),
 *  so the bar boost compensates to keep the input channel visually loud. */
const CHANNEL_BOOST: Record<PulseChannel, number> = {
  output: 0.95,
  thinking: 0.85,
  tools: 0.9,
  typing: 1.0,
}

/** Network presentation state of the current session's wire. */
export type NetworkState = 'connected' | 'connecting' | 'reconnecting'

/** Everything the painter needs besides the meter reading. */
export interface DrawState {
  running: boolean
  stuck: boolean
  pendingCount: number
  network: NetworkState
  darkTheme: boolean
  reducedMotion: boolean
}

/** Canvas size in CSS pixels plus the device pixel ratio. */
export interface CanvasSize {
  width: number
  height: number
  dpr: number
}

/** Drifting Gaussian peak per channel, normalized to [0, 1] bar space. */
export type Peaks = Record<PulseChannel, number>

/** Fresh peaks with every channel centered. */
export function freshPeaks(): Peaks {
  return { output: 0.5, thinking: 0.5, tools: 0.5, typing: 0.5 }
}

/**
 * Random-walk the channel peaks so the equalizer bands wander organically.
 * Deterministic in `now` (frame-quantized) so repeated frames at the same
 * time agree and tests can pin shapes.
 */
export function driftPeaks(peaks: Peaks, now: number, dtSeconds: number): void {
  const frame = Math.floor(now / 300)
  for (const channel of Object.keys(peaks) as PulseChannel[]) {
    const noise = Math.sin(frame * 12.9898 + channelCode(channel) * 78.233) * 43_758.5453
    const step = (noise - Math.floor(noise) - 0.5) * Math.min(0.03, dtSeconds * 2)
    let next = peaks[channel] + step
    if (next < 0.15) next = 0.15
    if (next > 0.85) next = 0.85
    peaks[channel] = next
  }
}

/** Stable per-channel code for the deterministic noise hash. */
function channelCode(channel: PulseChannel): number {
  switch (channel) {
    case 'output': return 1
    case 'thinking': return 2
    case 'tools': return 3
    case 'typing': return 4
  }
}

/** Deterministic per-bar, per-frame jitter in [-1, 1]. */
function barNoise(i: number, now: number): number {
  const raw = Math.sin(i * 127.1 + Math.floor(now / 110) * 311.7)
  return (raw - Math.floor(raw)) * 2 - 1
}

/** One normalized Gaussian centered at `center` (0..1 bar space). */
function gaussian(x: number, center: number, width: number): number {
  const d = (x - center) / width
  return Math.exp(-0.5 * d * d)
}

/**
 * Rounded-rectangle envelope: bars near the strip's ends shrink along a
 * quarter-circle arc (corner zone = `CORNER` of the width each side), so the
 * waveform field itself reads as a rounded rectangle. This is a shape, not a
 * fade — the bars stay fully opaque, they are just shorter at the corners.
 */
export const CORNER_FRACTION = 0.09

/** @param x - bar position in [0, 1]. @returns the envelope multiplier. */
export function cornerTaper(x: number): number {
  const d = Math.min(x, 1 - x) / CORNER_FRACTION
  if (d >= 1) return 1
  return Math.sqrt(2 * d - d * d)
}

/**
 * Compute the per-bar heights (0..1) for one frame.
 * @param reading - the meter reading after decay.
 * @param peaks - drifting channel centers.
 * @param now - frame time in ms (drives idle breathing and jitter).
 * @param reducedMotion - when true the idle breathing is dropped.
 * @returns `BAR_COUNT` heights in [0, 1].
 */
export function barHeights(
  reading: MeterReading,
  peaks: Peaks,
  now: number,
  reducedMotion: boolean,
): number[] {
  const heights: number[] = new Array(BAR_COUNT)
  for (let i = 0; i < BAR_COUNT; i++) {
    const x = i / (BAR_COUNT - 1)
    let energy = 0
    for (const channel of Object.keys(peaks) as PulseChannel[]) {
      const level = reading.channels[channel].level
      if (level <= 0) continue
      energy += level * CHANNEL_BOOST[channel] * gaussian(x, peaks[channel], CHANNEL_WIDTH[channel])
    }
    const idle = reducedMotion
      ? 0
      : IDLE_AMPLITUDE * (0.5 + 0.5 * Math.sin(now * 0.0013 + i * 0.55)) * (0.5 + 0.5 * Math.sin(now * 0.0007 + i * 0.21))
    const jitter = barNoise(i, now) * 0.035 * (reducedMotion ? 0 : 1)
    let height = (idle + energy + jitter) * cornerTaper(x)
    if (height < 0) height = 0
    if (height > 1) height = 1
    heights[i] = height
  }
  return heights
}

/**
 * The hue the strip should drift toward this frame: circular mean of the
 * active channels weighted by their levels, overridden by global states
 * (stuck red, offline steel, pending amber).
 */
export function targetHue(reading: MeterReading, state: DrawState): number {
  if (state.stuck) return MODE_HUES.stuck
  if (state.network !== 'connected') return MODE_HUES.offline
  if (state.pendingCount > 0) return MODE_HUES.tools
  const entries: Array<{ hue: number; weight: number }> = []
  for (const channel of Object.keys(reading.channels) as PulseChannel[]) {
    const level = reading.channels[channel].level
    if (level <= 0) continue
    entries.push({ hue: MODE_HUES[channel], weight: level })
  }
  return circularMeanHue(entries)
}

/**
 * Paint one frame. The caller keeps a `hueRef` holding the current blended
 * hue (mutated here toward the target) so mode shifts glide instead of snap.
 */
export function drawPulse(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  reading: MeterReading,
  peaks: Peaks,
  state: DrawState,
  now: number,
  hueRef: { current: number },
): void {
  const { width, height } = size
  if (width <= 0 || height <= 0) return
  context.clearRect(0, 0, width, height)

  const heights = barHeights(reading, peaks, now, state.reducedMotion)
  const target = targetHue(reading, state)
  hueRef.current = lerpHue(hueRef.current, target, frameBlend(1 / 60, 3))

  const hue = hueRef.current
  const saturation = state.network !== 'connected' || state.stuck ? 45 : 88
  const gap = Math.min(3, width / BAR_COUNT / 4)
  const barW = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT
  const maxH = height - BAR_PAD_Y * 2
  const baseline = height - BAR_PAD_Y

  for (let i = 0; i < BAR_COUNT; i++) {
    const h = Math.max(1, heights[i] * maxH)
    const x = i * (barW + gap)
    const y = baseline - h
    // Capped corner radius: bars stay crisp squared columns (2px is a hint,
    // not a capsule) — the old min(barW/2, h/2) turned short bars into
    // little ovals once the strip grew wider.
    const radius = Math.min(2, h / 2)

    // Soft glow pass behind the bar.
    context.fillStyle = `hsla(${hue}, ${saturation}%, 55%, ${0.10 + 0.12 * heights[i]})`
    roundRect(context, x - gap / 2, baseline - maxH, barW + gap, maxH, radius)
    context.fill()

    // The bar itself; taller bars read brighter.
    const lightness = 50 + 20 * heights[i]
    context.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.92)`
    roundRect(context, x, y, barW, h, radius)
    context.fill()
  }

  // Faint reflective baseline.
  context.fillStyle = state.darkTheme
    ? 'rgba(255, 255, 255, 0.07)'
    : 'rgba(15, 23, 42, 0.10)'
  context.fillRect(0, height - 1, width, 1)
}

/** Fill a rounded rect with a graceful fallback for engines without roundRect. */
function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  if (typeof context.roundRect === 'function') {
    context.beginPath()
    context.roundRect(x, y, w, h, radius)
    context.fill()
    return
  }
  context.fillRect(x, y, w, h)
}
