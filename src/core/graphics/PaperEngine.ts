import paper from 'paper';
import { useProjectStore } from '../../store/useProjectStore';
import { useTrackStore } from '../../store/useTrackStore';
import { Frontline } from './Frontline';
import { findBracketingKeyframes, lerpPoints, lerp, lerpColor, clamp, applyEasing } from '../../utils/mathUtils';
import type { Point, Track, Keyframe } from '../../types';

type DrawFinishedCallback = (trackId: string, points: Point[]) => void;

interface EditKeyframeSnapshot {
  trackId: string;
  keyframeId: string;
  points: Point[];
  color: string;
  outlineWidth: number;
  fillOpacity: number;
}

export class PaperEngine {
  readonly canvas: HTMLCanvasElement;
  readonly scope: paper.PaperScope;

  private backgroundLayer!: paper.Layer;
  private frontlineLayer!: paper.Layer;
  private editLayer!: paper.Layer;
  private drawingLayer!: paper.Layer;

  private mapRaster: paper.Raster | null = null;
  private frontlines = new Map<string, Frontline>();

  // Drawing state
  private drawingPoints: paper.Point[] = [];
  private drawingCursorPath: paper.Path | null = null;
  private activeTool!: paper.Tool;
  private isDrawing = false;
  private activeDrawingTrackId: string | null = null;
  private onDrawFinished: DrawFinishedCallback | null = null;

  // Edit-dot (vertex moving) state
  private editDots: paper.Shape.Circle[] = [];
  private editKeyframe: EditKeyframeSnapshot | null = null;
  private dragDotIndex = -1;

  // Pan state
  private isPanning = false;
  private panLastClient = { x: 0, y: 0 };

  // Store subscriptions
  private unsubProject: (() => void) | null = null;
  private unsubTracks: (() => void) | null = null;
  private unsubActiveTrack: (() => void) | null = null;
  private unsubCurrentTime: (() => void) | null = null;
  private unsubAppMode: (() => void) | null = null;
  private currentMapUrl: string | null = null;

