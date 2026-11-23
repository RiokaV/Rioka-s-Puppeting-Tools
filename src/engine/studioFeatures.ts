import type {
  ArtMeshLayer,
  CubicBezierTuple,
  EasingCurvePreset,
  ExpressionPreset,
  KeyframeEasing,
  KeyformDelta,
  ParameterTrack,
  RigParameter,
  TimelineKeyframe,
} from '../types/puppet';
import type { KeyframeSelectionItem } from './morphTools';

// ============================================================================
// 1. UNDO / REDO HISTORY STACK (with continuous drag coalescing)
// ============================================================================

export interface HistoryStack<T> {
  past: T[];
  future: T[];
  lastPushAt: number;
  lastTag: string | null;
}

export function createHistoryStack<T>(): HistoryStack<T> {
  return {
    past: [],
    future: [],
    lastPushAt: 0,
    lastTag: null,
  };
}

/**
 * Pushes a previous state snapshot onto the Undo stack.
 * If the same `tag` is pushed repeatedly within `coalesceMs` (e.g., slider drag or bone drag),
 * it keeps the pre-drag snapshot instead of flooding the history with micro-steps.
 */
export function pushHistorySnapshot<T>(
  stack: HistoryStack<T>,
  previousState: T,
  options: { tag?: string; nowMs?: number; coalesceMs?: number; maxDepth?: number } = {}
): HistoryStack<T> {
  const nowMs = options.nowMs ?? Date.now();
  const coalesceMs = options.coalesceMs ?? 450;
  const maxDepth = options.maxDepth ?? 60;
  const tag = options.tag ?? null;

  if (
    tag !== null &&
    stack.lastTag === tag &&
    stack.past.length > 0 &&
    nowMs - stack.lastPushAt <= coalesceMs
  ) {
    return {
      ...stack,
      future: [],
      lastPushAt: nowMs,
    };
  }

  const nextPast = [...stack.past, previousState];
  if (nextPast.length > maxDepth) {
    nextPast.splice(0, nextPast.length - maxDepth);
  }
  return {
    past: nextPast,
    future: [],
    lastPushAt: nowMs,
    lastTag: tag,
  };
}

export function undoHistory<T>(
  stack: HistoryStack<T>,
  currentState: T
): { stack: HistoryStack<T>; restored: T | null } {
  if (stack.past.length === 0) {
    return { stack, restored: null };
  }
  const restored = stack.past[stack.past.length - 1];
  return {
    restored,
    stack: {
      past: stack.past.slice(0, -1),
      future: [...stack.future, currentState],
      lastPushAt: 0,
      lastTag: null,
    },
  };
}

export function redoHistory<T>(
  stack: HistoryStack<T>,
  currentState: T
): { stack: HistoryStack<T>; restored: T | null } {
  if (stack.future.length === 0) {
    return { stack, restored: null };
  }
  const restored = stack.future[stack.future.length - 1];
  return {
    restored,
    stack: {
      past: [...stack.past, currentState],
      future: stack.future.slice(0, -1),
      lastPushAt: 0,
      lastTag: null,
    },
  };
}

// ============================================================================
// 2. CUBIC BEZIER KEYFRAME EASING & CURVE PRESETS
// ============================================================================

