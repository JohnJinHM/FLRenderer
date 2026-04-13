import { useRef } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTrackStore } from '../../store/useTrackStore';
import './MapUploader.css';

export function MapUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const mapImageUrl = useProjectStore(s => s.mapImageUrl);
  const { setMapImage, clearMapImage, setAppMode, setDrawingTrackId } = useProjectStore();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setMapImage(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }

  function handleClear() {
    // Cancel any active drawing session before wiping state
    setDrawingTrackId(null);
    setAppMode('idle');
    // Remove all tracks and their Paper.js visuals (PaperEngine reacts via subscription)
    useTrackStore.getState().clearAll();
    // Remove the map raster
    clearMapImage();
  }

  return (
    <div className="map-uploader">
      <div className="map-uploader__label">Base Map</div>

      <button
        className="map-uploader__btn"
        onClick={() => inputRef.current?.click()}
        title="Import a map image (PNG, JPG, SVG…)"
      >
        {mapImageUrl ? 'Change Map' : 'Import Map'}
      </button>

      {mapImageUrl && (
        <button
          className="map-uploader__btn map-uploader__btn--danger"
          onClick={handleClear}
          title="Remove the map and all frontlines"
        >
          Clear
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleChange}
      />

      {mapImageUrl && (
        <div className="map-uploader__preview">
          <img src={mapImageUrl} alt="Map preview" />
        </div>
      )}
    </div>
  );
}