  // Native event handlers stored as arrows for correct removal
  private readonly _onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.scope.activate();
    const view = this.scope.view;
    const oldCenter = view.viewToProject(new paper.Point(e.offsetX, e.offsetY));
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.1, Math.min(50, view.zoom * factor));
    view.zoom = newZoom;
    // Keep the cursor point stationary
    const newCenter = view.viewToProject(new paper.Point(e.offsetX, e.offsetY));
    view.center = view.center.add(oldCenter.subtract(newCenter));
    view.update();
  };

  private readonly _onPanMouseDown = (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    this.isPanning = true;
    this.panLastClient = { x: e.clientX, y: e.clientY };
    this.canvas.style.cursor = 'grabbing';
  };

  private readonly _onPanMouseMove = (e: MouseEvent) => {
    if (!this.isPanning) return;
    this.scope.activate();
    const view = this.scope.view;
    const dx = e.clientX - this.panLastClient.x;
    const dy = e.clientY - this.panLastClient.y;
    this.panLastClient = { x: e.clientX, y: e.clientY };
    // Convert pixel delta to project coordinates
    const delta = new paper.Point(dx, dy).divide(view.zoom);
    view.center = view.center.subtract(delta);
    view.update();
  };

  private readonly _onPanMouseUp = (e: MouseEvent) => {
    if (e.button !== 1) return;
    this.isPanning = false;
    // Restore cursor based on current mode
    this._restoreCursor();
  };

  // Prevent middle-click scroll/autoscroll browser behaviour
  private readonly _onAuxClick = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  // Double-click: delete vertex (on dot) or insert vertex (on line segment)
  private readonly _onDblClick = (e: MouseEvent) => {
    if (this.isDrawing) return;
    if (!this.editKeyframe) return;

    // Cancel any drag that was set by the second mousedown of the double-click
    this.dragDotIndex = -1;

    this.scope.activate();
    const pt = this.scope.view.viewToProject(new paper.Point(e.offsetX, e.offsetY));

    // ── Delete vertex ────────────────────────────────────────────────────
    const dotIdx = this.findDotIndex(pt);
    if (dotIdx !== -1) {
      if (this.editKeyframe.points.length <= 2) return; // need at least 2
      this.editKeyframe.points.splice(dotIdx, 1);
      this._commitEditPoints();
      return;
    }

    // ── Insert vertex on nearest segment ─────────────────────────────────
    const seg = this.findNearestSegment(pt);
    if (seg !== null) {
      this.editKeyframe.points.splice(seg.insertAt, 0, { x: pt.x, y: pt.y });
      this._commitEditPoints();
    }
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scope = new paper.PaperScope();
    this.scope.setup(canvas);
    this.initLayers();
    this.initTool();
    this.initPanZoom();
    this.subscribeStores();
  }

  // ─── Initialisation ──────────────────────────────────────────────────────

  private initLayers(): void {
    this.scope.activate();
    this.backgroundLayer = new paper.Layer();
    this.backgroundLayer.name = 'background';

    this.frontlineLayer = new paper.Layer();
    this.frontlineLayer.name = 'frontlines';

    this.editLayer = new paper.Layer();
    this.editLayer.name = 'edit';

    this.drawingLayer = new paper.Layer();
    this.drawingLayer.name = 'drawing';
  }

  private initTool(): void {
    this.scope.activate();
    const tool = new paper.Tool();
    tool.minDistance = 0;

    tool.onMouseDown = (e: paper.ToolEvent) => {
      // Only left button drives drawing / dot selection
      // if ((e.event as MouseEvent).button !== 0) return;

      if (this.isDrawing) {
        this.addDrawingPoint(e.point);
        return;
      }

      // Dot hit test for vertex moving
      const idx = this.findDotIndex(e.point);
      if (idx !== -1) {
        this.dragDotIndex = idx;
        this.canvas.style.cursor = 'grabbing';
      }
    };

    tool.onMouseDrag = (e: paper.ToolEvent) => {
      if (this.isPanning) return;
      if (this.dragDotIndex !== -1) {
        this.moveDot(this.dragDotIndex, e.point);
      }
    };

    tool.onMouseUp = (_e: paper.ToolEvent) => {
      if (this.dragDotIndex !== -1) {
        this.commitDotMove();
        this.dragDotIndex = -1;
        this._restoreCursor();
      }
    };

    tool.onMouseMove = (e: paper.ToolEvent) => {
      if (this.isDrawing) {
        this.updateCursor(e.point);
        return;
      }
      if (this.findDotIndex(e.point) !== -1) {
        // Over an existing vertex — grab to move, double-click to delete
        this.canvas.style.cursor = 'grab';
      } else if (this.findNearestSegment(e.point) !== null) {
        // Over a line segment — double-click to insert a vertex
        this.canvas.style.cursor = 'cell';
      } else {
        this.canvas.style.cursor = 'default';
      }
    };

    tool.onKeyDown = (e: paper.KeyEvent) => {
      if (e.key === 'escape' && this.isDrawing) {
        this.cancelDrawing();
      }
      if (e.key === 'enter' && this.isDrawing) {
        this.finishDrawing();
      }
    };

    this.activeTool = tool;
    tool.activate();
  }

  private initPanZoom(): void {
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('mousedown', this._onPanMouseDown);
    this.canvas.addEventListener('auxclick', this._onAuxClick);
    this.canvas.addEventListener('dblclick', this._onDblClick);
    // Pan move/up must be on window so dragging outside canvas works
    window.addEventListener('mousemove', this._onPanMouseMove);
    window.addEventListener('mouseup', this._onPanMouseUp);
  }

  private subscribeStores(): void {
    this.unsubProject = useProjectStore.subscribe(
      s => s.mapImageUrl,
      url => {
        if (url !== this.currentMapUrl) {
          this.currentMapUrl = url;
          this.loadMap(url);
        }
      },
      { fireImmediately: true },
    );

    this.unsubTracks = useTrackStore.subscribe(
      s => s.tracks,
      tracks => this.syncTracks(tracks),
      { fireImmediately: true },
    );

    this.unsubActiveTrack = useTrackStore.subscribe(
      s => s.activeTrackId,
      () => this.refreshEditDots(),
    );

    this.unsubCurrentTime = useProjectStore.subscribe(
      s => s.currentTime,
      () => this.refreshEditDots(),
    );

    this.unsubAppMode = useProjectStore.subscribe(
      s => s.appMode,
      () => this.refreshEditDots(),
    );
  }

  // ─── Map ─────────────────────────────────────────────────────────────────

  private loadMap(url: string | null): void {
    this.scope.activate();
    this.backgroundLayer.activate();

    if (this.mapRaster) {
      this.mapRaster.remove();
      this.mapRaster = null;
    }

    if (!url) {
      this.scope.view.update();
      return;
    }

    const raster = new paper.Raster(url);
    raster.onLoad = () => {
      this.scope.activate();
      const vSize = this.scope.view.size;
      // Fit raster to canvas while preserving aspect ratio
      const scale = Math.min(
        vSize.width / raster.width,
        vSize.height / raster.height,
      );
      raster.scale(scale);
      raster.position = this.scope.view.center;
      this.scope.view.update();
    };
    this.mapRaster = raster;
  }

  // ─── Track sync ──────────────────────────────────────────────────────────

  private syncTracks(tracks: Track[]): void {
    this.scope.activate();
    const incomingIds = new Set(tracks.map(t => t.id));

    // Collect deletions first to avoid mutating the map during iteration
    const toDelete: string[] = [];
    for (const [id] of this.frontlines) {
      if (!incomingIds.has(id)) toDelete.push(id);
    }

    for (const id of toDelete) {
      this.frontlines.get(id)!.remove();
      this.frontlines.delete(id);

      // If the track being drawn was just deleted, clean up the Paper.js
      // drawing layer.  Do NOT mutate the project store here — that would be a
      // store write inside a Zustand subscription, which runs re-entrant against
      // React's own reconciliation of the same state change.  The UI layer
      // (PropertiesPanel / MapUploader) is responsible for resetting appMode and
      // drawingTrackId before calling removeTrack / clearAll.
      if (this.activeDrawingTrackId === id) {
        this.cancelDrawing();
      }
    }

    // Add entries for brand-new tracks
    for (const track of tracks) {
      if (!this.frontlines.has(track.id)) {
        this.frontlines.set(track.id, new Frontline(track.id, this.scope, this.frontlineLayer));
      }
    }

    this.refreshEditDots();

    // Re-render canvas whenever track data changes (covers keyframe moves,
    // style edits, and point updates made from outside the engine).
    const { currentTime } = useProjectStore.getState();
    this.renderAtTime(currentTime);
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  /** Render all tracks interpolated at the given time (ms). */
  renderAtTime(timeMs: number): void {
    this.scope.activate();
    const { tracks } = useTrackStore.getState();

    for (const track of tracks) {
      this.renderTrack(track, timeMs);
    }

    this.scope.view.update();
  }

  private renderTrack(track: Track, timeMs: number): void {
    const fl = this.frontlines.get(track.id);
    if (!fl) return;

    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
    if (sorted.length === 0) {
      // No keyframes yet — nothing to render. Do NOT call fl.remove() here:
      // that would null out internal path references on a still-live Frontline,
      // causing every subsequent render() call to fail to clean up its old paths.
      return;
    }

    const bracket = findBracketingKeyframes(sorted, timeMs);
    if (!bracket) return;

    let points: Point[];
    let style: Pick<Keyframe, 'color' | 'outlineWidth' | 'fillOpacity'>;

    if (!bracket.kf2) {
      points = bracket.kf1.points;
      style = bracket.kf1;
    } else {
      // Apply the easing curve defined on the departing keyframe
      const et = applyEasing(bracket.t, bracket.kf1.interpolation ?? 'linear');
      points = lerpPoints(bracket.kf1.points, bracket.kf2.points, et);
      style = {
        color:        lerpColor(bracket.kf1.color, bracket.kf2.color, et),
        outlineWidth: lerp(bracket.kf1.outlineWidth, bracket.kf2.outlineWidth, et),
        fillOpacity:  lerp(bracket.kf1.fillOpacity,  bracket.kf2.fillOpacity,  et),
      };
    }

    fl.render(points, style);
  }

  // ─── Edit dots (vertex moving) ────────────────────────────────────────────

  /** Show interactive vertex dots for the active track's nearest keyframe. */
  refreshEditDots(): void {
    const { appMode } = useProjectStore.getState();

    // Don't show edit dots while drawing or playing/exporting
    if (appMode !== 'idle') {
      this.clearEditDots();
      return;
    }

    const { activeTrackId, tracks } = useTrackStore.getState();
    if (!activeTrackId) {
      this.clearEditDots();
      return;
    }

    const track = tracks.find(t => t.id === activeTrackId);
    if (!track || track.keyframes.length === 0) {
      this.clearEditDots();
      return;
    }

    const { currentTime } = useProjectStore.getState();
    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
    const bracket = findBracketingKeyframes(sorted, currentTime);

    let kf: Keyframe;
    if (!bracket) {
      kf = sorted[0];
    } else if (!bracket.kf2) {
      kf = bracket.kf1;
    } else {
      // Pick whichever keyframe is closer in time
      kf = Math.abs(bracket.kf1.time - currentTime) <= Math.abs(bracket.kf2.time - currentTime)
        ? bracket.kf1
        : bracket.kf2;
    }

    // Snapshot for live editing
    this.editKeyframe = {
      trackId: track.id,
      keyframeId: kf.id,
      points: kf.points.map(p => ({ ...p })),
      color: kf.color,
      outlineWidth: kf.outlineWidth,
      fillOpacity: kf.fillOpacity,
    };

    this.buildEditDots(this.editKeyframe.points, kf.color);
  }

  private buildEditDots(points: Point[], color: string): void {
    // Only remove the old dot visuals — do NOT null editKeyframe here.
    // clearEditDots() would null editKeyframe, breaking moveDot's guard.
    this.scope.activate();
    for (const dot of this.editDots) dot.remove();
    this.editDots = [];

    this.editLayer.activate();

    for (const p of points) {
      const dot = new paper.Shape.Circle(new paper.Point(p.x, p.y), 6);
      dot.fillColor = new paper.Color(color);
      dot.strokeColor = new paper.Color(1, 1, 1, 0.9);
      dot.strokeWidth = 1.5;
      this.editDots.push(dot);
    }

    this.scope.view.update();
  }

  /** Remove dot visuals AND clear the keyframe snapshot. */
  private clearEditDots(): void {
    this.scope.activate();
    for (const dot of this.editDots) dot.remove();
    this.editDots = [];
    this.editKeyframe = null;
    this.scope.view.update();
  }

  /** Returns the index of the dot under `point`, or -1. */
  private findDotIndex(point: paper.Point): number {
    if (!this.editKeyframe || this.editDots.length === 0) return -1;
    const hitRadius = 10 / this.scope.view.zoom;
    for (let i = 0; i < this.editKeyframe.points.length; i++) {
      const p = this.editKeyframe.points[i];
      if (Math.hypot(point.x - p.x, point.y - p.y) <= hitRadius) return i;
    }
    return -1;
  }

  /**
   * Returns `{ insertAt }` — the index at which a new point should be spliced —
   * when `point` is within hit-test distance of any line segment, or null.
   */
  private findNearestSegment(point: paper.Point): { insertAt: number } | null {
    if (!this.editKeyframe || this.editKeyframe.points.length < 2) return null;
    const hitRadius = 10 / this.scope.view.zoom;
    const pts = this.editKeyframe.points;

    let bestDist = Infinity;
    let bestInsertAt = -1;

    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x,     ay = pts[i].y;
      const bx = pts[i+1].x,   by = pts[i+1].y;
      const abx = bx - ax,     aby = by - ay;
      const len2 = abx * abx + aby * aby;

      let dist: number;
      if (len2 === 0) {
        dist = Math.hypot(point.x - ax, point.y - ay);
      } else {
        const t   = clamp(((point.x - ax) * abx + (point.y - ay) * aby) / len2, 0, 1);
        const px  = ax + t * abx;
        const py  = ay + t * aby;
        dist = Math.hypot(point.x - px, point.y - py);
      }

      if (dist < bestDist) {
        bestDist = dist;
        bestInsertAt = i + 1;
      }
    }

    return bestDist <= hitRadius ? { insertAt: bestInsertAt } : null;
  }

  /** Save the current editKeyframe.points back to the store. */
  private _commitEditPoints(): void {
    if (!this.editKeyframe) return;
    const { trackId, keyframeId, points } = this.editKeyframe;
    useTrackStore.getState().updateKeyframe(trackId, keyframeId, {
      points: points.map(p => ({ ...p })),
    });
    // syncTracks subscription re-renders and rebuilds the edit dots automatically.
  }

  /** Moves the dot at `index` to `point` and live-renders the frontline. */
  private moveDot(index: number, point: paper.Point): void {
    if (!this.editKeyframe) return;

    // Update the in-memory snapshot first
    this.editKeyframe.points[index] = { x: point.x, y: point.y };

    // Rebuild dot visuals at the updated positions (avoids position-setter
    // fragility with paper.js scoped instances).
    this.buildEditDots(this.editKeyframe.points, this.editKeyframe.color);

    // Live-render the frontline with the dragged points
    const fl = this.frontlines.get(this.editKeyframe.trackId);
    if (fl) {
      fl.render(this.editKeyframe.points, this.editKeyframe);
    }

    this.scope.view.update();
  }

  /** Saves the dragged points back to the track store. */
  private commitDotMove(): void {
    if (!this.editKeyframe) return;
    const { trackId, keyframeId, points, color, outlineWidth, fillOpacity } = this.editKeyframe;
    const { currentTime } = useProjectStore.getState();
    const store = useTrackStore.getState();
    const isRecording = store.recordingTrackIds.includes(trackId);

    if (isRecording) {
      // Find a keyframe that sits exactly at the current playhead position.
      const track = store.tracks.find(t => t.id === trackId);
      const exactKf = track?.keyframes.find(kf => kf.time === currentTime);
      if (exactKf) {
        store.updateKeyframe(trackId, exactKf.id, { points: points.map(p => ({ ...p })) });
      } else {
        // Create a new keyframe at the playhead, carrying the dragged points
        // and the style of the nearest keyframe we were editing.
        store.addKeyframe(trackId, currentTime, points.map(p => ({ ...p })), {
          color, outlineWidth, fillOpacity,
        });
      }
    } else {
      store.updateKeyframe(trackId, keyframeId, { points: points.map(p => ({ ...p })) });
    }

    // syncTracks subscription will re-render; explicit call keeps it crisp.
    this.renderAtTime(currentTime);
  }

  // ─── Drawing interaction ─────────────────────────────────────────────────

  startDrawing(trackId: string, callback: DrawFinishedCallback): void {
    this.cancelDrawing();
    this.isDrawing = true;
    this.activeDrawingTrackId = trackId;
    this.onDrawFinished = callback;
    this.drawingPoints = [];
    this.clearEditDots();
    this.scope.activate();
    this.drawingLayer.activate();
    this.activeTool.activate();
    this.canvas.style.cursor = 'crosshair';
  }

  cancelDrawing(): void {
    this.isDrawing = false;
    this.activeDrawingTrackId = null;
    this.onDrawFinished = null;   // clear stale callback so it can never fire late
    this.drawingPoints = [];
    this.scope.activate();
    // Remove every item in the drawing layer (path, dots, cursor line)
    this.drawingLayer.removeChildren();
    this.drawingCursorPath = null;
    this.canvas.style.cursor = 'default';
    this.scope.view.update();
  }

  private addDrawingPoint(point: paper.Point): void {
    this.drawingPoints.push(point.clone());
    this.redrawPreview();
  }

  private redrawPreview(): void {
    this.scope.activate();
    this.drawingLayer.activate();

    // Clear all drawing-layer children: old path, all accumulated dots, and
    // the cursor line.  Without this, dots are re-created on every point
    // addition and never cleaned up, causing ghost objects and instability.
    this.drawingLayer.removeChildren();
    this.drawingCursorPath = null;

    if (this.drawingPoints.length < 1) return;

    const path = new paper.Path();
    for (const p of this.drawingPoints) path.add(p);
    path.strokeColor = new paper.Color(1, 0.8, 0.2, 0.9);
    path.strokeWidth = 2;
    path.dashArray = [6, 4];
    path.fillColor = new paper.Color(1, 0.8, 0.2, 0.1);

    // Dot for each vertex — created once per redraw, all owned by drawingLayer
    for (const p of this.drawingPoints) {
      const dot = new paper.Shape.Circle(p, 4);
      dot.fillColor = new paper.Color(1, 0.8, 0.2, 1);
      dot.strokeColor = new paper.Color(0, 0, 0, 0.5);
      dot.strokeWidth = 1;
    }

    this.scope.view.update();
  }

  private updateCursor(point: paper.Point): void {
    this.scope.activate();
    // Must activate drawingLayer before creating any new path, otherwise the
    // cursor line lands in whatever layer was last active (e.g. frontlineLayer
    // after a renderTrack call), where removeChildren() can never reach it.
    this.drawingLayer.activate();
    this.drawingCursorPath?.remove();

    if (this.drawingPoints.length > 0) {
      const line = new paper.Path();
      line.add(this.drawingPoints[this.drawingPoints.length - 1]);
      line.add(point);
      line.strokeColor = new paper.Color(1, 0.8, 0.2, 0.4);
      line.strokeWidth = 1.5;
      line.dashArray = [4, 4];
      this.drawingCursorPath = line;
    }

    this.scope.view.update();
  }

  private finishDrawing(): void {
    if (this.drawingPoints.length < 2) {
      this.cancelDrawing();
      return;
    }

    const points: Point[] = this.drawingPoints.map(p => ({ x: p.x, y: p.y }));
    const trackId = this.activeDrawingTrackId!;
    const cb = this.onDrawFinished;
    this.cancelDrawing();
    cb?.(trackId, points);
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  /** Force a full redraw at the current store time. */
  refresh(): void {
    const { currentTime } = useProjectStore.getState();
    this.renderAtTime(currentTime);
    this.refreshEditDots();
  }

  resize(): void {
    this.scope.view.update();
    this.refresh();
  }

  /** Reset pan and zoom to the default view. */
  resetView(): void {
    this.scope.activate();
    this.scope.view.zoom = 1;
    this.scope.view.center = new paper.Point(
      this.canvas.width / 2,
      this.canvas.height / 2,
    );
    this.scope.view.update();
  }

  private _restoreCursor(): void {
    if (this.isDrawing) {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('mousedown', this._onPanMouseDown);
    this.canvas.removeEventListener('auxclick', this._onAuxClick);
    this.canvas.removeEventListener('dblclick', this._onDblClick);
    window.removeEventListener('mousemove', this._onPanMouseMove);
    window.removeEventListener('mouseup', this._onPanMouseUp);

    this.unsubProject?.();
    this.unsubTracks?.();
    this.unsubActiveTrack?.();
    this.unsubCurrentTime?.();
    this.unsubAppMode?.();

    this.cancelDrawing();
    this.clearEditDots();
    for (const fl of this.frontlines.values()) fl.remove();
    this.frontlines.clear();
  }
}
