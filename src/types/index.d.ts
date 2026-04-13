export interface Point {
  x: number;
  y: number;
}

export type Interpolation = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export interface Keyframe {
  id: string;
  time: number;           // Time in milliseconds
  points: Point[];        // The vertices of the frontline at this time
  color: string;          // Hex color string
  outlineWidth: number;
  fillOpacity: number;    // 0..1 for territory fill
  interpolation: Interpolation;  // Easing applied leaving this keyframe
}

export interface Track {
  id: string;
  name: string;
  color: string;       // Default color for new keyframes
  keyframes: Keyframe[];
}

export type DrawingMode = 'select' | 'draw';

export type AppMode = 'idle' | 'drawing' | 'playing' | 'exporting';

export interface ExportProgress {
  phase: 'capturing' | 'encoding' | 'done' | 'error';
  percent: number;
  message: string;
}
