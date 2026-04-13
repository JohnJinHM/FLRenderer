/**
 * Module-level singletons for the core engine instances.
 * Initialised once by CanvasView, then accessible by any component.
 */
import type { PaperEngine } from './graphics/PaperEngine';
import type { GsapController } from './animation/GsapController';
import type { VideoRenderer } from './exporter/VideoRenderer';

let _engine: PaperEngine | null = null;
let _controller: GsapController | null = null;
let _renderer: VideoRenderer | null = null;

export function setInstances(
  engine: PaperEngine,
  controller: GsapController,
  renderer: VideoRenderer,
): void {
  _engine = engine;
  _controller = controller;
  _renderer = renderer;
}

export function getEngine(): PaperEngine {
  if (!_engine) throw new Error('PaperEngine not yet initialised');
  return _engine;
}

export function getController(): GsapController {
  if (!_controller) throw new Error('GsapController not yet initialised');
  return _controller;
}

export function getRenderer(): VideoRenderer {
  if (!_renderer) throw new Error('VideoRenderer not yet initialised');
  return _renderer;
}
