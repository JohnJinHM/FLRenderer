import { useRef, useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTrackStore } from '../../store/useTrackStore';
import { getController } from '../../core/instances';
import { clamp } from '../../utils/mathUtils';
import './Timeline.css';

// ── Constants ──────────────────────────────────────────────────────────────

const ZOOM_MIN_MS = 1_000;   // 1 second
const ZOOM_MAX_MS = 60_000;  // 1 minute

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function formatVisibleMs(ms: number): string {
  if (ms >= 60_000) return '1 min';
  const s = ms / 1000;
  return s % 1 === 0 ? `${s}s` : `${s.toFixed(1)}s`;
}

/** Ruler tick spacing in ms for a given visible range. */
function rulerStepMs(visibleMs: number): number {
  if (visibleMs <= 2_000)  return 200;
  if (visibleMs <= 5_000)  return 500;
  if (visibleMs <= 15_000) return 1_000;
  if (visibleMs <= 30_000) return 2_000;
  return 5_000;
}

function formatRulerLabel(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return s % 1 === 0 ? `${s}s` : `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec === 0 ? `${m}m` : `${m}:${String(Math.round(sec)).padStart(2, '0')}`;
}

interface KfDrag {
  trackId: string;
  keyframeId: string;
  startX: number;
  startTime: number;
  moved: boolean;
  isAlt: boolean;
  duplicated: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function Timeline() {
  const railRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const kfDrag = useRef<KfDrag | null>(null);

  const currentTime = useProjectStore(s => s.currentTime);
  const duration = useProjectStore(s => s.duration);
  const appMode = useProjectStore(s => s.appMode);
  const { setCurrentTime, setDuration } = useProjectStore();

  const tracks = useTrackStore(s => s.tracks);
  const activeTrackId = useTrackStore(s => s.activeTrackId);
  const recordingTrackIds = useTrackStore(s => s.recordingTrackIds);
  const { setActiveTrack, removeKeyframe, moveKeyframe, addKeyframe, toggleRecording } = useTrackStore();

  const isPlaying = appMode === 'playing';

  // ── Zoom / pan state ───────────────────────────────────────────────────
  // visibleMs = how many milliseconds fit in the rail width
  // viewStart = ms offset of the left edge
  const [visibleMs, setVisibleMs] = useState<number>(() =>
    Math.min(ZOOM_MAX_MS, useProjectStore.getState().duration),
  );
  const [viewStart, setViewStart] = useState(0);

  // Refs give event handlers stable, always-current values without
  // requiring them to be re-registered on every state change.
  const visibleMsRef  = useRef(visibleMs);
  const viewStartRef  = useRef(viewStart);
  const durationRef   = useRef(duration);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => { visibleMsRef.current  = visibleMs;   }, [visibleMs]);
  useEffect(() => { viewStartRef.current  = viewStart;   }, [viewStart]);
  useEffect(() => { durationRef.current   = duration;    }, [duration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  // When total duration changes, clamp the current view so nothing goes out of bounds.
  useEffect(() => {
    setVisibleMs(prev => {
      const v = clamp(prev, ZOOM_MIN_MS, Math.min(ZOOM_MAX_MS, duration));
      visibleMsRef.current = v;
      return v;
    });
    setViewStart(prev => {
      const max = Math.max(0, duration - visibleMsRef.current);
      const s = clamp(prev, 0, max);
      viewStartRef.current = s;
      return s;
    });
  }, [duration]);

  /** Apply a new visible window, clamping to legal bounds. */
  const applyView = useCallback((newStart: number, newVisible: number) => {
    const dur  = durationRef.current;
    const v    = clamp(newVisible, ZOOM_MIN_MS, Math.min(ZOOM_MAX_MS, dur));
    const s    = clamp(newStart,   0, Math.max(0, dur - v));
    visibleMsRef.current = v;
    viewStartRef.current = s;
    setVisibleMs(v);
    setViewStart(s);
  }, []);

  // ── Wheel: zoom (plain scroll) / pan (shift+scroll or trackpad X) ──────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const visible = visibleMsRef.current;
    const start   = viewStartRef.current;
    const dur     = durationRef.current;
    const rail    = railRef.current;
    if (!rail) return;

    const isPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);

    if (isPan) {
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const panMs = (delta / rail.clientWidth) * visible;
      applyView(start + panMs, visible);
      return;
    }

    // Zoom: keep the time under the cursor stationary
    const { left, width } = rail.getBoundingClientRect();
    const ratio      = clamp((e.clientX - left) / width, 0, 1);
    const cursorTime = start + ratio * visible;
    const factor     = e.deltaY > 0 ? 1.3 : 1 / 1.3;
    const newVisible = clamp(visible * factor, ZOOM_MIN_MS, Math.min(ZOOM_MAX_MS, dur));
    applyView(cursorTime - ratio * newVisible, newVisible);
  }, [applyView]); // applyView is stable; reads state via refs

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    rail.addEventListener('wheel', handleWheel, { passive: false });
    return () => rail.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Coordinate helpers using refs (stable across renders) ──────────────
  const pixelToTime = useCallback((clientX: number): number => {
    const rail = railRef.current;
    if (!rail) return 0;
    const { left, width } = rail.getBoundingClientRect();
    const ratio = clamp((clientX - left) / width, 0, 1);
    return viewStartRef.current + ratio * visibleMsRef.current;
  }, []);

  const seekToPixel = useCallback((clientX: number) => {
    const time = pixelToTime(clientX);
    try { getController().seekTo(time); } catch { setCurrentTime(time); }
  }, [pixelToTime, setCurrentTime]);

  const handleRailMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    seekToPixel(e.clientX);
  }, [seekToPixel]);

  // ── Unified window mouse handler (playhead drag + kf drag) ─────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (kfDrag.current) {
        const dx = Math.abs(e.clientX - kfDrag.current.startX);
        if (dx > 3) kfDrag.current.moved = true;

        if (kfDrag.current.moved) {
          let t = clamp(pixelToTime(e.clientX), 0, durationRef.current);

          // Snap to playhead when within 8 screen pixels
          const rail = railRef.current;
          if (rail) {
            const snapThreshMs = (8 / rail.clientWidth) * visibleMsRef.current;
            if (Math.abs(t - currentTimeRef.current) < snapThreshMs) {
              t = currentTimeRef.current;
            }
          }

          // Alt+drag: duplicate the keyframe once on first move, then drag the copy
          if (kfDrag.current.isAlt && !kfDrag.current.duplicated) {
            const store = useTrackStore.getState();
            const track = store.tracks.find(tr => tr.id === kfDrag.current!.trackId);
            const srcKf = track?.keyframes.find(kf => kf.id === kfDrag.current!.keyframeId);
            if (srcKf) {
              const newKf = store.addKeyframe(
                kfDrag.current.trackId,
                t,
                srcKf.points.map(p => ({ ...p })),
                { color: srcKf.color, outlineWidth: srcKf.outlineWidth, fillOpacity: srcKf.fillOpacity, glowWidth: srcKf.glowWidth, interpolation: srcKf.interpolation },
              );
              kfDrag.current.keyframeId = newKf.id;
              kfDrag.current.startTime  = t;
              kfDrag.current.duplicated = true;
            }
          } else {
            moveKeyframe(kfDrag.current.trackId, kfDrag.current.keyframeId, t);
          }
        }
        return;
      }
      if (isDragging.current) seekToPixel(e.clientX);
    }

    function onUp() {
      if (kfDrag.current) {
        const drag = kfDrag.current;
        kfDrag.current = null;
        if (!drag.moved) {
          // Seek to keyframe time and select its track
          try { getController().seekTo(drag.startTime); }
          catch { setCurrentTime(drag.startTime); }
          setActiveTrack(drag.trackId);
        }
      }
      isDragging.current = false;
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [seekToPixel, pixelToTime, moveKeyframe, addKeyframe, setCurrentTime, setActiveTrack]);

  // ── Transport ──────────────────────────────────────────────────────────
  function handlePlay() {
    try {
      const ctrl = getController();
      if (isPlaying) ctrl.pause(); else ctrl.play();
    } catch { /* engine not ready */ }
  }

  function handleStop() {
    try { getController().seekTo(0); } catch { /* engine not ready */ }
  }

  function handleDurationChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value) * 1000;
    if (val > 0) setDuration(val);
  }

  function zoomStep(factor: number) {
    applyView(viewStartRef.current, visibleMsRef.current * factor);
  }

  /** Collect all unique keyframe times across every track, sorted ascending. */
  function allKeyframeTimes(): number[] {
    const set = new Set<number>();
    for (const track of tracks) {
      for (const kf of track.keyframes) set.add(kf.time);
    }
    return [...set].sort((a, b) => a - b);
  }

  function jumpPrev() {
    const times = allKeyframeTimes().filter(t => t < currentTime);
    if (times.length === 0) return;
    const t = times[times.length - 1];
    try { getController().seekTo(t); } catch { setCurrentTime(t); }
  }

  function jumpNext() {
    const times = allKeyframeTimes().filter(t => t > currentTime);
    if (times.length === 0) return;
    const t = times[0];
    try { getController().seekTo(t); } catch { setCurrentTime(t); }
  }

  // ── Derived display values ─────────────────────────────────────────────
  const viewEnd = viewStart + visibleMs;
  const playheadLeft = `${((currentTime - viewStart) / visibleMs) * 100}%`;

  return (
    <div className="timeline">
      {/* ── Transport bar ── */}
      <div className="timeline__transport">
        <button
          className={`timeline__btn ${isPlaying ? 'timeline__btn--active' : ''}`}
          onClick={handlePlay}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          className="timeline__btn"
          onClick={handleStop}
          title="Stop / Return to start"
        >
          ⏹
        </button>

        <button
          className="timeline__btn"
          onClick={jumpPrev}
          disabled={!allKeyframeTimes().some(t => t < currentTime)}
          title="Jump to previous keyframe"
        >
          ⏮
        </button>

        <button
          className="timeline__btn"
          onClick={jumpNext}
          disabled={!allKeyframeTimes().some(t => t > currentTime)}
          title="Jump to next keyframe"
        >
          ⏭
        </button>

        <span className="timeline__time">{formatTime(currentTime)}</span>
        <span className="timeline__separator">/</span>

        <label className="timeline__duration-label" title="Total duration (seconds)">
          <input
            className="timeline__duration-input"
            type="number"
            min={1}
            max={600}
            step={1}
            value={duration / 1000}
            onChange={handleDurationChange}
            disabled={isPlaying}
          />
          s
        </label>

        {/* Zoom controls */}
        <div className="timeline__zoom">
          <button
            className="timeline__zoom-btn"
            onClick={() => zoomStep(1 / 1.4)}
            title="Zoom in (scroll up on rail)"
            disabled={visibleMs <= ZOOM_MIN_MS}
          >+</button>
          <span className="timeline__zoom-label">{formatVisibleMs(visibleMs)}</span>
          <button
            className="timeline__zoom-btn"
            onClick={() => zoomStep(1.4)}
            title="Zoom out (scroll down on rail)"
            disabled={visibleMs >= Math.min(ZOOM_MAX_MS, duration)}
          >−</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="timeline__body">

        {/* Track labels — ruler spacer keeps them aligned with rail rows */}
        <div className="timeline__labels">
          <div className="timeline__ruler-spacer" />
          {tracks.map(track => {
            const isRecording = recordingTrackIds.includes(track.id);
            return (
              <div
                key={track.id}
                className={`timeline__track-label ${activeTrackId === track.id ? 'active' : ''}`}
                onClick={() => setActiveTrack(track.id)}
              >
                <span className="timeline__track-swatch" style={{ background: track.color }} />
                <span className="timeline__track-name">{track.name}</span>
                <button
                  className={`timeline__record-btn ${isRecording ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); toggleRecording(track.id); }}
                  title={isRecording
                    ? 'Auto-record on — vertex moves create/update keyframe at playhead'
                    : 'Auto-record off — click to enable'}
                >
                  ●
                </button>
              </div>
            );
          })}
          {tracks.length === 0 && (
            <div className="timeline__empty">No tracks yet</div>
          )}
        </div>

        {/* Rail area */}
        <div className="timeline__rail-area" ref={railRef} onMouseDown={handleRailMouseDown}>

          {/* Ruler — generated for the visible window only */}
          <TimelineRuler viewStart={viewStart} viewEnd={viewEnd} visibleMs={visibleMs} />

          {/* Track rows */}
          {tracks.map(track => (
            <div key={track.id} className="timeline__track-row">
              {track.keyframes.map(kf => {
                const left = `${((kf.time - viewStart) / visibleMs) * 100}%`;
                const isDraggingThis = kfDrag.current?.keyframeId === kf.id;
                return (
                  <div
                    key={kf.id}
                    className="timeline__kf-wrap"
                    style={{ left }}
                    onMouseDown={e => {
                      e.stopPropagation();
                      kfDrag.current = {
                        trackId: track.id,
                        keyframeId: kf.id,
                        startX: e.clientX,
                        startTime: kf.time,
                        moved: false,
                        isAlt: e.altKey,
                        duplicated: false,
                      };
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation();
                      removeKeyframe(track.id, kf.id);
                    }}
                    title={`${formatTime(kf.time)} · ${kf.points.length} pts\nDrag to move · Alt+drag to duplicate · double-click to delete`}
                  >
                    <div
                      className={`timeline__keyframe ${isDraggingThis ? 'dragging' : ''}`}
                      style={{ background: kf.color }}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          {/* Playhead */}
          <div className="timeline__playhead" style={{ left: playheadLeft }} />
        </div>
      </div>

      {/* ── Scroll / position strip ── */}
      <TimelineScrollbar
        duration={duration}
        viewStart={viewStart}
        visibleMs={visibleMs}
        onPan={delta => applyView(viewStart + delta, visibleMs)}
      />
    </div>
  );
}

// ── Ruler ──────────────────────────────────────────────────────────────────

function TimelineRuler({
  viewStart, viewEnd, visibleMs,
}: { viewStart: number; viewEnd: number; visibleMs: number }) {
  const step = rulerStepMs(visibleMs);
  const ticks: number[] = [];
  const first = Math.ceil(viewStart / step) * step;
  for (let ms = first; ms <= viewEnd; ms += step) ticks.push(ms);

  return (
    <div className="timeline__ruler">
      {ticks.map(ms => (
        <div
          key={ms}
          className="timeline__ruler-tick"
          style={{ left: `${((ms - viewStart) / visibleMs) * 100}%` }}
        >
          <span className="timeline__ruler-label">{formatRulerLabel(ms)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Scrollbar ──────────────────────────────────────────────────────────────

function TimelineScrollbar({
  duration, viewStart, visibleMs, onPan,
}: {
  duration: number;
  viewStart: number;
  visibleMs: number;
  onPan: (deltaMs: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const thumbDrag = useRef<{ startX: number; startViewStart: number } | null>(null);

  const thumbLeft  = duration > 0 ? (viewStart / duration) * 100 : 0;
  const thumbWidth = duration > 0 ? (Math.min(visibleMs, duration) / duration) * 100 : 100;

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!thumbDrag.current) return;
      const bar = barRef.current;
      if (!bar) return;
      const dx = e.clientX - thumbDrag.current.startX;
      const deltaMs = (dx / bar.clientWidth) * duration;
      onPan(thumbDrag.current.startViewStart + deltaMs - viewStart);
    }
    function onUp() { thumbDrag.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [duration, viewStart, onPan]);

  // Click on bar (not thumb) → center view on clicked position
  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const bar = barRef.current;
    if (!bar || thumbDrag.current) return;
    const { left, width } = bar.getBoundingClientRect();
    const ratio = clamp((e.clientX - left) / width, 0, 1);
    const targetStart = ratio * duration - visibleMs / 2;
    onPan(targetStart - viewStart);
  }

  return (
    <div
      ref={barRef}
      className="timeline__scrollbar"
      onClick={handleBarClick}
    >
      <div
        className="timeline__scrollbar-thumb"
        style={{ left: `${thumbLeft}%`, width: `${thumbWidth}%` }}
        onMouseDown={e => {
          e.stopPropagation();
          thumbDrag.current = { startX: e.clientX, startViewStart: viewStart };
        }}
      />
    </div>
  );
}
