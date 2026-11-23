import type { CompositionState, RiokaPuppetEffect } from '../types/puppet';
import { evaluatePuppetRig, evaluateTrackAtFrame } from './rigging';
import { createInitialPhysicsState, stepPhysicsSimulation } from './physics';
import { renderPuppetToCanvas } from './canvasRenderer';

// ---------------------------------------------------------------------------
// Pure Lossless QuickTime .MOV (32-bit Uncompressed ARGB / RGBA Alpha) Muxer
// ---------------------------------------------------------------------------

function writeU32(view: DataView, offset: number, val: number): void {
  view.setUint32(offset, val >>> 0, false);
}

function writeU16(view: DataView, offset: number, val: number): void {
  view.setUint16(offset, val & 0xffff, false);
}

function makeAtom(type: string, payloadParts: Uint8Array[]): Uint8Array {
  let payloadLen = 0;
  for (const p of payloadParts) payloadLen += p.length;
  const total = 8 + payloadLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  writeU32(view, 0, total);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let cursor = 8;
  for (const p of payloadParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

/**
 * Converts browser ImageData RGBA bytes into QuickTime 32-bit ARGB (lossless raw) pixels.
 */
export function rgbaToQuickTimeArgb(rgba: Uint8Array): Uint8Array {
  const argb = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    argb[i] = rgba[i + 3]; // A
    argb[i + 1] = rgba[i]; // R
    argb[i + 2] = rgba[i + 1]; // G
    argb[i + 3] = rgba[i + 2]; // B
  }
  return argb;
}

/**
 * Converts an RGBA frame into an Alpha-Only grayscale RGBA frame (R=A, G=A, B=A, A=255)
 * for After Effects Track Matte / Double MP4 workflows.
 */
export function rgbaToAlphaMattePixels(rgba: Uint8Array): Uint8Array {
  const matte = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    matte[i] = a;
    matte[i + 1] = a;
    matte[i + 2] = a;
    matte[i + 3] = 255;
  }
  return matte;
}

/**
 * Packages raw 32-bit RGBA frames into a valid, lossless QuickTime .MOV container
 * using 32-bit uncompressed ARGB ('raw ' codec, depth 32 = full alpha channel for After Effects).
 */
