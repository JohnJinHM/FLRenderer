import type { Point, Keyframe } from '../../types';
import { hexToRgb } from '../../utils/mathUtils';

/** Manages the Paper.js visual representation of one frontline track.
 *  Each Frontline owns two paths: a territory-fill mask and a glowing stroke. */
export class Frontline {
  private scope: paper.PaperScope;
  private layer: paper.Layer;
  private maskPath: paper.Path | null = null;
  private strokePath: paper.Path | null = null;
  readonly trackId: string;

  constructor(trackId: string, scope: paper.PaperScope, layer: paper.Layer) {
    this.trackId = trackId;
    this.scope = scope;
    this.layer = layer;
  }

  /** Render this frontline at a specific interpolated state. */
  render(points: Point[], keyframe: Pick<Keyframe, 'color' | 'outlineWidth' | 'fillOpacity' | 'glowWidth'>): void {
    if (points.length < 2) return;

    this.scope.activate();
    this.layer.activate();

    const [r, g, b] = hexToRgb(keyframe.color);

    // Remove old paths
    this.maskPath?.remove();
    this.strokePath?.remove();

    // --- Territory fill (closed, semi-transparent) ---
    const mask = new this.scope.Path();
    for (const p of points) mask.add(new this.scope.Point(p.x, p.y));
    mask.closed = true;
    if (points.length >= 3) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mask.smooth({ type: 'catmull-rom', factor: 0.4 } as any);
    }
    mask.fillColor = new this.scope.Color(r, g, b, keyframe.fillOpacity);
    mask.strokeColor = null;
    this.maskPath = mask;

    // --- Frontline stroke (glowing edge) ---
    const stroke = mask.clone() as paper.Path;
    stroke.fillColor = null;
    stroke.strokeColor = new this.scope.Color(r, g, b, 0.9);
    stroke.strokeWidth = keyframe.outlineWidth;
    stroke.strokeCap = 'round';
    stroke.strokeJoin = 'round';
    // Glow via shadow
    stroke.shadowColor = new this.scope.Color(r, g, b, 0.7);
    stroke.shadowBlur = keyframe.glowWidth;
    stroke.shadowOffset = new this.scope.Point(0, 0);
    this.strokePath = stroke;
  }

  /** Remove this frontline from the canvas. */
  remove(): void {
    this.maskPath?.remove();
    this.strokePath?.remove();
    this.maskPath = null;
    this.strokePath = null;
  }

  setVisible(visible: boolean): void {
    if (this.maskPath) this.maskPath.visible = visible;
    if (this.strokePath) this.strokePath.visible = visible;
  }
}
