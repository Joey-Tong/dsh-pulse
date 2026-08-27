/**
 * Palette and bar-geometry helpers: hue blending, frame blend factors, and
 * the equalizer bar shapes (idle breathing, energy Gaussians, reduced motion).
 */
import { describe, expect, it } from 'vitest'
import {
  circularMeanHue, frameBlend, lerpHue, lerp,
} from '../src/client/palette.ts'
import { barHeights, BAR_COUNT, cornerTaper, freshPeaks, targetHue } from '../src/client/draw.ts'
import type { DrawState } from '../src/client/draw.ts'
import { emptyReading } from '../src/client/meter.ts'

describe('palette', () => {
  it('blends hues along the shortest arc', () => {
    expect(lerpHue(350, 10, 0.5)).toBeCloseTo(0, 5)
    expect(lerpHue(10, 350, 0.5)).toBeCloseTo(0, 5)
    expect(lerpHue(0, 180, 0.5)).toBeCloseTo(90, 5)
    expect(lerpHue(0, 180, 0)).toBe(0)
    expect(lerpHue(0, 180, 1)).toBe(180)
  })

  it('computes a weighted circular mean and falls back to idle', () => {
    expect(circularMeanHue([{ hue: 0, weight: 1 }, { hue: 180, weight: 1 }]))
      .toBeCloseTo(90, 5)
    expect(circularMeanHue([{ hue: 350, weight: 1 }, { hue: 10, weight: 1 }]))
      .toBeCloseTo(0, 5)
    expect(circularMeanHue([{ hue: 0, weight: 0 }])).toBe(214)
    expect(circularMeanHue([])).toBe(214)
  })

  it('approaches the target with a frame-rate independent factor', () => {
    expect(frameBlend(0, 3)).toBe(0)
    expect(frameBlend(1, 3)).toBeCloseTo(1 - Math.exp(-3), 5)
    expect(frameBlend(-1, 3)).toBe(0)
  })

  it('clamps lerp', () => {
    expect(lerp(0, 10, 2)).toBe(10)
    expect(lerp(0, 10, -1)).toBe(0)
  })
})

describe('barHeights', () => {
  const reading = emptyReading()
  const peaks = freshPeaks()

  it('produces one height per bar in [0, 1]', () => {
    const heights = barHeights(reading, peaks, 0, false)
    expect(heights).toHaveLength(BAR_COUNT)
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(1)
    }
  })

  it('breathes when idle and stays still under reduced motion', () => {
    const idle = barHeights(reading, peaks, 1_000, false)
    const still = barHeights(reading, peaks, 1_000, true)
    const maxIdle = Math.max(...idle)
    expect(maxIdle).toBeGreaterThan(0)
    expect(Math.max(...still)).toBe(0)
  })

  it('raises bars near the channel peak with full energy', () => {
    const boosted = { ...reading, channels: { ...reading.channels, output: { level: 1, charsPerSecond: 0 } } }
    const heights = barHeights(boosted, { ...peaks, output: 0.5 }, 0, true)
    const center = heights[Math.floor(BAR_COUNT / 2)]
    const edge = heights[0]
    expect(center).toBeGreaterThan(0.8)
    expect(edge).toBeLessThan(center)
  })

  it('taper: the waveform envelope is a rounded rectangle, not a fade', () => {
    // The envelope multiplier itself: zero at the very ends, full past the
    // corner zone, symmetric, quarter-circle arc inside the zone.
    expect(cornerTaper(0)).toBe(0)
    expect(cornerTaper(1)).toBe(0)
    expect(cornerTaper(0.5)).toBe(1)
    expect(cornerTaper(0.045)).toBeCloseTo(Math.sqrt(0.75), 6)
    expect(cornerTaper(0.045)).toBeCloseTo(cornerTaper(0.955), 6)

    const boosted = { ...reading, channels: { ...reading.channels, output: { level: 1, charsPerSecond: 0 } } }
    const heights = barHeights(boosted, { ...peaks, output: 0.5 }, 0, true)
    // The outermost bars sit on the corner arc: fully tapered to 0.
    expect(heights[0]).toBe(0)
    expect(heights[BAR_COUNT - 1]).toBe(0)
    // Rising monotonically out of the corner (taper + energy both grow).
    for (let i = 1; i < 5; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1])
      expect(heights[BAR_COUNT - 1 - i]).toBeGreaterThan(heights[BAR_COUNT - i])
    }
  })
})

describe('targetHue', () => {
  const reading = emptyReading()
  const base: DrawState = {
    running: false, stuck: false, pendingCount: 0, network: 'connected',
    darkTheme: false, reducedMotion: false,
  }

  it('stays idle with no activity', () => {
    expect(targetHue(reading, base)).toBe(214)
  })

  it('overrides to red when stuck', () => {
    expect(targetHue(reading, { ...base, stuck: true })).toBe(4)
  })

  it('overrides to steel when offline', () => {
    expect(targetHue(reading, { ...base, network: 'reconnecting' })).toBe(210)
  })

  it('overrides to amber while a pending interaction waits', () => {
    expect(targetHue(reading, { ...base, pendingCount: 1 })).toBe(38)
  })
})
