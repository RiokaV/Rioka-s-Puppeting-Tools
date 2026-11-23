import type {
  ArtMeshLayer,
  BasicMorphLattice,
  KeyformDelta,
  MorphPinPoint,
  ParameterTrack,
  RigParameter,
  TimelineKeyframe,
} from '../types/puppet';

export function createDefaultBasicLattice(
  cols = 3,
  rows = 3
): BasicMorphLattice {
  return {
    cols,
    rows,
    offsets: Array.from({ length: (cols + 1) * (rows + 1) }, () => ({
      dx: 0,
      dy: 0,
    })),
  };
}

/**
 * Computes the smooth displacement at normalized layer coordinates (u, v) in [0..1]
 * produced by the Basic Morphing lattice box (bilinear grid interpolation across control cells).
 */
export function evaluateBasicLatticeDisplacement(
  lattice: BasicMorphLattice | undefined,
  u: number,
  v: number
): { dx: number; dy: number } {
  if (!lattice || lattice.offsets.length === 0) return { dx: 0, dy: 0 };
  const cols = Math.max(1, lattice.cols);
  const rows = Math.max(1, lattice.rows);
  const clampedU = Math.max(0, Math.min(1, u));
  const clampedV = Math.max(0, Math.min(1, v));

  const gx = clampedU * cols;
  const gy = clampedV * rows;
  const c0 = Math.min(cols - 1, Math.floor(gx));
  const r0 = Math.min(rows - 1, Math.floor(gy));
  const tx = gx - c0;
  const ty = gy - r0;

  const stride = cols + 1;
  const o00 = lattice.offsets[r0 * stride + c0] ?? { dx: 0, dy: 0 };
  const o10 = lattice.offsets[r0 * stride + c0 + 1] ?? { dx: 0, dy: 0 };
  const o01 = lattice.offsets[(r0 + 1) * stride + c0] ?? { dx: 0, dy: 0 };
  const o11 = lattice.offsets[(r0 + 1) * stride + c0 + 1] ?? { dx: 0, dy: 0 };

  const dx =
    (1 - tx) * (1 - ty) * o00.dx +
    tx * (1 - ty) * o10.dx +
    (1 - tx) * ty * o01.dx +
    tx * ty * o11.dx;
  const dy =
    (1 - tx) * (1 - ty) * o00.dy +
    tx * (1 - ty) * o10.dy +
    (1 - tx) * ty * o01.dy +
    tx * ty * o11.dy;

  return { dx, dy };
}

export const PIN_GIZMO_BASE_RING_PX = 46;
export const PIN_GIZMO_MIN_RING_PX = 30;
export const PIN_GIZMO_MAX_RING_PX = 128;
export const PIN_MIN_SCALE = 0.25;
export const PIN_MAX_SCALE = 3.0;

/**
 * Returns true if a morph pin has any active movement, rotation, or scale deformation.
 * Unmoved pins act as fixed anchor points unaffected by other pins.
 */
export function isMorphPinMoved(pin: MorphPinPoint): boolean {
  const rot = pin.rotation ?? 0;
  const sc = pin.scale ?? 1;
  return (
    Math.abs(pin.dx) > 0.001 ||
    Math.abs(pin.dy) > 0.001 ||
    Math.abs(rot) > 0.001 ||
    Math.abs(sc - 1) > 0.0005
  );
}

export const MESH_MIN_SUBDIV = 1;
export const MESH_MAX_SUBDIV = 24;

/**
 * Clamps a user-customized mesh subdivision count (columns or rows) safely into [1, 24].
 */
export function clampMeshDimension(raw: number | string, fallback = 4): number {
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num)) return Math.max(MESH_MIN_SUBDIV, Math.min(MESH_MAX_SUBDIV, Math.round(fallback)));
  return Math.max(MESH_MIN_SUBDIV, Math.min(MESH_MAX_SUBDIV, Math.round(num)));
}

export interface MorphPinGizmoGeometry {
  centerX: number;
  centerY: number;
  ringRadius: number;
  centerDotRadius: number;
  /** Hollow green square ON the outer circle ring (Scale up/down) */
  scaleBoxX: number;
  scaleBoxY: number;
  scaleBoxHalf: number;
  /** Filled blue square inside the ring along the pin axis (Rotate) */
  rotHandleX: number;
  rotHandleY: number;
  rotSquareHalf: number;
  /** Radial direction angle in radians (at rotation=0 points straight up: -PI/2) */
  angleRad: number;
  totalRotationDeg: number;
}

/**
 * Computes the on-canvas Advanced Pin gizmo geometry in model coordinates:
 * - Center green dot (Move)
 * - Outer green circle ring + hollow green box on the circle (Scale up/down via box, Rotate via ring)
 * - Filled blue square inside the ring along the up-axis (Rotate)
 */
