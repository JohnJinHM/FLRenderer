/// <reference lib="webworker" />
/**
 * FFmpegWorker – runs as a Web Worker.
 * Receives raw PNG frames from the main thread, then encodes them into MP4
 * using @ffmpeg/ffmpeg (which itself manages a WASM binary).
 *
 * Message protocol
 * ─────────────────
 * Main → Worker
 *   { type: 'init' }
 *   { type: 'addFrame', index: number, data: Uint8Array }
 *   { type: 'encode',   fps: number, width: number, height: number }
 *   { type: 'reset' }
 *
 * Worker → Main
 *   { type: 'ready' }
 *   { type: 'frameAdded', index: number }
 *   { type: 'progress',   percent: number }
 *   { type: 'done',       data: Uint8Array }
 *   { type: 'error',      message: string }
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

let ffmpeg: FFmpeg | null = null;
let frameCount = 0;

async function initFFmpeg() {
  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    console.debug('[ffmpeg]', message);
  });
  ffmpeg.on('progress', ({ progress }) => {
    self.postMessage({ type: 'progress', percent: Math.round(progress * 100) });
  });

  await ffmpeg.load({
    coreURL: await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        await initFFmpeg();
        frameCount = 0;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'addFrame': {
        if (!ffmpeg) throw new Error('FFmpeg not initialised');
        const filename = `frame${String(msg.index).padStart(6, '0')}.png`;
        await ffmpeg.writeFile(filename, new Uint8Array(msg.data as ArrayBuffer));
        frameCount = Math.max(frameCount, msg.index + 1);
        self.postMessage({ type: 'frameAdded', index: msg.index });
        break;
      }

      case 'encode': {
        if (!ffmpeg) throw new Error('FFmpeg not initialised');
        await ffmpeg.exec([
          '-framerate', String(msg.fps),
          '-i', 'frame%06d.png',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'fast',
          '-crf', '18',
          'output.mp4',
        ]);
        const raw = await ffmpeg.readFile('output.mp4') as Uint8Array;
        // Copy to a plain ArrayBuffer to ensure Transferable compatibility
        const data = new Uint8Array(raw);
        const buf = data.buffer as ArrayBuffer;
        self.postMessage({ type: 'done', data }, [buf]);
        break;
      }

      case 'reset': {
        frameCount = 0;
        // Re-init clears FFmpeg's virtual FS
        if (ffmpeg) {
          await ffmpeg.terminate();
          ffmpeg = null;
        }
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