export const DEFAULT_CURVE_PRESETS: EasingCurvePreset[] = [
  {
    id: 'curve_linear',
    name: 'Linear',
    easing: 'linear',
    bezier: [0.25, 0.25, 0.75, 0.75],
    favorite: false,
    builtIn: true,
  },
  {
    id: 'curve_easy_ease',
    name: 'Easy Ease (F9)',
    easing: 'bezier',
    bezier: [0.42, 0.0, 0.58, 1.0],
    favorite: true,
    builtIn: true,
  },
  {
    id: 'curve_snappy_out',
    name: 'Snappy Out',
    easing: 'bezier',
    bezier: [0.16, 1.0, 0.3, 1.0],
    favorite: true,
    builtIn: true,
  },
  {
    id: 'curve_anime_pop',
    name: 'Anime Pop',
    easing: 'bezier',
    bezier: [0.22, 1.28, 0.36, 1.0],
    favorite: true,
    builtIn: true,
  },
  {
    id: 'curve_expo_inout',
    name: 'Expo In-Out',
    easing: 'bezier',
    bezier: [0.85, 0.0, 0.15, 1.0],
    favorite: false,
    builtIn: true,
  },
  {
    id: 'curve_soft_in',
    name: 'Soft Ease In',
    easing: 'bezier',
    bezier: [0.55, 0.0, 0.9, 0.45],
    favorite: false,
    builtIn: true,
  },
  {
    id: 'curve_hold',
    name: 'Hold (Step)',
    easing: 'hold',
    bezier: [0.0, 0.0, 1.0, 0.0],
    favorite: false,
    builtIn: true,
  },
];

function sampleBezierCoord(a: number, b: number, u: number): number {
  // Cubic bezier with P0=0, P1=a, P2=b, P3=1
  const inv = 1 - u;
  return 3 * inv * inv * u * a + 3 * inv * u * u * b + u * u * u;
}

function sampleBezierDeriv(a: number, b: number, u: number): number {
  const inv = 1 - u;
  return 3 * inv * inv * a + 6 * inv * u * (b - a) + 3 * u * u * (1 - b);
}

/**
 * Evaluates a cubic-bezier easing curve y(x) for normalized time x in [0..1].
 * Supports overshoot y values (< 0 or > 1) just like After Effects / Flow curves.
 */
export function evaluateCubicBezier(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx1 = Math.max(0, Math.min(1, x1));
  const cx2 = Math.max(0, Math.min(1, x2));

  // Solve sampleBezierCoord(cx1, cx2, u) = x using Newton-Raphson with binary search fallback
  let u = x;
  for (let i = 0; i < 6; i++) {
    const err = sampleBezierCoord(cx1, cx2, u) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = sampleBezierDeriv(cx1, cx2, u);
    if (Math.abs(d) < 1e-6) break;
    u = Math.max(0, Math.min(1, u - err / d));
  }

  let lo = 0;
  let hi = 1;
  let err = sampleBezierCoord(cx1, cx2, u) - x;
  if (Math.abs(err) > 1e-5) {
    u = x;
    for (let i = 0; i < 14; i++) {
      const midVal = sampleBezierCoord(cx1, cx2, u);
      if (Math.abs(midVal - x) < 1e-6) break;
      if (midVal < x) lo = u;
      else hi = u;
      u = (lo + hi) * 0.5;
    }
  }

  return sampleBezierCoord(y1, y2, u);
}

/**
 * Applies an easing type and optional cubic-bezier curve to all selected keyframes.
 */
export function applyEasingToKeyframes(
  tracks: Record<string, ParameterTrack>,
  selection: KeyframeSelectionItem[],
  easing: KeyframeEasing,
  bezier?: CubicBezierTuple
): Record<string, ParameterTrack> {
  if (selection.length === 0) return tracks;
  const byParam = new Map<string, Set<string>>();
  for (const s of selection) {
    let set = byParam.get(s.parameterId);
    if (!set) {
      set = new Set();
      byParam.set(s.parameterId, set);
    }
    set.add(s.keyframeId);
  }

  const next = { ...tracks };
  for (const [paramId, ids] of byParam.entries()) {
    const track = next[paramId];
    if (!track) continue;
    next[paramId] = {
      ...track,
      keyframes: track.keyframes.map((kf) =>
        ids.has(kf.id)
          ? {
              ...kf,
              easing,
              bezier: easing === 'bezier' && bezier ? [...bezier] : undefined,
            }
          : kf
      ),
    };
  }
  return next;
}

// ============================================================================
// 3. BONE PARENTING CYCLE CHECK & ANCESTOR CHAIN
// ============================================================================

/**
 * Returns true if parenting `childId` under `candidateParentId` would create a cycle
 * (including self-parenting).
 */
