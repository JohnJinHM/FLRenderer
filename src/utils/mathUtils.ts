import type { Interpolation, Point } from '../types';

/** Linear interpolation between two scalar values. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear interpolation between two point arrays.
 *  If lengths differ the shorter array is padded by repeating its last point,
 *  so extra vertices animate smoothly in/out from the tail of the frontline. */
export function lerpPoints(from: Point[], to: Point[], t: number): Point[] {
  const maxLen = Math.max(from.length, to.length);
  return Array.from({ length: maxLen }, (_, i) => {
    const a = from[Math.min(i, from.length - 1)];
    const b = to[Math.min(i, to.length - 1)];
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  });
}

/** Interpolate two CSS hex colors (#rrggbb). */
export function lerpColor(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  const r = Math.round(lerp(r1, r2, t) * 255);
  const g = Math.round(lerp(g1, g2, t) * 255);
  const b = Math.round(lerp(b1, b2, t) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Finds the two keyframes that bracket `time` and returns the
 *  interpolated t-value and their indices. Returns null before first keyframe. */
export function findBracketingKeyframes<T extends { time: number }>(
  keyframes: T[],
  time: number,
): { kf1: T; kf2: T; t: number } | { kf1: T; kf2: null; t: 0 } | null {
  if (keyframes.length === 0) return null;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) return { kf1: sorted[0], kf2: null, t: 0 };
  if (time >= sorted[sorted.length - 1].time)
    return { kf1: sorted[sorted.length - 1], kf2: null, t: 0 };

  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      const span = sorted[i + 1].time - sorted[i].time;
      const t = span === 0 ? 0 : (time - sorted[i].time) / span;
      return { kf1: sorted[i], kf2: sorted[i + 1], t };
    }
  }

  return null;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Apply an easing curve to a normalised time value t ∈ [0, 1].
 * The interpolation is the method set on kf1 (the "leaving" keyframe).
 *   hold        – hold kf1 values until the instant kf2 is reached
 *   linear      – uniform rate
 *   ease-in     – starts slow, ends fast  (cubic)
 *   ease-out    – starts fast, ends slow  (cubic)
 *   ease-in-out – slow at both ends       (cubic)
 */
export function applyEasing(t: number, interp: Interpolation): number {
  switch (interp) {
    case 'hold':        return 0;
    case 'linear':      return t;
    case 'ease-in':     return t * t * t;
    case 'ease-out':    return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out': return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

/** Convert hex color string (#rrggbb or #rgb) to [r, g, b] 0..1 components. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const val = parseInt(full, 16);
  return [(val >> 16) / 255, ((val >> 8) & 0xff) / 255, (val & 0xff) / 255];
}
