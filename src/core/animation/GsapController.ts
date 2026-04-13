import gsap from 'gsap';
import { useProjectStore } from '../../store/useProjectStore';
import type { PaperEngine } from '../graphics/PaperEngine';

export class GsapController {
  private engine: PaperEngine;
  private timeline: gsap.core.Timeline | null = null;
  private progressProxy = { time: 0 };

  constructor(engine: PaperEngine) {
    this.engine = engine;
  }

  /** Start playback from currentTime to duration. */
  play(): void {
    const { currentTime, duration, setCurrentTime, setAppMode } = useProjectStore.getState();

    if (currentTime >= duration) {
      setCurrentTime(0);
      this.progressProxy.time = 0;
    } else {
      this.progressProxy.time = currentTime;
    }

    setAppMode('playing');

    const remaining = duration - this.progressProxy.time;

    this.timeline = gsap.timeline({
      onUpdate: () => {
        const t = this.progressProxy.time;
        // Update store time (for UI/timeline scrubber) without triggering Paper.js re-subscribe
        useProjectStore.setState({ currentTime: t });
        // Directly tell Paper.js engine to render – bypasses React render cycle
        this.engine.renderAtTime(t);
      },
      onComplete: () => {
        useProjectStore.getState().setAppMode('idle');
        this.timeline = null;
      },
    });

    this.timeline.to(this.progressProxy, {
      time: duration,
      duration: remaining / 1000,
      ease: 'none',
    });
  }

  pause(): void {
    this.timeline?.pause();
    useProjectStore.getState().setAppMode('idle');
  }

  resume(): void {
    if (this.timeline?.paused()) {
      this.timeline.resume();
      useProjectStore.getState().setAppMode('playing');
    } else {
      this.play();
    }
  }

  stop(): void {
    this.timeline?.kill();
    this.timeline = null;
    useProjectStore.getState().setAppMode('idle');
  }

  /** Seek to an absolute time in ms. Called by timeline scrubber. */
  seekTo(timeMs: number): void {
    this.stop();
    this.progressProxy.time = timeMs;
    useProjectStore.getState().setCurrentTime(timeMs);
    this.engine.renderAtTime(timeMs);
  }

  get isPlaying(): boolean {
    return this.timeline !== null && !this.timeline.paused();
  }

  destroy(): void {
    this.stop();
  }
}