export function wouldCreateLayerParentCycle(
  layers: ArtMeshLayer[],
  childId: string,
  candidateParentId: string | null | undefined
): boolean {
  if (!candidateParentId) return false;
  if (childId === candidateParentId) return true;
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cursor: string | null | undefined = candidateParentId;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    if (cursor === childId) return true;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentLayerId ?? null;
  }
  return false;
}

// ============================================================================
// 4. AUDIO TRACK PEAKS & AUTO LIP-SYNC
// ============================================================================

/**
 * Computes normalized per-frame RMS amplitude peaks [0..1] from mono/interleaved PCM samples.
 */
export function computeAudioFramePeaks(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  durationFrames: number
): number[] {
  const safeFrames = Math.max(1, Math.round(durationFrames));
  const safeFps = Math.max(1, fps);
  const samplesPerFrame = Math.max(1, Math.floor(sampleRate / safeFps));
  const raw: number[] = [];
  let maxRms = 0;

  for (let f = 0; f <= safeFrames; f++) {
    const start = f * samplesPerFrame;
    const end = Math.min(samples.length, start + samplesPerFrame);
    if (start >= samples.length || end <= start) {
      raw.push(0);
      continue;
    }
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / (end - start));
    raw.push(rms);
    if (rms > maxRms) maxRms = rms;
  }

  if (maxRms <= 1e-5) return raw.map(() => 0);
  return raw.map((v) => Math.max(0, Math.min(1, v / maxRms)));
}

/**
 * Synthesizes a clean demo voice-cadence PCM buffer (speech-like syllable envelopes)
 * so the user can immediately preview Audio Waveform + Auto Lip-Sync without needing a local file.
 */
export function generateDemoVoiceSamples(
  sampleRate: number,
  durationSec: number
): Float32Array {
  const totalSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const out = new Float32Array(totalSamples);

  // Expressive anime-style spoken phrase syllables (startSec, endSec, intensity, baseHz)
  const syllables: Array<[number, number, number, number]> = [
    [0.25, 0.55, 0.85, 310],
    [0.62, 0.92, 0.65, 340],
    [1.0, 1.38, 0.98, 290],
    [1.75, 2.02, 0.72, 360],
    [2.08, 2.35, 0.52, 320],
    [2.42, 2.88, 1.0, 300],
    [3.35, 3.65, 0.8, 350],
    [3.72, 4.18, 0.92, 315],
    [4.45, 4.82, 0.68, 330],
    [4.95, 5.45, 0.95, 295],
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let env = 0;
    let freq = 300;
    for (const [s0, s1, amp, hz] of syllables) {
      if (t >= s0 && t <= s1) {
        const localT = (t - s0) / Math.max(0.01, s1 - s0);
        // Smooth raised-cosine syllable envelope
        const bell = Math.sin(Math.PI * localT);
        env = Math.max(env, bell * amp);
        freq = hz;
      }
    }
    if (env > 0.001) {
      // Fundamental + 2 warm vocal harmonics
      const wave =
        0.65 * Math.sin(2 * Math.PI * freq * t) +
        0.25 * Math.sin(2 * Math.PI * freq * 2.01 * t) +
        0.1 * Math.sin(2 * Math.PI * freq * 3.02 * t);
      out[i] = wave * env * 0.42;
    }
  }
  return out;
}

/**
 * Generates clean, non-jittery Mouth Open keyframes from normalized per-frame audio peaks.
 */
