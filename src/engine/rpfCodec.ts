import type { CompositionState, RiokaPuppetEffect } from '../types/puppet';
import { evaluatePuppetRig, evaluateTrackAtFrame } from './rigging';
import {
  createInitialPhysicsState,
  createSettledPhysicsState,
  stepPhysicsSimulation,
} from './physics';
import { renderPuppetToCanvas } from './canvasRenderer';

/** Little-endian magic bytes "KRPF" (Rioka Pixel Frame) */
export const RPF_MAGIC = 0x4650524b;
export const RPF_HEADER_BYTES = 16;

export interface RpfHeader {
  magic: number;
  width: number;
  height: number;
  flags: number;
  pixelByteLength: number;
}

/**
 * Computes aspect-preserving HD dimensions for RPF export (even width/height, capped at maxEdge).
 */
export function computeRpfRenderDimensions(
  compWidth: number,
  compHeight: number,
  maxEdge = 1280
): { width: number; height: number } {
  const safeW = Math.max(16, Math.round(compWidth || 1920));
  const safeH = Math.max(16, Math.round(compHeight || 1080));
  const scale = Math.min(1, maxEdge / Math.max(safeW, safeH));
  const width = Math.max(16, Math.round((safeW * scale) / 2) * 2);
  const height = Math.max(16, Math.round((safeH * scale) / 2) * 2);
  return { width, height };
}

/**
 * Encodes straight RGBA8 canvas pixels into a zero-dependency 16-byte header + raw RGBA binary frame
 * readable in <2ms by RiokasPuppetingTools.aex in Adobe After Effects.
 */
export function encodeRgbaToRpf(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  flags = 1
): Uint8Array {
  const expectedBytes = width * height * 4;
  if (width <= 0 || height <= 0 || rgba.byteLength < expectedBytes) {
    throw new Error(
      `Invalid RPF pixel buffer: expected ${expectedBytes} bytes for ${width}x${height}.`
    );
  }
  const out = new Uint8Array(RPF_HEADER_BYTES + expectedBytes);
  const view = new DataView(out.buffer, out.byteOffset, RPF_HEADER_BYTES);
  view.setUint32(0, RPF_MAGIC, true);
  view.setUint32(4, width >>> 0, true);
  view.setUint32(8, height >>> 0, true);
  view.setUint32(12, flags >>> 0, true);
  out.set(
    rgba.byteLength === expectedBytes ? rgba : rgba.subarray(0, expectedBytes),
    RPF_HEADER_BYTES
  );
  return out;
}

/**
 * Decodes and validates an RPF binary header. Returns null if malformed or truncated.
 */
export function decodeRpfHeader(bytes: Uint8Array): RpfHeader | null {
  if (bytes.byteLength < RPF_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, RPF_HEADER_BYTES);
  const magic = view.getUint32(0, true);
  if (magic !== RPF_MAGIC) return null;
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  if (width === 0 || height === 0 || width > 8192 || height > 8192) return null;
  const pixelByteLength = width * height * 4;
  if (bytes.byteLength < RPF_HEADER_BYTES + pixelByteLength) return null;
  return { magic, width, height, flags, pixelByteLength };
}

/**
 * Builds a flat key=value metadata file (`applied_params.txt`) read directly by C++ in
 * RiokasPuppetingTools.aex without requiring a JSON parser, keeping AE Effect Control sliders
 * and animated frame sequence bounds in exact sync with Rioka Studio.
 */