export function buildLosslessRgbaMovBytes(
  rgbaFrames: Uint8Array[],
  width: number,
  height: number,
  fps: number
): Uint8Array {
  const safeFps = Math.max(1, Math.round(fps));
  const timeScale = safeFps * 100;
  const sampleDuration = 100;
  const frameCount = Math.max(1, rgbaFrames.length);
  const totalDuration = frameCount * sampleDuration;
  const frameSize = width * height * 4;

  // ftyp atom (QuickTime)
  const ftypPayload = new Uint8Array(12);
  ftypPayload.set([0x71, 0x74, 0x20, 0x20], 0); // 'qt  '
  // minor version 0 (4 bytes)
  ftypPayload.set([0x71, 0x74, 0x20, 0x20], 8); // compatible 'qt  '
  const ftyp = makeAtom('ftyp', [ftypPayload]);

  // Convert RGBA -> QuickTime ARGB for mdat
  const argbFrames = rgbaFrames.map((f) => rgbaToQuickTimeArgb(f));
  const mdat = makeAtom('mdat', argbFrames);
  const mdatDataOffset = ftyp.length + 8;

  // mvhd (100 bytes payload)
  const mvhdPayload = new Uint8Array(100);
  const mvhdView = new DataView(mvhdPayload.buffer);
  writeU32(mvhdView, 12, timeScale);
  writeU32(mvhdView, 16, totalDuration);
  writeU32(mvhdView, 20, 0x00010000); // rate 1.0
  writeU16(mvhdView, 24, 0x0100); // volume 1.0
  // identity matrix at offset 36
  writeU32(mvhdView, 36, 0x00010000);
  writeU32(mvhdView, 52, 0x00010000);
  writeU32(mvhdView, 68, 0x40000000);
  writeU32(mvhdView, 96, 2); // nextTrackId
  const mvhd = makeAtom('mvhd', [mvhdPayload]);

  // tkhd (84 bytes payload)
  const tkhdPayload = new Uint8Array(84);
  const tkhdView = new DataView(tkhdPayload.buffer);
  writeU32(tkhdView, 0, 0x0000000f); // version 0, flags = enabled+inMovie+inPreview
  writeU32(tkhdView, 12, 1); // track ID
  writeU32(tkhdView, 20, totalDuration);
  writeU32(tkhdView, 40, 0x00010000);
  writeU32(tkhdView, 56, 0x00010000);
  writeU32(tkhdView, 72, 0x40000000);
  writeU32(tkhdView, 76, width << 16);
  writeU32(tkhdView, 80, height << 16);
  const tkhd = makeAtom('tkhd', [tkhdPayload]);

  // mdhd (24 bytes payload)
  const mdhdPayload = new Uint8Array(24);
  const mdhdView = new DataView(mdhdPayload.buffer);
  writeU32(mdhdView, 12, timeScale);
  writeU32(mdhdView, 16, totalDuration);
  const mdhd = makeAtom('mdhd', [mdhdPayload]);

  // hdlr (vide)
  const hdlrPayload = new Uint8Array(25);
  hdlrPayload.set([0x6d, 0x68, 0x6c, 0x72], 4); // 'mhlr'
  hdlrPayload.set([0x76, 0x69, 0x64, 0x65], 8); // 'vide'
  const hdlr = makeAtom('hdlr', [hdlrPayload]);

  // vmhd
  const vmhdPayload = new Uint8Array(12);
  vmhdPayload[3] = 1; // flags = 1
  const vmhd = makeAtom('vmhd', [vmhdPayload]);

  // dinf -> dref -> alis
  const alis = makeAtom('alis', [new Uint8Array([0, 0, 0, 1])]);
  const drefHead = new Uint8Array(8);
  writeU32(new DataView(drefHead.buffer), 4, 1);
  const dref = makeAtom('dref', [drefHead, alis]);
  const dinf = makeAtom('dinf', [dref]);

  // stsd -> 'raw ' 32-bit ARGB sample entry (86 bytes)
  const rawEntry = new Uint8Array(86);
  const rawView = new DataView(rawEntry.buffer);
  writeU32(rawView, 0, 86);
  rawEntry.set([0x72, 0x61, 0x77, 0x20], 4); // 'raw '
  writeU16(rawView, 14, 1); // data ref index
  writeU16(rawView, 32, width);
  writeU16(rawView, 34, height);
  writeU32(rawView, 36, 0x00480000); // 72 dpi horiz
  writeU32(rawView, 40, 0x00480000); // 72 dpi vert
  writeU16(rawView, 48, 1); // frame count
  writeU16(rawView, 82, 32); // 32-bit RGBA depth (with alpha!)
  writeU16(rawView, 84, 0xffff); // color table id -1

  const stsdHead = new Uint8Array(8);
  writeU32(new DataView(stsdHead.buffer), 4, 1);
  const stsd = makeAtom('stsd', [stsdHead, rawEntry]);

  // stts
  const sttsPayload = new Uint8Array(16);
  const sttsView = new DataView(sttsPayload.buffer);
  writeU32(sttsView, 4, 1);
  writeU32(sttsView, 8, frameCount);
  writeU32(sttsView, 12, sampleDuration);
  const stts = makeAtom('stts', [sttsPayload]);

  // stsc (1 sample per chunk)
  const stscPayload = new Uint8Array(20);
  const stscView = new DataView(stscPayload.buffer);
  writeU32(stscView, 4, 1);
  writeU32(stscView, 8, 1);
  writeU32(stscView, 12, 1);
  writeU32(stscView, 16, 1);
  const stsc = makeAtom('stsc', [stscPayload]);

  // stsz (uniform frame size)
  const stszPayload = new Uint8Array(12);
  const stszView = new DataView(stszPayload.buffer);
  writeU32(stszView, 4, frameSize);
  writeU32(stszView, 8, frameCount);
  const stsz = makeAtom('stsz', [stszPayload]);

  // stco (chunk offsets into mdat)
  const stcoPayload = new Uint8Array(8 + frameCount * 4);
  const stcoView = new DataView(stcoPayload.buffer);
  writeU32(stcoView, 4, frameCount);
  for (let i = 0; i < frameCount; i++) {
    writeU32(stcoView, 8 + i * 4, mdatDataOffset + i * frameSize);
  }
  const stco = makeAtom('stco', [stcoPayload]);

  const stbl = makeAtom('stbl', [stsd, stts, stsc, stsz, stco]);
  const minf = makeAtom('minf', [vmhd, dinf, stbl]);
  const mdia = makeAtom('mdia', [mdhd, hdlr, minf]);
  const trak = makeAtom('trak', [tkhd, mdia]);
  const moov = makeAtom('moov', [mvhd, trak]);

  return concatBytes([ftyp, mdat, moov]);
}

