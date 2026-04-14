import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Track, Keyframe, Point } from '../types';

const TRACK_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#3498db', '#9b59b6', '#1abc9c', '#e91e63',
];

let colorIndex = 0;
function nextColor(): string {
  return TRACK_COLORS[colorIndex++ % TRACK_COLORS.length];
}

const MAX_HISTORY = 50;

interface TrackState {
  tracks: Track[];
  activeTrackId: string | null;
  recordingTrackIds: string[];

  // Undo/redo history — each entry captures tracks + selection together
  past: { tracks: Track[]; activeTrackId: string | null }[];
  future: { tracks: Track[]; activeTrackId: string | null }[];

  addTrack: (name?: string) => Track;
  removeTrack: (trackId: string) => void;
  clearAll: () => void;
  setActiveTrack: (trackId: string | null) => void;
  addKeyframe: (
    trackId: string,
    time: number,
    points: Point[],
    style?: Partial<Pick<Keyframe, 'color' | 'outlineWidth' | 'fillOpacity' | 'glowWidth' | 'interpolation'>>,
  ) => Keyframe;
  updateKeyframe: (trackId: string, keyframeId: string, data: Partial<Keyframe>) => void;
  removeKeyframe: (trackId: string, keyframeId: string) => void;
  moveKeyframe: (trackId: string, keyframeId: string, newTime: number) => void;
  updateTrackColor: (trackId: string, color: string) => void;
  updateTrackName: (trackId: string, name: string) => void;
  toggleRecording: (trackId: string) => void;

  /** Push current tracks onto the undo stack, clearing redo. */
  _snapshot: () => void;
  undo: () => void;
  redo: () => void;

  /** Replace all tracks from a loaded save file (preserves existing IDs/data). */
  loadAll: (tracks: Track[]) => void;
}

export const useTrackStore = create<TrackState>()(
  subscribeWithSelector((set, get) => ({
    tracks: [],
    activeTrackId: null,
    recordingTrackIds: [],
    past: [],
    future: [],

    _snapshot: () => {
      const { tracks, activeTrackId } = get();
      set(state => ({
        past: [...state.past.slice(-(MAX_HISTORY - 1)), { tracks, activeTrackId }],
        future: [],
      }));
    },

    undo: () => {
      set(state => {
        if (state.past.length === 0) return state;
        const past = [...state.past];
        const restored = past.pop()!;
        return {
          past,
          future: [{ tracks: state.tracks, activeTrackId: state.activeTrackId }, ...state.future],
          tracks: restored.tracks,
          activeTrackId: restored.activeTrackId,
        };
      });
    },

    redo: () => {
      set(state => {
        if (state.future.length === 0) return state;
        const [restored, ...future] = state.future;
        return {
          past: [...state.past, { tracks: state.tracks, activeTrackId: state.activeTrackId }],
          future,
          tracks: restored.tracks,
          activeTrackId: restored.activeTrackId,
        };
      });
    },

    addTrack: (name?: string) => {
      get()._snapshot();
      const color = nextColor();
      const track: Track = {
        id: crypto.randomUUID(),
        name: name ?? `Frontline ${get().tracks.length + 1}`,
        color,
        keyframes: [],
      };
      set(state => ({ tracks: [...state.tracks, track] }));
      return track;
    },

    removeTrack: (trackId) => {
      get()._snapshot();
      set(state => ({
        tracks: state.tracks.filter(t => t.id !== trackId),
        activeTrackId:
          state.activeTrackId === trackId ? null : state.activeTrackId,
        recordingTrackIds: state.recordingTrackIds.filter(id => id !== trackId),
      }));
    },

    clearAll: () => {
      get()._snapshot();
      set({ tracks: [], activeTrackId: null, recordingTrackIds: [] });
    },

    setActiveTrack: (activeTrackId) => set({ activeTrackId }),

    addKeyframe: (trackId, time, points, style?) => {
      get()._snapshot();
      const track = get().tracks.find(t => t.id === trackId);
      const keyframe: Keyframe = {
        id: crypto.randomUUID(),
        time,
        points,
        color:         style?.color         ?? track?.color ?? '#e74c3c',
        outlineWidth:  style?.outlineWidth   ?? 3,
        fillOpacity:   style?.fillOpacity    ?? 0.25,
        glowWidth:     style?.glowWidth      ?? 8,
        interpolation: style?.interpolation  ?? 'linear',
      };
      set(state => ({
        tracks: state.tracks.map(t =>
          t.id === trackId
            ? { ...t, keyframes: [...t.keyframes, keyframe].sort((a, b) => a.time - b.time) }
            : t,
        ),
      }));
      return keyframe;
    },

    updateKeyframe: (trackId, keyframeId, data) => {
      get()._snapshot();
      set(state => ({
        tracks: state.tracks.map(t =>
          t.id !== trackId
            ? t
            : {
                ...t,
                keyframes: t.keyframes
                  .map(kf => (kf.id === keyframeId ? { ...kf, ...data } : kf))
                  .sort((a, b) => a.time - b.time),
              },
        ),
      }));
    },

    removeKeyframe: (trackId, keyframeId) => {
      get()._snapshot();
      set(state => ({
        tracks: state.tracks.map(t =>
          t.id !== trackId
            ? t
            : { ...t, keyframes: t.keyframes.filter(kf => kf.id !== keyframeId) },
        ),
      }));
    },

    moveKeyframe: (trackId, keyframeId, newTime) =>
      set(state => ({
        tracks: state.tracks.map(t =>
          t.id !== trackId
            ? t
            : {
                ...t,
                keyframes: t.keyframes
                  .map(kf => (kf.id === keyframeId ? { ...kf, time: newTime } : kf))
                  .sort((a, b) => a.time - b.time),
              },
        ),
      })),

    updateTrackColor: (trackId, color) =>
      set(state => ({
        tracks: state.tracks.map(t => (t.id === trackId ? { ...t, color } : t)),
      })),

    updateTrackName: (trackId, name) =>
      set(state => ({
        tracks: state.tracks.map(t => (t.id === trackId ? { ...t, name } : t)),
      })),

    toggleRecording: (trackId) =>
      set(state => ({
        recordingTrackIds: state.recordingTrackIds.includes(trackId)
          ? state.recordingTrackIds.filter(id => id !== trackId)
          : [...state.recordingTrackIds, trackId],
      })),

    loadAll: (tracks) => {
      // Resume color cycling after the loaded tracks so new additions don't clash
      colorIndex = tracks.length;
      set({ tracks, activeTrackId: null, recordingTrackIds: [], past: [], future: [] });
    },
  })),
);
