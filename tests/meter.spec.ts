/**
 * ActivityMeter: pin the bump/decay/EMA behavior and the stuck-detector
 * inputs (idleFor).
 */
import { describe, expect, it } from 'vitest'
import { ActivityMeter, LEVEL_DECAY_PER_SECOND } from '../src/client/meter.ts'

describe('ActivityMeter', () => {
  it('starts empty with an infinite idle span', () => {
    const meter = new ActivityMeter()
    const reading = meter.reading(1_000)
    expect(reading.idleFor).toBe(Infinity)
    for (const channel of ['output', 'thinking', 'tools', 'typing'] as const) {
      expect(reading.channels[channel].level).toBe(0)
      expect(reading.channels[channel].charsPerSecond).toBe(0)
    }
  })

  it('measures characters per second from observed deltas and samples', () => {
    const meter = new ActivityMeter()
    // First observation seeds the rate from a 1s nominal denominator:
    // 10 chars / 1s = 10 chars/s, EMA moves 40% → rate 4.
    meter.feedChars('output', 10, 0)
    meter.sample(0.1, 100)
    // After the sample stamped the clock at 100ms, 10 chars over 100ms
    // reads 100 chars/s: rate = 4 + 0.4 * (100 - 4) = 42.4.
    meter.feedChars('output', 10, 200)
    const reading = meter.reading(200)
    expect(reading.channels.output.charsPerSecond).toBeCloseTo(42.4, 5)
    expect(reading.channels.output.level).toBeGreaterThan(0)
  })

  it('decays levels exponentially and snaps them to zero at the floor', () => {
    const meter = new ActivityMeter()
    meter.feedChars('output', 100, 0)
    expect(meter.reading(0).channels.output.level).toBe(1)
    // One decay constant: level falls to e^-1 ≈ 0.368.
    meter.sample(1, 1_000)
    expect(meter.reading(1_000).channels.output.level).toBeCloseTo(
      Math.exp(-LEVEL_DECAY_PER_SECOND), 5,
    )
    // Long enough decay lands on the floor and snaps to 0.
    meter.sample(10, 11_000)
    expect(meter.reading(11_000).channels.output.level).toBe(0)
  })

  it('ignores non-positive deltas entirely', () => {
    const meter = new ActivityMeter()
    meter.feedChars('output', 0, 100)
    meter.feedChars('thinking', -5, 100)
    const reading = meter.reading(100)
    expect(reading.channels.output.charsPerSecond).toBe(0)
    expect(reading.channels.output.level).toBe(0)
    expect(reading.idleFor).toBe(Infinity)
  })

  it('tracks idle time across channels and notes', () => {
    const meter = new ActivityMeter()
    meter.feedTools(1_000)
    expect(meter.reading(1_500).idleFor).toBe(500)
    meter.feedChars('typing', 3, 2_000)
    expect(meter.reading(2_100).idleFor).toBe(100)
    meter.noteActivity(2_500)
    expect(meter.reading(2_600).idleFor).toBe(100)
  })

  it('caps levels at 1 and keeps per-channel independence', () => {
    const meter = new ActivityMeter()
    meter.feedChars('output', 10_000, 0)
    meter.feedChars('thinking', 5, 0)
    expect(meter.reading(0).channels.output.level).toBe(1)
    expect(meter.reading(0).channels.thinking.level).toBeGreaterThan(0)
    expect(meter.reading(0).channels.typing.level).toBe(0)
  })

  it('amplifies the typing channel: fewer characters reach a full level', () => {
    const typing = new ActivityMeter()
    // 4 typed characters (one keystroke each) saturate the input channel…
    for (let i = 1; i <= 4; i++) typing.feedChars('typing', 1, i * 10)
    expect(typing.reading(40).channels.typing.level).toBeCloseTo(1, 10)
    // …while the same streamed volume barely moves the output channel.
    const output = new ActivityMeter()
    for (let i = 1; i <= 4; i++) output.feedChars('output', 1, i * 10)
    expect(output.reading(40).channels.output.level).toBeLessThan(0.3)
  })
})