export function generateLipSyncKeyframes(
  peaks: number[],
  options: { threshold?: number; sensitivity?: number; stepFrames?: number } = {}
): TimelineKeyframe[] {
  const threshold = options.threshold ?? 0.14;
  const sensitivity = options.sensitivity ?? 1.15;
  const stepFrames = Math.max(1, Math.round(options.stepFrames ?? 2));
  const kfs: TimelineKeyframe[] = [];
  let lastVal = -1;

  for (let f = 0; f < peaks.length; f += stepFrames) {
    const raw = peaks[f] ?? 0;
    const mapped =
      raw < threshold
        ? 0
        : Math.min(1, ((raw - threshold) / Math.max(0.05, 1 - threshold)) * sensitivity);
    const rounded = Math.round(mapped * 20) / 20;

    // Emit frame 0, final frame, or any meaningful change (or close-mouth transitions)
    const isEdge = f === 0 || f + stepFrames >= peaks.length;
    if (isEdge || Math.abs(rounded - lastVal) >= 0.12 || (rounded === 0 && lastVal > 0)) {
      kfs.push({
        id: `kf_lipsync_${f}`,
        frame: f,
        value: rounded,
        easing: 'linear',
      });
      lastVal = rounded;
    }
  }

  return kfs;
}

// ============================================================================
// 5. EXPRESSION PRESETS & AUTO-BLINK GENERATOR
// ============================================================================

export const DEFAULT_EXPRESSION_PRESETS: ExpressionPreset[] = [
  {
    id: 'expr_neutral',
    name: 'Neutral',
    builtIn: true,
    values: {
      ParamAngleX: 0,
      ParamAngleY: 0,
      ParamAngleZ: 0,
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamEyeBallX: 0,
      ParamEyeBallY: 0,
      ParamMouthOpenY: 0.25,
      ParamMouthForm: 0.4,
    },
  },
  {
    id: 'expr_happy',
    name: 'Happy',
    builtIn: true,
    values: {
      ParamAngleY: 6,
      ParamAngleZ: 5,
      ParamEyeLOpen: 0.22,
      ParamEyeROpen: 0.22,
      ParamMouthOpenY: 0.72,
      ParamMouthForm: 1.0,
    },
  },
  {
    id: 'expr_surprised',
    name: 'Surprised',
    builtIn: true,
    values: {
      ParamAngleY: 8,
      ParamAngleZ: -3,
      ParamEyeLOpen: 1.0,
      ParamEyeROpen: 1.0,
      ParamEyeBallY: 0.15,
      ParamMouthOpenY: 0.95,
      ParamMouthForm: -0.15,
    },
  },
  {
    id: 'expr_shy',
    name: 'Shy',
    builtIn: true,
    values: {
      ParamAngleX: -12,
      ParamAngleY: -8,
      ParamAngleZ: -10,
      ParamEyeLOpen: 0.78,
      ParamEyeROpen: 0.78,
      ParamEyeBallX: 0.55,
      ParamEyeBallY: -0.25,
      ParamMouthOpenY: 0.12,
      ParamMouthForm: 0.55,
    },
  },
  {
    id: 'expr_smug',
    name: 'Smug',
    builtIn: true,
    values: {
      ParamAngleX: 10,
      ParamAngleY: 4,
      ParamAngleZ: -6,
      ParamEyeLOpen: 0.62,
      ParamEyeROpen: 0.68,
      ParamEyeBallX: -0.4,
      ParamMouthOpenY: 0.18,
      ParamMouthForm: 0.85,
    },
  },
  {
    id: 'expr_sleepy',
    name: 'Sleepy',
    builtIn: true,
    values: {
      ParamAngleY: -10,
      ParamAngleZ: 9,
      ParamEyeLOpen: 0.35,
      ParamEyeROpen: 0.35,
      ParamEyeBallY: -0.35,
      ParamMouthOpenY: 0.48,
      ParamMouthForm: -0.3,
    },
  },
];

/**
 * Generates natural eye-blink keyframes across [0..durationFrames] for Eye L Open and Eye R Open.
 */
