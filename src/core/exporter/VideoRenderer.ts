import { useProjectStore } from '../../store/useProjectStore';
import { canvasToBlob, blobToUint8Array, downloadBlob } from '../../utils/fileUtils';
import type { PaperEngine } from '../graphics/PaperEngine';
import type { GsapController } from '../animation/GsapController';

// Import the worker using Vite's worker syntax
import FFmpegWorkerFactory from './FFmpegWorker?worker';

export class VideoRenderer {
  private engine: PaperEngine;
  private controller: GsapController;
  private worker: Worker | null = null;
  private aborted = false;

  constructor(engine: PaperEngine, controller: GsapController) {
    this.engine = engine;
    this.controller = controller;
  }

  async export(): Promise<void> {
    const store = useProjectStore.getState();
    const { duration, fps, resolution, setAppMode, setExportProgress } = store;

    // Stop any current playback
    this.controller.stop();
    setAppMode('exporting');
    this.aborted = false;

    try {
      // ── Phase 1: Capture frames ──────────────────────────────────────────
      setExportProgress({ phase: 'capturing', percent: 0, message: 'Initialising FFmpeg…' });

      this.worker = new FFmpegWorkerFactory();
      await this.initWorker();

      const totalFrames = Math.ceil((duration / 1000) * fps);
      const frameDuration = 1000 / fps;

      setExportProgress({ phase: 'capturing', percent: 0, message: `Capturing ${totalFrames} frames…` });

      for (let i = 0; i < totalFrames && !this.aborted; i++) {
        const timeMs = i * frameDuration;

        // Render at this exact time
        this.engine.renderAtTime(timeMs);

        // Wait one microtask so Paper.js flushes to the canvas
        await new Promise(r => requestAnimationFrame(r));

        const blob = await canvasToBlob(this.engine.canvas);
        const data = await blobToUint8Array(blob);

        await this.sendFrame(i, data);

        const percent = Math.round(((i + 1) / totalFrames) * 100);
        setExportProgress({
          phase: 'capturing',
          percent,
          message: `Capturing frame ${i + 1} / ${totalFrames}`,
        });
      }

      if (this.aborted) {
        setExportProgress({ phase: 'error', percent: 0, message: 'Export cancelled.' });
        return;
      }

      // ── Phase 2: Encode ──────────────────────────────────────────────────
      setExportProgress({ phase: 'encoding', percent: 0, message: 'Encoding video…' });

      const mp4Data = await this.encode(fps, resolution.w, resolution.h);
      const blob = new Blob([mp4Data.buffer as ArrayBuffer], { type: 'video/mp4' });
      downloadBlob(blob, 'frontline-animation.mp4');

      setExportProgress({ phase: 'done', percent: 100, message: 'Export complete!' });
    } catch (err) {
      setExportProgress({
        phase: 'error',
        percent: 0,
        message: err instanceof Error ? err.message : 'Unknown export error.',
      });
    } finally {
      this.worker?.terminate();
      this.worker = null;
      setAppMode('idle');
      // Reset to t=0
      this.engine.renderAtTime(useProjectStore.getState().currentTime);
    }
  }

  abort(): void {
    this.aborted = true;
    this.worker?.terminate();
    this.worker = null;
  }

  // ─── Worker helpers ───────────────────────────────────────────────────────

  private initWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          this.worker!.removeEventListener('message', handler);
          resolve();
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.message));
        }
      };
      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ type: 'init' });
    });
  }

  private sendFrame(index: number, data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'frameAdded' && e.data.index === index) {
          this.worker!.removeEventListener('message', handler);
          resolve();
        } else if (e.data.type === 'error') {
          this.worker!.removeEventListener('message', handler);
          reject(new Error(e.data.message));
        }
      };
      this.worker!.addEventListener('message', handler);
      // Copy to a plain ArrayBuffer so it's transferable
      const buf = data.buffer.slice(0) as ArrayBuffer;
      this.worker!.postMessage({ type: 'addFrame', index, data: buf }, [buf]);
    });
  }

  private encode(fps: number, width: number, height: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const { setExportProgress } = useProjectStore.getState();
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'progress') {
          setExportProgress({
            phase: 'encoding',
            percent: e.data.percent,
            message: `Encoding… ${e.data.percent}%`,
          });
        } else if (e.data.type === 'done') {
          this.worker!.removeEventListener('message', handler);
          resolve(e.data.data as Uint8Array);
        } else if (e.data.type === 'error') {
          this.worker!.removeEventListener('message', handler);
          reject(new Error(e.data.message));
        }
      };
      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ type: 'encode', fps, width, height });
    });
  }
}
