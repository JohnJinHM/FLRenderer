import { useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTrackStore } from '../../store/useTrackStore';
import { PaperEngine } from '../../core/graphics/PaperEngine';
import { GsapController } from '../../core/animation/GsapController';
import { VideoRenderer } from '../../core/exporter/VideoRenderer';
import { setInstances, getEngine } from '../../core/instances';
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

  // ── Bootstrap engine once ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || engineRef.current) return;

    const engine = new PaperEngine(canvas);
    const controller = new GsapController(engine);
    const renderer = new VideoRenderer(engine, controller);
    setInstances(engine, controller, renderer);
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

  return (
    <div ref={containerRef} className="canvas-view">
      <canvas
        ref={canvasRef}
        width={resolution.w}
        height={resolution.h}
        className="canvas-view__canvas"
      />
      <button
        className="canvas-view__reset-view"
        onClick={handleResetView}
        title="Reset pan and zoom"
      >
        Reset View
      </button>
      {appMode === 'drawing' && (
        <div className="canvas-view__hint">
          Click to place vertices &nbsp;·&nbsp; Enter to finish &nbsp;·&nbsp; Esc to cancel
        </div>
      )}
    </div>
  );
}
