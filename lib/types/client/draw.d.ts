/**
 * Equalizer painting for the pulse bar. `barHeights` is pure geometry
 * (unit-testable); `drawPulse` is the thin canvas painter driven by the
 * animation loop.
 * @module dsh-pulse/client/draw
 */
import type { MeterReading, PulseChannel } from './meter.ts';
/** Number of equalizer bars drawn across the strip. */
export declare const BAR_COUNT = 48;
/** Vertical padding inside the canvas, in CSS pixels. */
export declare const BAR_PAD_Y = 3;
/** Idle breathing peak amplitude (fraction of the bar height). */
export declare const IDLE_AMPLITUDE = 0.16;
/** Network presentation state of the current session's wire. */
export type NetworkState = 'connected' | 'connecting' | 'reconnecting';
/** Everything the painter needs besides the meter reading. */
export interface DrawState {
    running: boolean;
    stuck: boolean;
    pendingCount: number;
    network: NetworkState;
    darkTheme: boolean;
    reducedMotion: boolean;
}
/** Canvas size in CSS pixels plus the device pixel ratio. */
export interface CanvasSize {
    width: number;
    height: number;
    dpr: number;
}
/** Drifting Gaussian peak per channel, normalized to [0, 1] bar space. */
export type Peaks = Record<PulseChannel, number>;
/** Fresh peaks with every channel centered. */
export declare function freshPeaks(): Peaks;
/**
 * Random-walk the channel peaks so the equalizer bands wander organically.
 * Deterministic in `now` (frame-quantized) so repeated frames at the same
 * time agree and tests can pin shapes.
 */
export declare function driftPeaks(peaks: Peaks, now: number, dtSeconds: number): void;
/**
 * Rounded-rectangle envelope: bars near the strip's ends shrink along a
 * quarter-circle arc (corner zone = `CORNER` of the width each side), so the
 * waveform field itself reads as a rounded rectangle. This is a shape, not a
 * fade — the bars stay fully opaque, they are just shorter at the corners.
 */
export declare const CORNER_FRACTION = 0.09;
/** @param x - bar position in [0, 1]. @returns the envelope multiplier. */
export declare function cornerTaper(x: number): number;
/**
 * Compute the per-bar heights (0..1) for one frame.
 * @param reading - the meter reading after decay.
 * @param peaks - drifting channel centers.
 * @param now - frame time in ms (drives idle breathing and jitter).
 * @param reducedMotion - when true the idle breathing is dropped.
 * @returns `BAR_COUNT` heights in [0, 1].
 */
export declare function barHeights(reading: MeterReading, peaks: Peaks, now: number, reducedMotion: boolean): number[];
/**
 * The hue the strip should drift toward this frame: circular mean of the
 * active channels weighted by their levels, overridden by global states
 * (stuck red, offline steel, pending amber).
 */
export declare function targetHue(reading: MeterReading, state: DrawState): number;
/**
 * Paint one frame. The caller keeps a `hueRef` holding the current blended
 * hue (mutated here toward the target) so mode shifts glide instead of snap.
 */
export declare function drawPulse(context: CanvasRenderingContext2D, size: CanvasSize, reading: MeterReading, peaks: Peaks, state: DrawState, now: number, hueRef: {
    current: number;
}): void;
