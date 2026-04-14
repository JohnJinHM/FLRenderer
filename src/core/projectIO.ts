/**
 * projectIO.ts — save / load project files
 *
 * File format: JSON with version tag so future schema changes can be migrated.
 *
 *  {
 *    "version": 1,
 *    "project": { resolution, duration, fps, mapImageDataUrl, viewState },
 *    "tracks": [ ...Track objects with full Keyframe data... ]
 *  }
 *
 * The map image is embedded as a base64 data-URL so the file is fully
 * self-contained.  Object URLs (blob:…) are ephemeral and cannot be
 * serialised, so we fetch the blob and re-encode it on save, and convert
 * back to an Object URL on load.
 */

import { useProjectStore } from '../store/useProjectStore';
import { useTrackStore }   from '../store/useTrackStore';
import { downloadBlob, fileToDataURL } from '../utils/fileUtils';
import { getController, getEngine } from './instances';
import type { Track } from '../types';
import type { ViewState } from './graphics/PaperEngine';

// ── File schema ────────────────────────────────────────────────────────────

interface ProjectFile {
  version: 1;
  project: {
    resolution: { w: number; h: number };
    duration: number;
    fps: number;
    mapImageDataUrl: string | null;
    viewState: ViewState | null;
  };
  tracks: Track[];
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Convert an Object URL (blob:…) to a base64 data URL for serialisation. */
async function objectUrlToDataUrl(objectUrl: string): Promise<string> {
  const res  = await fetch(objectUrl);
  const blob = await res.blob();
  return fileToDataURL(blob);
}

/** Convert a base64 data URL back to a new Object URL. */
async function dataUrlToObjectUrl(dataUrl: string): Promise<string> {
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Serialise the current project to a `.json` file and trigger a download.
 * The map image (if any) is embedded as a base64 data URL.
 */
export async function saveProject(): Promise<void> {
  const { resolution, duration, fps, mapImageUrl } = useProjectStore.getState();
  const { tracks } = useTrackStore.getState();

  const mapImageDataUrl = mapImageUrl
    ? await objectUrlToDataUrl(mapImageUrl)
    : null;

  let viewState: ViewState | null = null;
  try { viewState = getEngine().getViewState(); } catch { /* engine not ready */ }

  const file: ProjectFile = {
    version: 1,
    project: { resolution, duration, fps, mapImageDataUrl, viewState },
    tracks,
  };

  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, 'project.json');
}

/**
 * Parse a `.json` File selected by the user, stop any active playback,
 * and restore the full project state (map + tracks + settings).
 *
 * Throws if the file is malformed or an unsupported version.
 */
export async function loadProject(file: File): Promise<void> {
  // ── Parse ──────────────────────────────────────────────────────────────
  let data: ProjectFile;
  try {
    data = JSON.parse(await file.text()) as ProjectFile;
  } catch {
    throw new Error('Could not parse project file — make sure it is a valid project.');
  }

  if (data.version !== 1) {
    throw new Error(`Unsupported project version "${data.version}".`);
  }

  // ── Stop playback ──────────────────────────────────────────────────────
  try { getController().pause(); } catch { /* engine not yet ready */ }

  // ── Cancel any drawing in progress ────────────────────────────────────
  const { appMode, setDrawingTrackId, setAppMode } = useProjectStore.getState();
  if (appMode === 'drawing') {
    setDrawingTrackId(null);
    setAppMode('idle');
  }

  // ── Convert embedded map image back to an Object URL ───────────────────
  let mapImageUrl: string | null = null;
  if (data.project.mapImageDataUrl) {
    mapImageUrl = await dataUrlToObjectUrl(data.project.mapImageDataUrl);
  }

  // ── Restore state (order matters: project first, tracks second) ─────────
  // restoreState revokes the old Object URL internally.
  useProjectStore.getState().restoreState({
    resolution:  data.project.resolution,
    duration:    data.project.duration,
    fps:         data.project.fps,
    mapImageUrl,
  });

  // loadAll resets activeTrackId and colorIndex, then sets the track array.
  useTrackStore.getState().loadAll(data.tracks);

  // ── Restore view state (zoom/pan) ──────────────────────────────────────
  if (data.project.viewState) {
    try { getEngine().setViewState(data.project.viewState); } catch { /* engine not yet ready */ }
  }
}
