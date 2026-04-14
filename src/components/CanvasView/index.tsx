import { useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTrackStore } from '../../store/useTrackStore';
import { PaperEngine } from '../../core/graphics/PaperEngine';
import { GsapController } from '../../core/animation/GsapController';
import { setInstances, getEngine, getController } from '../../core/instances';
import './CanvasView.css';

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PaperEngine | null>(null);

  const resolution = useProjectStore(s => s.resolution);
  const appMode = useProjectStore(s => s.appMode);
  const drawingTrackId = useProjectStore(s => s.drawingTrackId);
  const currentTime = useProjectStore(s => s.currentTime);
  const { addKeyframe, setActiveTrack } = useTrackStore();
  const { setDrawingTrackId, setAppMode } = useProjectStore();

  const past   = useTrackStore(s => s.past);
  const future = useTrackStore(s => s.future);

  // ── Bootstrap engine once ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || engineRef.current) return;

    const engine = new PaperEngine(canvas);
    const controller = new GsapController(engine);
    setInstances(engine, controller, {} as never);
    engineRef.current = engine;

    return () => {
      engine.destroy();
      controller.destroy();
      engineRef.current = null;
    };
  }, []);

  // ── Handle resize ───────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    if (!container || !engine) return;

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Activate drawing when requested ────────────────────────────────────
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (appMode === 'drawing' && drawingTrackId) {
      engine.startDrawing(drawingTrackId, (trackId, points) => {
        addKeyframe(trackId, currentTime, points);
        setActiveTrack(trackId);
        setDrawingTrackId(null);
        setAppMode('idle');
        engine.renderAtTime(currentTime);
      });
    } else if (appMode !== 'drawing') {
      engine.cancelDrawing();
    }
  }, [appMode, drawingTrackId, currentTime, addKeyframe, setActiveTrack, setDrawingTrackId, setAppMode]);

  const handleResetView = useCallback(() => {
    try { getEngine().resetView(); } catch { /* engine not ready */ }
  }, []);

  const handleUndo = useCallback(() => {
    useTrackStore.getState().undo();
  }, []);

  const handleRedo = useCallback(() => {
    useTrackStore.getState().redo();
  }, []);

  const handlePreview = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      await container.requestFullscreen();
      getController().seekTo(0);
      getController().play();
    } catch { /* fullscreen denied or not supported */ }
  }, []);

  return (
    <div ref={containerRef} className="canvas-view">
      <canvas
        ref={canvasRef}
        width={resolution.w}
        height={resolution.h}
        className="canvas-view__canvas"
      />
      <div className="canvas-view__overlay">
        <button
          className="canvas-view__overlay-btn"
          onClick={handleUndo}
          disabled={past.length === 0}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="canvas-view__overlay-btn"
          onClick={handleRedo}
          disabled={future.length === 0}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↪ Redo
        </button>
        <button
          className="canvas-view__overlay-btn"
          onClick={handleResetView}
          title="Reset pan and zoom"
        >
          Reset View
        </button>
        <button
          className="canvas-view__overlay-btn canvas-view__overlay-btn--primary"
          onClick={handlePreview}
          title="Preview animation fullscreen"
        >
          ▶ Preview
        </button>
      </div>
      {appMode === 'drawing' && (
        <div className="canvas-view__hint">
          Click to place vertices &nbsp;·&nbsp; Enter to finish &nbsp;·&nbsp; Esc to cancel
        </div>
      )}
    </div>
  );
}