export function buildAppliedParamsTxt(
  comp: CompositionState,
  effect: RiokaPuppetEffect,
  animatedFrameCount: number
): string {
  const lines: string[] = [
    `fps=${Math.max(1, Math.round(comp.fps || 30))}`,
    `frameCount=${Math.max(0, Math.round(animatedFrameCount))}`,
    `compWidth=${Math.max(16, Math.round(comp.width || 1920))}`,
    `compHeight=${Math.max(16, Math.round(comp.height || 1080))}`,
    `physicsEnabled=${effect.physicsEnabled ? 1 : 0}`,
    `physicsStrength=${effect.physicsStrength.toFixed(4)}`,
    `windStrength=${effect.windStrength.toFixed(4)}`,
    `autoBreath=${effect.autoBreath ? 1 : 0}`,
    `offsetX=${effect.offsetX.toFixed(2)}`,
    `offsetY=${effect.offsetY.toFixed(2)}`,
    `scale=${effect.scale.toFixed(2)}`,
    `rotation=${effect.rotation.toFixed(2)}`,
    `paramCount=${effect.puppet.parameters.length}`,
  ];
  effect.puppet.parameters.forEach((p, idx) => {
    lines.push(`param_${idx + 1}=${p.value.toFixed(4)}`);
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Renders the current puppet pose onto a clean transparent offscreen canvas and encodes it
 * into a binary `.rpf` frame for direct After Effects Solid Layer rendering.
 */
export function renderPuppetEffectToRpf(
  comp: CompositionState,
  effect: RiokaPuppetEffect,
  options?: {
    maxEdge?: number;
    frame?: number;
    useTrackValues?: boolean;
  }
): Uint8Array | null {
  if (typeof document === 'undefined') return null;
  const { width, height } = computeRpfRenderDimensions(
    comp.width,
    comp.height,
    options?.maxEdge ?? 1280
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const puppet = effect.puppet;
  const frame = options?.frame ?? comp.currentFrame;
  const paramValues: Record<string, number> = {};
  for (const p of puppet.parameters) {
    if (options?.useTrackValues) {
      paramValues[p.id] = evaluateTrackAtFrame(effect.tracks[p.id], frame, p.value);
    } else {
      paramValues[p.id] = p.value;
    }
  }

  const physState = createInitialPhysicsState(puppet.physicsGroups);
  const rigResult = evaluatePuppetRig(
    puppet,
    paramValues,
    puppet.physicsGroups,
    physState,
    effect.physicsEnabled ? effect.physicsStrength : 0
  );

  ctx.clearRect(0, 0, width, height);
  const baseScale = (height / puppet.modelHeight) * 0.94 * (effect.scale / 100);
  renderPuppetToCanvas(
    ctx,
    puppet,
    rigResult,
    puppet.physicsGroups,
    physState,
    {
      offsetX: width * 0.5 + effect.offsetX * (width / Math.max(1, comp.width)),
      offsetY: height * 0.5 + effect.offsetY * (height / Math.max(1, comp.height)),
      scale: baseScale,
      rotationDeg: effect.rotation,
    }
  );

  const imgData = ctx.getImageData(0, 0, width, height);
  return encodeRgbaToRpf(imgData.data, width, height, 1);
}

/**
 * Renders animated keyframed frames (with live pendulum physics stepping) into an RPF sequence
 * whenever the user has placed animation keyframes on the Studio timeline.
 */
export function renderAnimatedSequenceToRpf(
  comp: CompositionState,
  effect: RiokaPuppetEffect
): Array<{ frameIndex: number; rpf: Uint8Array }> {
  if (typeof document === 'undefined') return [];

  let maxKfFrame = -1;
  for (const track of Object.values(effect.tracks)) {
    if (track && track.keyframes.length > 0) {
      for (const kf of track.keyframes) {
        if (kf.frame > maxKfFrame) maxKfFrame = kf.frame;
      }
    }
  }
  if (maxKfFrame < 0) return [];

  const fps = Math.max(1, comp.fps || 30);
  // Include a brief physics settle tail after the last keyframe, bounded by composition duration
  const totalFrames = Math.min(
    comp.durationFrames + 1,
    Math.max(2, maxKfFrame + Math.round(fps * 0.4) + 1)
  );
  const maxEdge = totalFrames > 150 ? 1024 : 1280;
  const { width, height } = computeRpfRenderDimensions(
    comp.width,
    comp.height,
    maxEdge
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const puppet = effect.puppet;
  const dt = 1 / fps;

  // Evaluate frame-0 parameters first so pendulum physics starts settled with zero artificial kick
  const frame0Params: Record<string, number> = {};
  for (const p of puppet.parameters) {
    frame0Params[p.id] = evaluateTrackAtFrame(effect.tracks[p.id], 0, p.value);
  }
  if (effect.autoBreath) {
    const breath0 = 0.5 + 0.5 * Math.sin(0);
    frame0Params.ParamBreath = Math.max(
      frame0Params.ParamBreath ?? 0,
      breath0 * 0.7
    );
  }

  let physState = createSettledPhysicsState(puppet.physicsGroups, frame0Params);
  const baseScale = (height / puppet.modelHeight) * 0.94 * (effect.scale / 100);
  const offsetX =
    width * 0.5 + effect.offsetX * (width / Math.max(1, comp.width));
  const offsetY =
    height * 0.5 + effect.offsetY * (height / Math.max(1, comp.height));

  const results: Array<{ frameIndex: number; rpf: Uint8Array }> = [];

  for (let f = 0; f < totalFrames; f++) {
    const tSec = f * dt;
    const paramValues: Record<string, number> = {};
    for (const p of puppet.parameters) {
      paramValues[p.id] = evaluateTrackAtFrame(effect.tracks[p.id], f, p.value);
    }

    if (effect.autoBreath) {
      const breath = 0.5 + 0.5 * Math.sin(tSec * 2.0);
      paramValues.ParamBreath = Math.max(
        paramValues.ParamBreath ?? 0,
        breath * 0.7
      );
    }

    if (f > 0) {
      physState = stepPhysicsSimulation(puppet.physicsGroups, physState, {
        dt,
        time: tSec,
        paramValues,
        windStrength: effect.windStrength,
        windTurbulence: effect.windTurbulence,
        strengthMultiplier: effect.physicsEnabled ? effect.physicsStrength : 0,
      });
    }

    const rigResult = evaluatePuppetRig(
      puppet,
      paramValues,
      puppet.physicsGroups,
      physState,
      effect.physicsEnabled ? effect.physicsStrength : 0
    );

    ctx.clearRect(0, 0, width, height);
    renderPuppetToCanvas(
      ctx,
      puppet,
      rigResult,
      puppet.physicsGroups,
      physState,
      {
        offsetX,
        offsetY,
        scale: baseScale,
        rotationDeg: effect.rotation,
      }
    );

    const imgData = ctx.getImageData(0, 0, width, height);
    results.push({
      frameIndex: f,
      rpf: encodeRgbaToRpf(imgData.data, width, height, 1),
    });
  }

  return results;
}