export function computeMorphPinGizmoGeometry(
  center: { x: number; y: number },
  pinRotationDeg: number,
  pinScale: number,
  viewportScale: number,
  baseWorldRotationDeg = 0
): MorphPinGizmoGeometry {
  const invS = 1 / Math.max(0.05, viewportScale);
  const clampedScale = Math.max(
    PIN_MIN_SCALE,
    Math.min(PIN_MAX_SCALE, Number.isFinite(pinScale) ? pinScale : 1)
  );
  const totalRotationDeg = baseWorldRotationDeg + (pinRotationDeg || 0);
  const angleRad = ((totalRotationDeg - 90) * Math.PI) / 180;
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);

  const ringRadiusPx = Math.max(
    PIN_GIZMO_MIN_RING_PX,
    Math.min(PIN_GIZMO_MAX_RING_PX, PIN_GIZMO_BASE_RING_PX * clampedScale)
  );
  const ringRadius = ringRadiusPx * invS;
  const centerDotRadius = 6.5 * invS;
  const scaleBoxHalf = 5.2 * invS;
  const rotSquareHalf = 4.4 * invS;

  // Blue square sits cleanly between the center green dot and the top hollow green box
  const blueDistPx = Math.max(
    15.5,
    Math.min(ringRadiusPx - 12.5, ringRadiusPx * 0.38)
  );
  const blueDist = blueDistPx * invS;

  return {
    centerX: center.x,
    centerY: center.y,
    ringRadius,
    centerDotRadius,
    scaleBoxX: center.x + dirX * ringRadius,
    scaleBoxY: center.y + dirY * ringRadius,
    scaleBoxHalf,
    rotHandleX: center.x + dirX * blueDist,
    rotHandleY: center.y + dirY * blueDist,
    rotSquareHalf,
    angleRad,
    totalRotationDeg,
  };
}

/**
 * Hit-tests the Advanced Pin gizmo handles in model space:
 * - 'move': center green circle
 * - 'scale': hollow green box ON the outer circle ring (drag inward/outward to scale up/down)
 * - 'rotate': filled blue square inside the ring OR outer green circle ring
 */
export function hitTestMorphPinGizmo(
  pointer: { x: number; y: number },
  geom: MorphPinGizmoGeometry,
  viewportScale: number
): 'move' | 'rotate' | 'scale' | 'none' {
  const invS = 1 / Math.max(0.05, viewportScale);
  const centerHitR = 12 * invS;
  const blueHitR = 11 * invS;
  const scaleBoxHitR = 16 * invS;
  const ringStrokeTol = 10 * invS;

  const dCenter = Math.hypot(
    pointer.x - geom.centerX,
    pointer.y - geom.centerY
  );
  if (dCenter <= centerHitR) {
    return 'move';
  }

  // Hollow green box on the circle -> Scale up and down
  const dScaleBox = Math.hypot(
    pointer.x - geom.scaleBoxX,
    pointer.y - geom.scaleBoxY
  );
  if (dScaleBox <= scaleBoxHitR) {
    return 'scale';
  }

  // Filled blue square inside the ring -> Rotate
  const dBlue = Math.hypot(
    pointer.x - geom.rotHandleX,
    pointer.y - geom.rotHandleY
  );
  if (dBlue <= blueHitR) {
    return 'rotate';
  }

  // Outer green circle ring -> Rotate
  if (Math.abs(dCenter - geom.ringRadius) <= ringStrokeTol) {
    return 'rotate';
  }

  return 'none';
}

/**
 * Computes new uniform pin scale from dragging the hollow green box on the circle inward/outward.
 * Radial distance changes map 1-to-1 with PIN_GIZMO_BASE_RING_PX so the green circle tracks the cursor.
 */
