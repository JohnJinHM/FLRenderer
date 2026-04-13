import { useCallback, useEffect } from 'react';
import { Layout } from './components/Layout';
import { CanvasView } from './components/CanvasView';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Timeline } from './components/Timeline';
import { useProjectStore } from './store/useProjectStore';
import { getController, getRenderer } from './core/instances';
import './App.css';

function Header() {
  const appMode = useProjectStore(s => s.appMode);
  const exportProgress = useProjectStore(s => s.exportProgress);
  const isExporting = appMode === 'exporting';

  const handleExport = useCallback(async () => {
    try {
      await getRenderer().export();
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, []);

  const handleAbort = useCallback(() => {
    try { getRenderer().abort(); } catch { /* not yet ready */ }
  }, []);

  // Global Space key for play/pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        try {
          const ctrl = getController();
          const mode = useProjectStore.getState().appMode;
          if (mode === 'playing') ctrl.pause();
          else if (mode === 'idle') ctrl.play();
        } catch { /* not yet ready */ }
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
      {isExporting ? (
        <div className="app-header__export-status">
          <div className="app-header__progress-bar">
            <div
              className="app-header__progress-fill"
              style={{ width: `${exportProgress?.percent ?? 0}%` }}
            />
          </div>
          <span className="app-header__progress-label">
            {exportProgress?.message ?? 'Exporting…'}
          </span>
          <button className="app-header__btn app-header__btn--danger" onClick={handleAbort}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="app-header__btn app-header__btn--primary"
          onClick={handleExport}
          disabled={appMode !== 'idle'}
          title="Export animation as MP4"
        >
          Export MP4
        </button>
      )}
    </>
  );
}

export default function App() {
  return (
    <Layout
      header={<Header />}
      sidebar={<PropertiesPanel />}
      canvas={<CanvasView />}
      timeline={<Timeline />}
    />
  );
}