export function generateAutoBlinkKeyframes(
  durationFrames: number,
  fps: number,
  intervalSec = 2.4
): { eyeL: TimelineKeyframe[]; eyeR: TimelineKeyframe[] } {
  const safeDuration = Math.max(12, Math.round(durationFrames));
  const safeFps = Math.max(1, fps);
  const step = Math.max(18, Math.round(safeFps * intervalSec));
  const closeDur = Math.max(2, Math.round(safeFps * 0.08));
  const openDur = Math.max(3, Math.round(safeFps * 0.12));

  const buildTrack = (prefix: string): TimelineKeyframe[] => {
    const kfs: TimelineKeyframe[] = [
      { id: `${prefix}_start`, frame: 0, value: 1, easing: 'easeInOut' },
    ];
    let cursor = Math.min(safeDuration - openDur - closeDur - 2, Math.round(step * 0.65));
    let idx = 0;
    while (cursor > 2 && cursor + closeDur + openDur < safeDuration) {
      kfs.push(
        { id: `${prefix}_pre_${idx}`, frame: cursor - 1, value: 1, easing: 'easeInOut' },
        { id: `${prefix}_shut_${idx}`, frame: cursor + closeDur, value: 0, easing: 'easeInOut' },
        {
          id: `${prefix}_open_${idx}`,
          frame: cursor + closeDur + openDur,
          value: 1,
          easing: 'easeInOut',
        }
      );
      idx += 1;
      // Add subtle natural cadence variation (alternating normal vs slightly faster double-feel)
      cursor += idx % 3 === 0 ? Math.round(step * 0.8) : step;
    }
    if (kfs[kfs.length - 1].frame < safeDuration) {
      kfs.push({ id: `${prefix}_end`, frame: safeDuration, value: 1, easing: 'easeInOut' });
    }
    return kfs;
  };

  return {
    eyeL: buildTrack('kf_blink_l'),
    eyeR: buildTrack('kf_blink_r'),
  };
}

// ============================================================================
// 6. REFLECT / MIRROR KEYFORM (Live2D Time-Saver)
// ============================================================================

/**
 * Mirrors deformation keyform deltas across the parameter's defaultValue axis:
 * - 'minToMax': copies keyforms on the `< defaultValue` side to their mirrored `> defaultValue` values
 * - 'maxToMin': copies keyforms on the `> defaultValue` side to their mirrored `< defaultValue` values
 * Flips horizontal components (dx, rotation, skewX, skewY, meshWarp.bendX, meshWarp.squeezeX)
 * while preserving vertical & uniform components (dy, scaleX, scaleY, opacityDelta, bendY, squeezeY).
 */
export function reflectKeyformDeltas(
  keyforms: KeyformDelta[],
  parameter: RigParameter,
  direction: 'minToMax' | 'maxToMin'
): KeyformDelta[] {
  const center = parameter.defaultValue;
  const paramKfs = keyforms.filter((k) => k.parameterId === parameter.id);
  const others = keyforms.filter((k) => k.parameterId !== parameter.id);

  const sources = paramKfs.filter((k) =>
    direction === 'minToMax'
      ? k.keyformValue < center - 1e-4
      : k.keyformValue > center + 1e-4
  );

  if (sources.length === 0) return keyforms;

  // Keep center keyforms and source-side keyforms; replace destination-side keyforms
  const kept = paramKfs.filter((k) =>
    direction === 'minToMax'
      ? k.keyformValue <= center + 1e-4
      : k.keyformValue >= center - 1e-4
  );

  const mirrored: KeyformDelta[] = sources.map((src, idx) => {
    const rawMirrorVal = center + (center - src.keyformValue);
    const clampedMirrorVal = Number(
      Math.max(parameter.min, Math.min(parameter.max, rawMirrorVal)).toFixed(3)
    );
    return {
      ...src,
      id: `kf_reflect_${parameter.id}_${src.targetId}_${idx}_${clampedMirrorVal}`,
      keyformValue: clampedMirrorVal,
      dx: -src.dx,
      rotation: -src.rotation,
      skewX: -src.skewX,
      skewY: -src.skewY,
      meshWarp: {
        bendX: -src.meshWarp.bendX,
        bendY: src.meshWarp.bendY,
        squeezeX: -src.meshWarp.squeezeX,
        squeezeY: src.meshWarp.squeezeY,
      },
    };
  });

  return [...others, ...kept, ...mirrored];
}
