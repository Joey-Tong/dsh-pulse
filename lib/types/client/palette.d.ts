/**
 * Equalizer color math: per-channel hues and the blending/lerp helpers the
 * canvas loop uses to shift the bar gradient smoothly between activity modes.
 * Pure functions, unit-testable without DOM.
 * @module dsh-pulse/client/palette
 */
/** Base hue per activity mode (HSL hue degrees). */
export declare const MODE_HUES: {
    readonly idle: 214;
    readonly output: 187;
    readonly thinking: 262;
    readonly tools: 38;
    readonly typing: 152;
    readonly stuck: 4;
    readonly offline: 210;
};
export type PulseMode = keyof typeof MODE_HUES;
/** The idle hue used when nothing is active. */
export declare const IDLE_HUE: 214;
/**
 * Weighted circular mean of hues (shortest-arc aware). Falls back to the
 * idle hue when no weight is positive.
 * @param entries - hue/weight pairs; weights are per-channel energy levels.
 * @returns the mean hue in [0, 360).
 */
export declare function circularMeanHue(entries: ReadonlyArray<{
    readonly hue: number;
    readonly weight: number;
}>): number;
/** Linear interpolation with clamping. */
export declare function lerp(a: number, b: number, t: number): number;
/**
 * Interpolate between two hues along the shortest arc.
 * @param from - start hue in [0, 360).
 * @param to - target hue in [0, 360).
 * @param t - 0..1 blend factor.
 * @returns the blended hue in [0, 360).
 */
export declare function lerpHue(from: number, to: number, t: number): number;
/**
 * Hue blend factor per frame: frame-rate independent approach toward the
 * target (1 - exp(-k·dt)).
 * @param dtSeconds - seconds since the previous frame.
 * @param speed - blend speed constant (higher = snappier).
 * @returns the 0..1 factor.
 */
export declare function frameBlend(dtSeconds: number, speed?: number): number;