export function computeMorphPinScaleFromPointer(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  startDistModel: number,
  startScale: number,
  viewportScale: number
): number {
  const safeVpScale = Math.max(0.05, viewportScale);
  const currDistModel = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  const deltaScreenPx = (currDistModel - startDistModel) * safeVpScale;
  const raw = startScale + deltaScreenPx / PIN_GIZMO_BASE_RING_PX;
  const clamped = Math.max(PIN_MIN_SCALE, Math.min(PIN_MAX_SCALE, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * Computes new pin rotation (degrees) from dragging the filled blue square or outer green ring.
 */
export function computeMorphPinRotationFromPointer(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  startPointerAngleDeg: number,
  startPinRotationDeg: number
): number {
  const vx = pointer.x - center.x;
  const vy = pointer.y - center.y;
  if (Math.hypot(vx, vy) < 1e-4) return startPinRotationDeg;
  const currAngleDeg = (Math.atan2(vy, vx) * 180) / Math.PI;
  const delta = normalizeAngleDeg(currAngleDeg - startPointerAngleDeg);
  return Math.round(normalizeAngleDeg(startPinRotationDeg + delta) * 10) / 10;
}

/**
 * Computes smooth mesh deformation from custom Morph Pins supporting Move (dx/dy),
 * Rotation (degrees), and Uniform Scale around each pin.
 *
 * Anchor behavior:
 * - Moving a pin's restU/restV (via Add Morph Point tool) leaves dx/dy=0, rot=0, scale=1
 *   so the mesh does NOT deform.
 * - When 2+ pins exist, ALL pins (both moved and unmoved) participate in an inverse-distance
 *   weighted partition of unity (p=3) with exact interpolation at every pin. Consequently, any
 *   unmoved pin acts as a fixed anchor point (displacement strictly 0,0) and its surrounding area
 *   is locked in place, unaffected by other moved/rotated/scaled pins.
 */
export function evaluateMorphPinsDisplacement(
  pins: MorphPinPoint[] | undefined,
  u: number,
  v: number,
  layerWidth: number,
  layerHeight: number
): { dx: number; dy: number } {
  if (!pins || pins.length === 0) return { dx: 0, dy: 0 };

  let anyMoved = false;
  for (const pin of pins) {
    if (isMorphPinMoved(pin)) {
      anyMoved = true;
      break;
    }
  }
  if (!anyMoved) return { dx: 0, dy: 0 };

  const w = Math.max(1, layerWidth);
  const h = Math.max(1, layerHeight);
  const maxDim = Math.max(w, h);
  const qx = u * w;
  const qy = v * h;

  const computePinLocalDisp = (pin: MorphPinPoint) => {
    const px = pin.restU * w;
    const py = pin.restV * h;
    const rx = qx - px;
    const ry = qy - py;
    const rotDeg = pin.rotation ?? 0;
    const sc = pin.scale ?? 1;
    if (Math.abs(rotDeg) < 1e-4 && Math.abs(sc - 1) < 1e-4) {
      return { dx: pin.dx, dy: pin.dy };
    }
    const rotRad = (rotDeg * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    const tx = (rx * cosR - ry * sinR) * sc;
    const ty = (rx * sinR + ry * cosR) * sc;
    return {
      dx: pin.dx + (tx - rx),
      dy: pin.dy + (ty - ry),
    };
  };

  // Single pin: localized smooth Gaussian falloff around the pin
  if (pins.length === 1) {
    const pin = pins[0];
    const du = (u - pin.restU) * (w / maxDim);
    const dv = (v - pin.restV) * (h / maxDim);
    const distSq = du * du + dv * dv;
    const sigma = 0.28;
    const weight = Math.exp(-distSq / (2 * sigma * sigma));
    const disp = computePinLocalDisp(pin);
    return { dx: disp.dx * weight, dy: disp.dy * weight };
  }

  // Multiple pins: exact interpolation at every pin + cubic IDW partition of unity
  // so unmoved pins act as fixed anchor points completely unaffected by other pins.
  const EPS_DIST_SQ = 1e-10;
  let exactCount = 0;
  let exactDx = 0;
  let exactDy = 0;
  for (const pin of pins) {
    const du = (u - pin.restU) * (w / maxDim);
    const dv = (v - pin.restV) * (h / maxDim);
    const distSq = du * du + dv * dv;
    if (distSq <= EPS_DIST_SQ) {
      const disp = computePinLocalDisp(pin);
      exactDx += disp.dx;
      exactDy += disp.dy;
      exactCount++;
    }
  }
  if (exactCount > 0) {
    return { dx: exactDx / exactCount, dy: exactDy / exactCount };
  }

  let totalDx = 0;
  let totalDy = 0;
  let weightSum = 0;

  for (const pin of pins) {
    const du = (u - pin.restU) * (w / maxDim);
    const dv = (v - pin.restV) * (h / maxDim);
    const dist = Math.hypot(du, dv);
    const invW = 1 / (dist * dist * dist);
    const disp = computePinLocalDisp(pin);
    totalDx += disp.dx * invW;
    totalDy += disp.dy * invW;
    weightSum += invW;
  }

  if (weightSum <= 1e-9) return { dx: 0, dy: 0 };
  return { dx: totalDx / weightSum, dy: totalDy / weightSum };
}

/**
 * Applies a Brush Morph stroke to a layer's mesh vertices in model space.
 * Hardness (0..1) controls the falloff sharpness from center to radius edge.
 */
export function applyBrushMorphToOffsets(
  layer: ArtMeshLayer,
  vertexWorldPositions: Array<{ x: number; y: number }>,
  brushX: number,
  brushY: number,
  deltaX: number,
  deltaY: number,
  brushRadius: number,
  brushHardness: number // 0.05..1
): Array<{ dx: number; dy: number }> {
  const radius = Math.max(8, brushRadius);
  const hardness = Math.max(0.05, Math.min(1, brushHardness));

  return layer.vertexOffsets.map((off, idx) => {
    const vp = vertexWorldPositions[idx];
    if (!vp) return off;
    const dist = Math.hypot(vp.x - brushX, vp.y - brushY);
    if (dist >= radius) return off;

    const normDist = dist / radius; // 0 at center, 1 at edge
    // Smoothstep modulated by hardness
    const falloff =
      normDist <= hardness
        ? 1
        : Math.max(0, 1 - (normDist - hardness) / Math.max(0.001, 1 - hardness));
    const smooth = falloff * falloff * (3 - 2 * falloff);
    return {
      dx: off.dx + deltaX * smooth,
      dy: off.dy + deltaY * smooth,
    };
  });
}

/**
 * Applies Live2D-style 2-point, 3-point, or Clear keyform presets on a parameter for a target.
 */
export function applyKeyformPresetToParameter(
  param: RigParameter,
  keyforms: KeyformDelta[],
  targetType: 'deformer' | 'layer',
  targetId: string,
  preset: '2point' | '3point' | 'clear',
  scope: 'target' | 'parameter' = 'target'
): { parameter: RigParameter; keyforms: KeyformDelta[] } {
  const filtered = keyforms.filter((k) => {
    if (k.parameterId !== param.id) return true;
    if (preset === 'clear' && scope === 'parameter') return false;
    return !(k.targetType === targetType && k.targetId === targetId);
  });

  if (preset === 'clear') {
    const stillHasAny = filtered.some((k) => k.parameterId === param.id);
    return {
      parameter:
        scope === 'parameter' || !stillHasAny
          ? { ...param, keyforms: [] }
          : param,
      keyforms: filtered,
    };
  }

  const points =
    preset === '2point'
      ? [param.min, param.max]
      : [param.min, param.defaultValue, param.max];

  const uniqueSorted = Array.from(new Set([...param.keyforms, ...points])).sort(
    (a, b) => a - b
  );

  const additions: KeyformDelta[] = points.map((val, idx) => ({
    id: `kf_preset_${param.id}_${targetId}_${idx}_${val}`,
    parameterId: param.id,
    keyformValue: val,
    targetType,
    targetId,
    dx: 0,
    dy: 0,
    rotation: 0,
    scaleX: 0,
    scaleY: 0,
    skewX: 0,
    skewY: 0,
    opacityDelta: 0,
    meshWarp: { bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 },
  }));

  return {
    parameter: { ...param, keyforms: uniqueSorted },
    keyforms: [...filtered, ...additions],
  };
}

export interface ParameterKeyformPointStatus {
  value: number;
  isBound: boolean;
  isBoundToLayer: boolean;
}

export interface ParameterKeyformStatus {
  hasAnyKeyform: boolean;
  hasLayerKeyform: boolean;
  boundValues: number[];
  layerBoundValues: number[];
  displayPoints: ParameterKeyformPointStatus[];
}

/**
 * Computes which keyform points exist on a parameter (parameter-wide bound points turn the
 * parameter & points blue; parameters with no bound points stay neutral gray).
 * Also tracks `layerBoundValues` / `hasLayerKeyform` for the currently selected layer.
 */
export function getParameterKeyformStatus(
  keyforms: KeyformDelta[],
  selectedLayer: ArtMeshLayer | undefined,
  param: RigParameter
): ParameterKeyformStatus {
  const boundValues: number[] = [];
  const layerBoundValues: number[] = [];

  for (const kf of keyforms) {
    if (kf.parameterId !== param.id) continue;
    if (!boundValues.some((v) => Math.abs(v - kf.keyformValue) < 1e-3)) {
      boundValues.push(kf.keyformValue);
    }
    if (selectedLayer) {
      const matchesLayer =
        kf.targetType === 'layer' && kf.targetId === selectedLayer.id;
      const matchesDeformer =
        kf.targetType === 'deformer' &&
        Boolean(selectedLayer.parentDeformerId) &&
        kf.targetId === selectedLayer.parentDeformerId;
      if (
        (matchesLayer || matchesDeformer) &&
        !layerBoundValues.some((v) => Math.abs(v - kf.keyformValue) < 1e-3)
      ) {
        layerBoundValues.push(kf.keyformValue);
      }
    }
  }

  boundValues.sort((a, b) => a - b);
  layerBoundValues.sort((a, b) => a - b);

  // Merge parameter guide points + any bound keyform values into a deduplicated sorted list
  const mergedValues: number[] = [];
  for (const val of [...param.keyforms, ...boundValues]) {
    if (!mergedValues.some((v) => Math.abs(v - val) < 1e-3)) {
      mergedValues.push(val);
    }
  }
  mergedValues.sort((a, b) => a - b);

  const displayPoints: ParameterKeyformPointStatus[] = mergedValues.map(
    (value) => ({
      value,
      isBound: boundValues.some((bv) => Math.abs(bv - value) < 1e-3),
      isBoundToLayer: layerBoundValues.some((bv) => Math.abs(bv - value) < 1e-3),
    })
  );

  return {
    hasAnyKeyform: boundValues.length > 0,
    hasLayerKeyform: layerBoundValues.length > 0,
    boundValues,
    layerBoundValues,
    displayPoints,
  };
}

/**
 * Adds a single keyform point at `value` on `param` and binds a neutral KeyformDelta
 * for the active target if one does not already exist at that point.
 */
export function addKeyformPointToParameter(
  param: RigParameter,
  keyforms: KeyformDelta[],
  targetType: 'deformer' | 'layer',
  targetId: string,
  value: number
): { parameter: RigParameter; keyforms: KeyformDelta[] } {
  const clamped = Math.max(param.min, Math.min(param.max, value));
  const nextPoints = param.keyforms.some((v) => Math.abs(v - clamped) < 1e-3)
    ? param.keyforms
    : [...param.keyforms, clamped].sort((a, b) => a - b);

  const alreadyBound = keyforms.some(
    (k) =>
      k.parameterId === param.id &&
      k.targetType === targetType &&
      k.targetId === targetId &&
      Math.abs(k.keyformValue - clamped) < 1e-3
  );

  const nextKeyforms = alreadyBound
    ? keyforms
    : [
        ...keyforms,
        {
          id: `kf_pt_${param.id}_${targetId}_${clamped.toFixed(2)}`,
          parameterId: param.id,
          keyformValue: clamped,
          targetType,
          targetId,
          dx: 0,
          dy: 0,
          rotation: 0,
          scaleX: 0,
          scaleY: 0,
          skewX: 0,
          skewY: 0,
          opacityDelta: 0,
          meshWarp: { bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 },
        },
      ];

  return {
    parameter: { ...param, keyforms: nextPoints },
    keyforms: nextKeyforms,
  };
}

/**
 * Deletes a keyform point at `keyformValue` on `param`.
 * With `scope = 'parameter'` (default for the Parameter panel UI), removes the point across
 * the parameter so the dot immediately disappears and clearing the last point turns the parameter gray.
 * With `scope = 'target'`, removes only the selected layer / parent deformer binding.
 */
export function deleteKeyformPointFromParameter(
  param: RigParameter,
  keyforms: KeyformDelta[],
  selectedLayer: ArtMeshLayer | undefined,
  keyformValue: number,
  scope: 'parameter' | 'target' = 'parameter'
): { parameter: RigParameter; keyforms: KeyformDelta[] } {
  const targetLayerId = selectedLayer?.id ?? '';
  const targetDeformerId = selectedLayer?.parentDeformerId ?? 'def_head';

  const nextKeyforms = keyforms.filter((k) => {
    if (k.parameterId !== param.id) return true;
    if (Math.abs(k.keyformValue - keyformValue) >= 1e-3) return true;
    if (scope === 'parameter') return false;
    const isTargetLayer =
      k.targetType === 'layer' && Boolean(targetLayerId) && k.targetId === targetLayerId;
    const isTargetDeformer =
      k.targetType === 'deformer' && k.targetId === targetDeformerId;
    return !(isTargetLayer || isTargetDeformer);
  });

  const stillUsedByAnotherTarget = nextKeyforms.some(
    (k) =>
      k.parameterId === param.id &&
      Math.abs(k.keyformValue - keyformValue) < 1e-3
  );

  const nextPoints = stillUsedByAnotherTarget
    ? param.keyforms
    : param.keyforms.filter((v) => Math.abs(v - keyformValue) >= 1e-3);

  return {
    parameter: { ...param, keyforms: nextPoints },
    keyforms: nextKeyforms,
  };
}

/**
 * Swaps keyform deformation deltas between two keyform points on a parameter.
 */
export function swapKeyformPoints(
  keyforms: KeyformDelta[],
  parameterId: string,
  valueA: number,
  valueB: number
): KeyformDelta[] {
  return keyforms.map((kf) => {
    if (kf.parameterId !== parameterId) return kf;
    if (Math.abs(kf.keyformValue - valueA) < 0.001) {
      return { ...kf, keyformValue: valueB };
    }
    if (Math.abs(kf.keyformValue - valueB) < 0.001) {
      return { ...kf, keyformValue: valueA };
    }
    return kf;
  });
}

/**
 * Resets a specific keyform point back to neutral (zero delta) across all targets on that parameter.
 */
export function resetKeyformPoint(
  keyforms: KeyformDelta[],
  parameterId: string,
  keyformValue: number
): KeyformDelta[] {
  return keyforms.map((kf) => {
    if (
      kf.parameterId === parameterId &&
      Math.abs(kf.keyformValue - keyformValue) < 0.001
    ) {
      return {
        ...kf,
        dx: 0,
        dy: 0,
        rotation: 0,
        scaleX: 0,
        scaleY: 0,
        skewX: 0,
        skewY: 0,
        opacityDelta: 0,
        meshWarp: { bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 },
      };
    }
    return kf;
  });
}

export interface KeyframeClipboardItem {
  parameterId: string;
  frameOffset: number;
  value: number;
  easing: TimelineKeyframe['easing'];
}

export interface KeyframeSelectionItem {
  parameterId: string;
  keyframeId: string;
}

/**
 * Inserts or updates a keyframe at a specific frame (used by "Connect to Parameter" auto-keyframing).
 */
export function upsertKeyframeAtFrame(
  tracks: Record<string, ParameterTrack>,
  parameterId: string,
  frame: number,
  value: number,
  easing: TimelineKeyframe['easing'] = 'easeInOut'
): Record<string, ParameterTrack> {
  const clampedFrame = Math.max(0, Math.round(frame));
  const existing = tracks[parameterId] ?? {
    parameterId,
    stopwatchEnabled: true,
    keyframes: [],
  };
  const existingAtFrame = existing.keyframes.find(
    (k) => k.frame === clampedFrame
  );
  const nextKfs = existingAtFrame
    ? existing.keyframes.map((k) =>
        k.frame === clampedFrame ? { ...k, value, fromPhysics: false } : k
      )
    : [
        ...existing.keyframes,
        {
          id: `kf_${parameterId}_${clampedFrame}_${Math.random().toString(36).slice(2, 6)}`,
          frame: clampedFrame,
          value,
          easing,
        },
      ].sort((a, b) => a.frame - b.frame);

  return {
    ...tracks,
    [parameterId]: {
      ...existing,
      stopwatchEnabled: true,
      keyframes: nextKfs,
    },
  };
}

/**
 * Copies selected keyframes across tracks, preserving their relative frame offsets from the earliest selected keyframe.
 */
export function copyMultiKeyframes(
  tracks: Record<string, ParameterTrack>,
  selection: KeyframeSelectionItem[]
): KeyframeClipboardItem[] {
  const found: Array<{
    parameterId: string;
    frame: number;
    value: number;
    easing: TimelineKeyframe['easing'];
  }> = [];

  for (const sel of selection) {
    const track = tracks[sel.parameterId];
    const kf = track?.keyframes.find((k) => k.id === sel.keyframeId);
    if (kf) {
      found.push({
        parameterId: sel.parameterId,
        frame: kf.frame,
        value: kf.value,
        easing: kf.easing,
      });
    }
  }

  if (found.length === 0) return [];
  const minFrame = Math.min(...found.map((f) => f.frame));
  return found.map((f) => ({
    parameterId: f.parameterId,
    frameOffset: f.frame - minFrame,
    value: f.value,
    easing: f.easing,
  }));
}

/**
 * Deletes all selected keyframes across one or more tracks.
 */
export function deleteMultiKeyframes(
  tracks: Record<string, ParameterTrack>,
  selection: KeyframeSelectionItem[]
): Record<string, ParameterTrack> {
  if (selection.length === 0) return tracks;
  const byParam = new Map<string, Set<string>>();
  for (const sel of selection) {
    let set = byParam.get(sel.parameterId);
    if (!set) {
      set = new Set();
      byParam.set(sel.parameterId, set);
    }
    set.add(sel.keyframeId);
  }

  const next = { ...tracks };
  for (const [paramId, ids] of byParam.entries()) {
    const track = next[paramId];
    if (!track) continue;
    next[paramId] = {
      ...track,
      keyframes: track.keyframes.filter((k) => !ids.has(k.id)),
    };
  }
  return next;
}

/**
 * Moves all selected keyframes horizontally by deltaFrames (clamping cleanly inside [0, maxFrame]).
 */
export function moveMultiKeyframes(
  tracks: Record<string, ParameterTrack>,
  selection: KeyframeSelectionItem[],
  deltaFrames: number,
  maxFrame: number
): Record<string, ParameterTrack> {
  if (selection.length === 0 || deltaFrames === 0) return tracks;

  // Compute safe clamped delta so group preserves relative spacing at timeline edges
  let minSelectedFrame = Infinity;
  let maxSelectedFrame = -Infinity;
  const byParam = new Map<string, Set<string>>();

  for (const sel of selection) {
    const kf = tracks[sel.parameterId]?.keyframes.find(
      (k) => k.id === sel.keyframeId
    );
    if (!kf) continue;
    minSelectedFrame = Math.min(minSelectedFrame, kf.frame);
    maxSelectedFrame = Math.max(maxSelectedFrame, kf.frame);
    let set = byParam.get(sel.parameterId);
    if (!set) {
      set = new Set();
      byParam.set(sel.parameterId, set);
    }
    set.add(sel.keyframeId);
  }

  if (!Number.isFinite(minSelectedFrame)) return tracks;
  const clampedDelta = Math.max(
    -minSelectedFrame,
    Math.min(maxFrame - maxSelectedFrame, Math.round(deltaFrames))
  );
  if (clampedDelta === 0) return tracks;

  const next = { ...tracks };
  for (const [paramId, selectedIds] of byParam.entries()) {
    const track = next[paramId];
    if (!track) continue;
    const movedTargets = new Set<number>();
    const movedKfs = track.keyframes
      .filter((k) => selectedIds.has(k.id))
      .map((k) => {
        const nf = k.frame + clampedDelta;
        movedTargets.add(nf);
        return { ...k, frame: nf };
      });
    const untouchedKfs = track.keyframes.filter(
      (k) => !selectedIds.has(k.id) && !movedTargets.has(k.frame)
    );
    next[paramId] = {
      ...track,
      keyframes: [...untouchedKfs, ...movedKfs].sort((a, b) => a.frame - b.frame),
    };
  }
  return next;
}

/**
 * Pastes copied/cut keyframes onto tracks at targetFrame, preserving relative multi-keyframe offsets.
 */
export function pasteKeyframesAtFrame(
  tracks: Record<string, ParameterTrack>,
  clipboard: KeyframeClipboardItem[],
  targetFrame: number,
  maxFrame = 9999
): Record<string, ParameterTrack> {
  const next = { ...tracks };
  for (const item of clipboard) {
    const destFrame = Math.max(
      0,
      Math.min(maxFrame, Math.round(targetFrame + (item.frameOffset ?? 0)))
    );
    const existing = next[item.parameterId] ?? {
      parameterId: item.parameterId,
      stopwatchEnabled: true,
      keyframes: [],
    };
    const filtered = existing.keyframes.filter((k) => k.frame !== destFrame);
    next[item.parameterId] = {
      ...existing,
      stopwatchEnabled: true,
      keyframes: [
        ...filtered,
        {
          id: `kf_paste_${item.parameterId}_${destFrame}_${Math.random().toString(36).slice(2, 6)}`,
          frame: destFrame,
          value: item.value,
          easing: item.easing,
        },
      ].sort((a, b) => a.frame - b.frame),
    };
  }
  return next;
}

/**
 * Formats video background start time as MM:SS.cc timestamp OR integer frame count (Ctrl+Click toggle).
 */
export function formatVideoStartTime(
  startTimeSec: number,
  fps: number,
  mode: 'timecode' | 'frame'
): string {
  const safeSec = Math.max(0, Number.isFinite(startTimeSec) ? startTimeSec : 0);
  const safeFps = Math.max(1, fps);
  if (mode === 'frame') {
    return `${Math.round(safeSec * safeFps)}f`;
  }
  const mins = Math.floor(safeSec / 60);
  const secs = Math.floor(safeSec % 60);
  const centis = Math.floor((safeSec - Math.floor(safeSec)) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

/**
 * Parses user-edited start time string in either timecode ("MM:SS.cc" or seconds) or frame ("45f" or "45") mode.
 */
export function parseVideoStartTime(
  raw: string,
  fps: number,
  mode: 'timecode' | 'frame'
): number {
  const trimmed = raw.trim();
  const safeFps = Math.max(1, fps);
  if (mode === 'frame' || trimmed.endsWith('f')) {
    const num = parseFloat(trimmed.replace(/f$/i, ''));
    if (!Number.isFinite(num) || num < 0) return 0;
    return num / safeFps;
  }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return Math.max(0, mins * 60 + secs);
  }
  const num = parseFloat(trimmed);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export const BONE_ARROW_BASE_LEN = 115;
export const BONE_MIN_SCALE = 0.2;
export const BONE_MAX_SCALE = 2.5;

export interface BoneGizmoGeometry {
  pivotX: number;
  pivotY: number;
  tipX: number;
  tipY: number;
  arrowLength: number;
  angleRad: number;
  totalRotationDeg: number;
}

export function normalizeAngleDeg(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

/**
 * Computes the on-canvas Null Object Circle + Upward Arrow gizmo geometry in model coordinates.
 * At rotation = 0° and scale = 1.0, the arrow points straight upward from pivot by BONE_ARROW_BASE_LEN.
 */
export function computeBoneGizmoGeometry(
  pivot: { x: number; y: number },
  boneRotationDeg: number,
  boneScale: number,
  baseWorldRotationDeg = 0
): BoneGizmoGeometry {
  const totalRotationDeg = baseWorldRotationDeg + boneRotationDeg;
  const angleRad = ((totalRotationDeg - 90) * Math.PI) / 180;
  const clampedScale = Math.max(
    BONE_MIN_SCALE,
    Math.min(BONE_MAX_SCALE, Number.isFinite(boneScale) ? boneScale : 1)
  );
  const arrowLength = BONE_ARROW_BASE_LEN * clampedScale;
  return {
    pivotX: pivot.x,
    pivotY: pivot.y,
    tipX: pivot.x + Math.cos(angleRad) * arrowLength,
    tipY: pivot.y + Math.sin(angleRad) * arrowLength,
    arrowLength,
    angleRad,
    totalRotationDeg,
  };
}

/**
 * Maps a dragged arrow-handle pointer position relative to the Null Object pivot into
 * new bone rotation (degrees, following arrow direction) and uniform scale (growing upward/outward, shrinking downward/inward).
 */
export function computeBoneTransformFromArrowPointer(
  pivot: { x: number; y: number },
  pointer: { x: number; y: number },
  baseWorldRotationDeg = 0
): { rotation: number; scale: number } {
  const vx = pointer.x - pivot.x;
  const vy = pointer.y - pivot.y;
  const dist = Math.hypot(vx, vy);

  const pointerUpDeg =
    dist > 1e-3
      ? (Math.atan2(vy, vx) * 180) / Math.PI + 90
      : baseWorldRotationDeg;
  const rotation =
    Math.round(normalizeAngleDeg(pointerUpDeg - baseWorldRotationDeg) * 10) / 10;

  const rawScale = dist / BONE_ARROW_BASE_LEN;
  const clampedScale = Math.max(
    BONE_MIN_SCALE,
    Math.min(BONE_MAX_SCALE, rawScale)
  );
  const scale = Math.round(clampedScale * 100) / 100;

  return { rotation, scale };
}

/**
 * Hit-tests the on-canvas Bone Gizmo in model space, returning 'arrow' (rotate/scale),
 * 'circle' (null object move), or 'none'.
 */
export function hitTestBoneGizmo(
  pointer: { x: number; y: number },
  geom: BoneGizmoGeometry,
  viewportScale: number
): 'arrow' | 'circle' | 'none' {
  const invScale = 1 / Math.max(0.05, viewportScale);
  const tipHitR = 24 * invScale;
  const circleHitR = 22 * invScale;
  const shaftHitR = 14 * invScale;

  if (Math.hypot(pointer.x - geom.tipX, pointer.y - geom.tipY) <= tipHitR) {
    return 'arrow';
  }
  if (
    Math.hypot(pointer.x - geom.pivotX, pointer.y - geom.pivotY) <= circleHitR
  ) {
    return 'circle';
  }

  // Distance to upper shaft segment (from 25% to 100% along arrow)
  const sx = geom.tipX - geom.pivotX;
  const sy = geom.tipY - geom.pivotY;
  const lenSq = sx * sx + sy * sy;
  if (lenSq > 1e-4) {
    const t =
      ((pointer.x - geom.pivotX) * sx + (pointer.y - geom.pivotY) * sy) / lenSq;
    if (t >= 0.22 && t <= 1.05) {
      const projX = geom.pivotX + t * sx;
      const projY = geom.pivotY + t * sy;
      if (Math.hypot(pointer.x - projX, pointer.y - projY) <= shaftHitR) {
        return 'arrow';
      }
    }
  }

  return 'none';
}

/**
 * Parses a typed parameter numeric string (supporting both '.' and ',' decimals)
 * and clamps it to the parameter's [min, max] bounds. Returns null on empty/invalid input.
 */
export function parseClampedParameterInput(
  raw: string,
  min: number,
  max: number
): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamped = Math.max(lo, Math.min(hi, parsed));
  return Number(clamped.toFixed(3));
}
