import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { CanvasView } from './components/CanvasView';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Timeline } from './components/Timeline';
import { useProjectStore } from './store/useProjectStore';
import { useTrackStore } from './store/useTrackStore';
import { getController, getEngine } from './core/instances';
import { loadProject } from './core/projectIO';
import { getSampleProjectFile } from './assets/sampleProject';
import './App.css';

function Header() {
  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Space — play/pause
      if (e.code === 'Space') {
        e.preventDefault();
        try {
          const ctrl = getController();
          const mode = useProjectStore.getState().appMode;
          if (mode === 'playing') ctrl.pause();
          else if (mode === 'idle') ctrl.play();
        } catch { /* not yet ready */ }
        return;
      }

      // Ctrl+Z — remove last drawing vertex while drawing, otherwise global undo
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        if (useProjectStore.getState().appMode === 'drawing') {
          try { getEngine().removeLastDrawingPoint(); } catch { /* not ready */ }
        } else {
          useTrackStore.getState().undo();
        }
        return;
      }

      // Ctrl+Shift+Z — redo
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        useTrackStore.getState().redo();
        return;
      }

      // Delete / Backspace — remove keyframe at or nearest to current time
      if ((e.code === 'Delete' || e.code === 'Backspace') &&
          useProjectStore.getState().appMode === 'idle') {
        const { activeTrackId, tracks, removeKeyframe } = useTrackStore.getState();
        if (!activeTrackId) return;
        const track = tracks.find(t => t.id === activeTrackId);
        if (!track || track.keyframes.length === 0) return;
        const { currentTime } = useProjectStore.getState();
        // Find keyframe whose time exactly matches (or is closest within 200 ms)
        let closest = track.keyframes[0];
        let minDist = Math.abs(closest.time - currentTime);
        for (const kf of track.keyframes) {
          const d = Math.abs(kf.time - currentTime);
          if (d < minDist) { minDist = d; closest = kf; }
        }
        if (minDist <= 200) {
          e.preventDefault();
          removeKeyframe(activeTrackId, closest.id);
        }
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <span className="app-header__logo">FLRenderer</span>
      <span className="app-header__divider" />
      <span className="app-header__subtitle">Frontline Animation Studio</span>
      <div className="app-header__spacer" />
    </>
  );
}

export default function App() {
  // Load sample project on first mount when project is empty
  useEffect(() => {
    const { tracks } = useTrackStore.getState();
    const { mapImageUrl } = useProjectStore.getState();
    if (tracks.length === 0 && !mapImageUrl) {
      getSampleProjectFile()
        .then(file => loadProject(file))
        .catch(console.error);
    }
  }, []);

  return (
    <Layout
      header={<Header />}
      sidebar={<PropertiesPanel />}
      canvas={<CanvasView />}
      timeline={<Timeline />}
    />
  );
}
