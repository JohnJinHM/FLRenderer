import { useTrackStore } from '../../store/useTrackStore';
import { useProjectStore } from '../../store/useProjectStore';
import { getEngine } from '../../core/instances';
import { MapUploader } from '../MapUploader';
import type { Interpolation } from '../../types';
import './PropertiesPanel.css';

export function PropertiesPanel() {
  const tracks = useTrackStore(s => s.tracks);
  const activeTrackId = useTrackStore(s => s.activeTrackId);
  const { addTrack, removeTrack, setActiveTrack, updateKeyframe, updateTrackColor } =
    useTrackStore();
  const appMode = useProjectStore(s => s.appMode);
  const drawingTrackId = useProjectStore(s => s.drawingTrackId);
  const currentTime = useProjectStore(s => s.currentTime);
  const { setDrawingTrackId, setAppMode } = useProjectStore();

  const activeTrack = tracks.find(t => t.id === activeTrackId);
  const activeKeyframe = activeTrack?.keyframes.find(kf => kf.time === currentTime)
    ?? activeTrack?.keyframes[0];

  function handleRemoveTrack(trackId: string) {
    // If a drawing session is in progress, cancel it cleanly through the store
    // BEFORE removing the track.  This lets CanvasView's effect run cancelDrawing()
    // first, so the engine never sees a partially-torn-down drawing state.
    if (isDrawing) {
      setDrawingTrackId(null);
      setAppMode('idle');
    }
    removeTrack(trackId);
  }

  function handleAddTrack() {
    const track = addTrack();
    setActiveTrack(track.id);
    setDrawingTrackId(track.id);
    setAppMode('drawing');
  }

  function handleAddKeyframe() {
    if (!activeTrackId) return;
    setDrawingTrackId(activeTrackId);
    setAppMode('drawing');
  }

  function handleColorChange(color: string) {
    if (!activeTrackId || !activeKeyframe) return;
    updateKeyframe(activeTrackId, activeKeyframe.id, { color });
    // Keep the track swatch in sync with the edited keyframe's color
    updateTrackColor(activeTrackId, color);
    try { getEngine().refresh(); } catch { /* engine not ready */ }
  }

  function handleOpacityChange(value: number) {
    if (!activeTrackId || !activeKeyframe) return;
    updateKeyframe(activeTrackId, activeKeyframe.id, { fillOpacity: value });
    try { getEngine().refresh(); } catch { /* engine not ready */ }
  }

  function handleWidthChange(value: number) {
    if (!activeTrackId || !activeKeyframe) return;
    updateKeyframe(activeTrackId, activeKeyframe.id, { outlineWidth: value });
    try { getEngine().refresh(); } catch { /* engine not ready */ }
  }

  function handleInterpolationChange(interpolation: Interpolation) {
    if (!activeTrackId || !activeKeyframe) return;
    updateKeyframe(activeTrackId, activeKeyframe.id, { interpolation });
  }

  const isDrawing = appMode === 'drawing';

  return (
    <aside className="properties-panel">
      <section className="properties-panel__section">
        <MapUploader />
      </section>

      <section className="properties-panel__section">
        <div className="properties-panel__section-title">Frontlines</div>

        <div className="properties-panel__track-list">
          {tracks.map(track => (
            <div
              key={track.id}
              className={`properties-panel__track-item ${activeTrackId === track.id ? 'active' : ''}`}
              onClick={() => setActiveTrack(track.id)}
            >
              <span
                className="properties-panel__track-swatch"
                style={{ background: track.color }}
              />
              <span className="properties-panel__track-name">{track.name}</span>
              <button
                className="properties-panel__track-remove"
                onClick={e => { e.stopPropagation(); handleRemoveTrack(track.id); }}
                title={isDrawing && drawingTrackId === track.id ? 'Cannot delete while drawing' : 'Remove track'}
                disabled={isDrawing && drawingTrackId === track.id}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="properties-panel__actions">
          <button
            className="properties-panel__btn properties-panel__btn--primary"
            onClick={handleAddTrack}
            disabled={isDrawing}
          >
            + Add Frontline
          </button>
          {activeTrackId && (
            <button
              className="properties-panel__btn"
              onClick={handleAddKeyframe}
              disabled={isDrawing}
              title="Draw a new keyframe at the current playhead position"
            >
              + Add Keyframe
            </button>
          )}
        </div>
      </section>

      {activeKeyframe && (
        <section className="properties-panel__section">
          <div className="properties-panel__section-title">Keyframe Style</div>

          <label className="properties-panel__field">
            <span>Color</span>
            <input
              type="color"
              value={activeKeyframe.color}
              onChange={e => handleColorChange(e.target.value)}
            />
          </label>

          <label className="properties-panel__field">
            <span>Fill Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={activeKeyframe.fillOpacity}
              onChange={e => handleOpacityChange(Number(e.target.value))}
            />
            <span className="properties-panel__field-value">
              {Math.round(activeKeyframe.fillOpacity * 100)}%
            </span>
          </label>

          <label className="properties-panel__field">
            <span>Line Width</span>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={activeKeyframe.outlineWidth}
              onChange={e => handleWidthChange(Number(e.target.value))}
            />
            <span className="properties-panel__field-value">
              {activeKeyframe.outlineWidth}px
            </span>
          </label>

          <label className="properties-panel__field">
            <span>Interpolation</span>
            <select
              className="properties-panel__select"
              value={activeKeyframe.interpolation ?? 'linear'}
              onChange={e => handleInterpolationChange(e.target.value as Interpolation)}
            >
              <option value="linear">Linear</option>
              <option value="ease-in">Ease In</option>
              <option value="ease-out">Ease Out</option>
              <option value="ease-in-out">Ease In / Out</option>
              <option value="hold">Hold</option>
            </select>
          </label>
        </section>
      )}

      {isDrawing && (
        <div className="properties-panel__drawing-indicator">
          Drawing mode active
        </div>
      )}
    </aside>
  );
}