// ---------------------------------------------------------------------------
// Browser Render Pipelines: Lossless .MOV (RGBA) & Double MP4 (RGB + Alpha)
// ---------------------------------------------------------------------------

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function renderSinglePuppetFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effect: RiokaPuppetEffect,
  frame: number,
  fps: number,
  physicsState: ReturnType<typeof createInitialPhysicsState>,
  fillBackgroundColor: string | null
): ReturnType<typeof createInitialPhysicsState> {
  const puppet = effect.puppet;
  const dt = 1 / Math.max(1, fps);
  const elapsedSec = frame * dt;

  ctx.clearRect(0, 0, width, height);
  if (fillBackgroundColor) {
    ctx.fillStyle = fillBackgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  const paramValues: Record<string, number> = {};
  for (const p of puppet.parameters) {
    paramValues[p.id] = evaluateTrackAtFrame(effect.tracks[p.id], frame, p.value);
  }

  if (effect.autoBreath) {
    const breathCycle = 0.5 + 0.5 * Math.sin(elapsedSec * 2.1);
    paramValues.ParamBreath = Math.max(
      paramValues.ParamBreath ?? 0,
      breathCycle * 0.85
    );
  }

  const nextPhys = stepPhysicsSimulation(puppet.physicsGroups, physicsState, {
    dt,
    time: elapsedSec,
    paramValues,
    windStrength: effect.windStrength,
    windTurbulence: effect.windTurbulence,
    strengthMultiplier: effect.physicsEnabled ? effect.physicsStrength : 0,
  });

  const rigResult = evaluatePuppetRig(
    puppet,
    paramValues,
    puppet.physicsGroups,
    nextPhys,
    effect.physicsEnabled ? effect.physicsStrength : 0
  );

  const baseScale = (height / puppet.modelHeight) * 0.94 * (effect.scale / 100);
  renderPuppetToCanvas(ctx, puppet, rigResult, puppet.physicsGroups, nextPhys, {
    offsetX: width * 0.5 + effect.offsetX * (width / 1920),
    offsetY: height * 0.52 + effect.offsetY * (height / 1080),
    scale: baseScale,
    rotationDeg: effect.rotation,
  });

  return nextPhys;
}

/**
 * Renders the active puppet animation into a lossless 32-bit RGBA QuickTime .MOV file
 * (preserving full alpha transparency for direct import into After Effects).
 */
export async function exportLosslessMovAnimation(
  composition: CompositionState,
  effect: RiokaPuppetEffect,
  onProgress?: (pct: number) => void
): Promise<string> {
  // Use crisp 640x360 lossless frame cap in browser memory so 180 RGBA frames stay fast & reliable
  const width = 640;
  const height = 360;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Unable to initialize 2D canvas for .MOV export.');

  const totalFrames = Math.min(composition.durationFrames, 90);
  let phys = createInitialPhysicsState(effect.puppet.physicsGroups);
  const frames: Uint8Array[] = [];

  for (let f = 0; f <= totalFrames; f++) {
    phys = renderSinglePuppetFrameToCanvas(
      ctx,
      width,
      height,
      effect,
      f,
      composition.fps,
      phys,
      null
    );
    const img = ctx.getImageData(0, 0, width, height);
    frames.push(new Uint8Array(img.data));
    if (onProgress && f % 6 === 0) {
      onProgress(Math.round((f / Math.max(1, totalFrames)) * 90));
      await new Promise((r) => window.setTimeout(r, 0));
    }
  }

  const movBytes = buildLosslessRgbaMovBytes(
    frames,
    width,
    height,
    composition.fps
  );
  const safeName = effect.puppet.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${safeName}_Lossless_RGBA_${composition.fps}fps.mov`;
  const movBuffer = movBytes.buffer.slice(
    movBytes.byteOffset,
    movBytes.byteOffset + movBytes.byteLength
  ) as ArrayBuffer;
  triggerBlobDownload(new Blob([movBuffer], { type: 'video/quicktime' }), fileName);
  onProgress?.(100);
  return fileName;
}

function pickSupportedH264Mime(): { mimeType: string; ext: string } {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/mp4', ext: 'mp4' };
  }
  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=h264', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: '', ext: 'mp4' };
}

/**
 * Renders Double MP4 output:
 *  1) H.264 RGB color pass (premultiplied over black)
 *  2) H.264 Alpha Only matte pass (grayscale luma matte for AE Track Matte)
 * Both encoded at the user's requested bitrate (Mbps).
 */
export async function exportDoubleMp4Animation(
  composition: CompositionState,
  effect: RiokaPuppetEffect,
  bitrateMbps: number,
  onProgress?: (pct: number) => void
): Promise<{ rgbFile: string; alphaFile: string; bitrateMbps: number }> {
  const width = 1280;
  const height = 720;
  const rgbCanvas = document.createElement('canvas');
  rgbCanvas.width = width;
  rgbCanvas.height = height;
  const rgbCtx = rgbCanvas.getContext('2d', { willReadFrequently: true });

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = width;
  alphaCanvas.height = height;
  const alphaCtx = alphaCanvas.getContext('2d');

  if (!rgbCtx || !alphaCtx) {
    throw new Error('Unable to initialize export canvases.');
  }

  const { mimeType, ext } = pickSupportedH264Mime();
  const safeBitrate = Math.max(1, Math.min(80, bitrateMbps));
  const videoBitsPerSecond = Math.round(safeBitrate * 1_000_000);
  const fps = Math.max(1, composition.fps);

  const rgbStream = rgbCanvas.captureStream(fps);
  const alphaStream = alphaCanvas.captureStream(fps);

  const recOpts: MediaRecorderOptions = mimeType
    ? { mimeType, videoBitsPerSecond }
    : { videoBitsPerSecond };

  const rgbRec = new MediaRecorder(rgbStream, recOpts);
  const alphaRec = new MediaRecorder(alphaStream, recOpts);

  const rgbChunks: Blob[] = [];
  const alphaChunks: Blob[] = [];
  rgbRec.ondataavailable = (e) => {
    if (e.data.size > 0) rgbChunks.push(e.data);
  };
  alphaRec.ondataavailable = (e) => {
    if (e.data.size > 0) alphaChunks.push(e.data);
  };

  const rgbDone = new Promise<Blob>((resolve) => {
    rgbRec.onstop = () =>
      resolve(new Blob(rgbChunks, { type: mimeType || 'video/mp4' }));
  });
  const alphaDone = new Promise<Blob>((resolve) => {
    alphaRec.onstop = () =>
      resolve(new Blob(alphaChunks, { type: mimeType || 'video/mp4' }));
  });

  rgbRec.start();
  alphaRec.start();

  // Render at brisk stepped cadence (capped cleanly for interactive download speed)
  const totalFrames = Math.min(composition.durationFrames, 120);
  const stepMs = Math.max(12, Math.round(1000 / Math.min(60, fps)));
  let phys = createInitialPhysicsState(effect.puppet.physicsGroups);

  for (let f = 0; f <= totalFrames; f++) {
    // 1. Render transparent puppet to read exact alpha channel
    phys = renderSinglePuppetFrameToCanvas(
      rgbCtx,
      width,
      height,
      effect,
      f,
      fps,
      phys,
      null
    );
    const rgbaData = rgbCtx.getImageData(0, 0, width, height);

    // 2. Write Alpha-Only Matte pass (R=A, G=A, B=A, A=255)
    const mattePixels = rgbaToAlphaMattePixels(new Uint8Array(rgbaData.data));
    const matteImage = new ImageData(
      new Uint8ClampedArray(mattePixels),
      width,
      height
    );
    alphaCtx.putImageData(matteImage, 0, 0);

    // 3. Composite RGB pass cleanly onto solid black for clean H.264 RGB encoding
    rgbCtx.save();
    rgbCtx.globalCompositeOperation = 'destination-over';
    rgbCtx.fillStyle = '#000000';
    rgbCtx.fillRect(0, 0, width, height);
    rgbCtx.restore();

    if (onProgress && f % 4 === 0) {
      onProgress(Math.round((f / Math.max(1, totalFrames)) * 95));
    }
    await new Promise((r) => window.setTimeout(r, stepMs));
  }

  rgbRec.stop();
  alphaRec.stop();
  const [rgbBlob, alphaBlob] = await Promise.all([rgbDone, alphaDone]);

  const safeName = effect.puppet.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const rgbFile = `${safeName}_RGB_H264_${safeBitrate}Mbps.${ext}`;
  const alphaFile = `${safeName}_AlphaOnly_H264_${safeBitrate}Mbps.${ext}`;

  triggerBlobDownload(rgbBlob, rgbFile);
  window.setTimeout(() => triggerBlobDownload(alphaBlob, alphaFile), 350);
  onProgress?.(100);

  return { rgbFile, alphaFile, bitrateMbps: safeBitrate };
}
