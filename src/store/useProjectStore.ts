import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AppMode } from '../types';

interface ProjectState {
  mapImageUrl: string | null;
  resolution: { w: number; h: number };
  duration: number;       // Total video duration in ms
  currentTime: number;    // Playhead position in ms
  fps: number;
  appMode: AppMode;
  drawingTrackId: string | null; // Which track is currently being drawn

  setMapImage: (file: File) => void;
  clearMapImage: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setFps: (fps: number) => void;
  setAppMode: (mode: AppMode) => void;
  setDrawingTrackId: (id: string | null) => void;

  /** Replace the entire project state from a loaded save file. */
  restoreState: (saved: {
    resolution: { w: number; h: number };
    duration: number;
    fps: number;
    mapImageUrl: string | null;
  }) => void;
}

export const useProjectStore = create<ProjectState>()(
  subscribeWithSelector((set, get) => ({
    mapImageUrl: null,
    resolution: { w: 1920, h: 1080 },
    duration: 10_000,
    currentTime: 0,
    fps: 60,
    appMode: 'idle',
    drawingTrackId: null,

    setMapImage: (file: File) => {
      const prev = get().mapImageUrl;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(file);
      set({ mapImageUrl: url });
    },

    clearMapImage: () => {
      const prev = get().mapImageUrl;
      if (prev) URL.revokeObjectURL(prev);
      set({ mapImageUrl: null });
    },

    setCurrentTime: (time) =>
      set({ currentTime: Math.max(0, Math.min(time, get().duration)) }),

    setDuration: (duration) => set({ duration }),
    setFps: (fps) => set({ fps }),
    setAppMode: (appMode) => set({ appMode }),
    setDrawingTrackId: (drawingTrackId) => set({ drawingTrackId }),

    restoreState: (saved) => {
      // Revoke the previous Object URL before replacing it
      const prev = get().mapImageUrl;
      if (prev) URL.revokeObjectURL(prev);
      set({
        resolution:    saved.resolution,
        duration:      saved.duration,
        fps:           saved.fps,
        mapImageUrl:   saved.mapImageUrl,
        currentTime:   0,
        appMode:       'idle',
        drawingTrackId: null,
      });
    },
  })),
);
