import type {
  ArtMeshLayer,
  DeformerNode,
  EvaluatedRigResult,
  EvaluatedTargetState,
  KeyformDelta,
  MeshWarp,
  ParameterTrack,
  PhysicsGroup,
  PhysicsSimulationState,
  PuppetDocument,
  RigParameter,
  TimelineKeyframe,
} from '../types/puppet';
import { computePhysicsOutputDeltas } from './physics';
import {
  evaluateBasicLatticeDisplacement,
  evaluateMorphPinsDisplacement,
} from './morphTools';
import { evaluateCubicBezier } from './studioFeatures';

export function createZeroTargetState(): EvaluatedTargetState {
  return {
    dx: 0,
    dy: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    opacity: 1,
    meshWarp: { bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 },
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function evaluateTrackAtFrame(
  track: ParameterTrack | undefined,
  frame: number,
  fallbackValue: number
): number {
  if (!track || !track.stopwatchEnabled || track.keyframes.length === 0) {
    return fallbackValue;
  }

  const sorted = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) {
    return sorted[sorted.length - 1].value;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0: TimelineKeyframe = sorted[i];
    const k1: TimelineKeyframe = sorted[i + 1];
    if (frame >= k0.frame && frame <= k1.frame) {
      const span = k1.frame - k0.frame;
      if (span <= 0) return k1.value;
      const rawT = (frame - k0.frame) / span;
      if (k0.easing === 'hold') return k0.value;
      const t =
        k0.easing === 'bezier' && k0.bezier
          ? evaluateCubicBezier(
              rawT,
              k0.bezier[0],
              k0.bezier[1],
              k0.bezier[2],
              k0.bezier[3]
            )
          : k0.easing === 'easeInOut'
            ? easeInOutCubic(rawT)
            : rawT;
      return lerp(k0.value, k1.value, t);
    }
  }

  return fallbackValue;
}

/**
 * Synchronizes rig parameter values to all active animated tracks at the given timeline frame.
 * Parameters without an active keyframed track keep their current value untouched.
 */
export function syncParametersToFrame(
  parameters: RigParameter[],
  tracks: Record<string, ParameterTrack>,
  frame: number
): RigParameter[] {
  let changed = false;
  const next = parameters.map((p) => {
    const track = tracks[p.id];
    if (!track || !track.stopwatchEnabled || track.keyframes.length === 0) {
      return p;
    }
    const evaluated = evaluateTrackAtFrame(track, frame, p.value);
    const clamped = Math.max(p.min, Math.min(p.max, evaluated));
    if (Math.abs(clamped - p.value) > 1e-6) {
      changed = true;
      return { ...p, value: clamped };
    }
    return p;
  });
  return changed ? next : parameters;
}

export function interpolateKeyformDeltasForParam(
  paramKeyforms: KeyformDelta[],
  currentValue: number
): Omit<
  KeyformDelta,
  'id' | 'parameterId' | 'keyformValue' | 'targetType' | 'targetId'
> {
  const zero = {
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

  if (paramKeyforms.length === 0) return zero;
  const sorted = [...paramKeyforms].sort(
    (a, b) => a.keyformValue - b.keyformValue
  );

  if (sorted.length === 1 || currentValue <= sorted[0].keyformValue) {
    const k = sorted[0];
    return {
      dx: k.dx,
      dy: k.dy,
      rotation: k.rotation,
      scaleX: k.scaleX,
      scaleY: k.scaleY,
      skewX: k.skewX,
      skewY: k.skewY,
      opacityDelta: k.opacityDelta,
      meshWarp: { ...k.meshWarp },
    };
  }

  const last = sorted[sorted.length - 1];
  if (currentValue >= last.keyformValue) {
    return {
      dx: last.dx,
      dy: last.dy,
      rotation: last.rotation,
      scaleX: last.scaleX,
      scaleY: last.scaleY,
      skewX: last.skewX,
      skewY: last.skewY,
      opacityDelta: last.opacityDelta,
      meshWarp: { ...last.meshWarp },
    };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (currentValue >= a.keyformValue && currentValue <= b.keyformValue) {
      const span = b.keyformValue - a.keyformValue;
      const t = span > 0 ? (currentValue - a.keyformValue) / span : 0;
      return {
        dx: lerp(a.dx, b.dx, t),
        dy: lerp(a.dy, b.dy, t),
        rotation: lerp(a.rotation, b.rotation, t),
        scaleX: lerp(a.scaleX, b.scaleX, t),
        scaleY: lerp(a.scaleY, b.scaleY, t),
        skewX: lerp(a.skewX, b.skewX, t),
        skewY: lerp(a.skewY, b.skewY, t),
        opacityDelta: lerp(a.opacityDelta, b.opacityDelta, t),
        meshWarp: {
          bendX: lerp(a.meshWarp.bendX, b.meshWarp.bendX, t),
          bendY: lerp(a.meshWarp.bendY, b.meshWarp.bendY, t),
          squeezeX: lerp(a.meshWarp.squeezeX, b.meshWarp.squeezeX, t),
          squeezeY: lerp(a.meshWarp.squeezeY, b.meshWarp.squeezeY, t),
        },
      };
    }
  }

  return zero;
}

/**
 * Evaluates all deformer and layer transforms including parameter-to-parameter physics outputs.
 */
export function evaluatePuppetRig(
  puppet: PuppetDocument,
  paramValues: Record<string, number>,
  physicsGroups: PhysicsGroup[],
  physicsState: PhysicsSimulationState,
  physicsStrength: number
): EvaluatedRigResult {
  const deformerTransforms: Record<string, EvaluatedTargetState> = {};
  const layerTransforms: Record<string, EvaluatedTargetState> = {};

  for (const def of puppet.deformers) {
    deformerTransforms[def.id] = {
      dx: def.baseTransform.x,
      dy: def.baseTransform.y,
      rotation: def.baseTransform.rotation,
      scaleX: def.baseTransform.scaleX,
      scaleY: def.baseTransform.scaleY,
      skewX: def.baseTransform.skewX,
      skewY: def.baseTransform.skewY,
      opacity: def.baseTransform.opacity,
      meshWarp: { bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 },
    };
  }

  for (const layer of puppet.layers) {
    layerTransforms[layer.id] = {
      dx: layer.boneTransform?.dx ?? 0,
      dy: layer.boneTransform?.dy ?? 0,
      rotation: layer.boneTransform?.rotation ?? 0,
      scaleX: layer.boneTransform?.scaleX ?? 1,
      scaleY: layer.boneTransform?.scaleY ?? 1,
      skewX: 0,
      skewY: 0,
      opacity: layer.opacity,
      meshWarp: { bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 },
    };
  }

  // First compute physics deltas so parameter-to-parameter physics can feed into keyforms
  const phys =
    physicsStrength > 0.001
      ? computePhysicsOutputDeltas(physicsGroups, physicsState, physicsStrength)
      : { deformers: {}, layers: {}, parameters: {} };

  const effectiveParams: Record<string, number> = { ...paramValues };
  for (const [pId, pOffset] of Object.entries(phys.parameters)) {
    const pDef = puppet.parameters.find((p) => p.id === pId);
    const raw = (effectiveParams[pId] ?? 0) + pOffset;
    effectiveParams[pId] = pDef
      ? Math.max(pDef.min, Math.min(pDef.max, raw))
      : raw;
  }

  let hasExplicitBreathKeyform = false;
  const grouped = new Map<string, KeyformDelta[]>();
  for (const kf of puppet.keyforms) {
    if (kf.parameterId === 'ParamBreath') {
      hasExplicitBreathKeyform = true;
    }
    const key = `${kf.targetType}::${kf.targetId}::${kf.parameterId}`;
    const list = grouped.get(key);
    if (list) list.push(kf);
    else grouped.set(key, [kf]);
  }

  for (const [, list] of grouped) {
    const sample = list[0];
    const pVal = effectiveParams[sample.parameterId] ?? 0;
    const interp = interpolateKeyformDeltasForParam(list, pVal);

    const target =
      sample.targetType === 'deformer'
        ? deformerTransforms[sample.targetId]
        : layerTransforms[sample.targetId];
    if (!target) continue;

    target.dx += interp.dx;
    target.dy += interp.dy;
    target.rotation += interp.rotation;
    target.scaleX *= Math.max(0.02, 1 + interp.scaleX);
    target.scaleY *= Math.max(0.02, 1 + interp.scaleY);
    target.skewX += interp.skewX;
    target.skewY += interp.skewY;
    target.opacity = Math.max(
      0,
      Math.min(1, target.opacity + interp.opacityDelta)
    );
    target.meshWarp.bendX += interp.meshWarp.bendX;
    target.meshWarp.bendY += interp.meshWarp.bendY;
    target.meshWarp.squeezeX += interp.meshWarp.squeezeX;
    target.meshWarp.squeezeY += interp.meshWarp.squeezeY;
  }

  // Procedural breathing fallback for newly imported PSDs (no ParamBreath keyforms)
  // whenever the user explicitly turns Auto-Breath ON.
  const breathSignal = effectiveParams.ParamBreath ?? 0;
  if (!hasExplicitBreathKeyform && Math.abs(breathSignal) > 0.0001) {
    const bodyTarget = deformerTransforms.def_body ?? deformerTransforms.def_root;
    if (bodyTarget) {
      bodyTarget.dy += -10 * breathSignal;
      bodyTarget.scaleY *= Math.max(0.5, 1 + 0.024 * breathSignal);
      bodyTarget.scaleX *= Math.max(0.5, 1 + 0.015 * breathSignal);
    } else {
      for (const layer of puppet.layers) {
        const lt = layerTransforms[layer.id];
        if (!lt) continue;
        lt.dy += -10 * breathSignal;
        lt.scaleY *= Math.max(0.5, 1 + 0.024 * breathSignal);
        lt.scaleX *= Math.max(0.5, 1 + 0.015 * breathSignal);
      }
    }
    const headTarget = deformerTransforms.def_head;
    if (headTarget && headTarget !== bodyTarget) {
      headTarget.dy += -4 * breathSignal;
    }
  }

  if (physicsStrength > 0.001) {
    for (const [defId, delta] of Object.entries(phys.deformers)) {
      const target = deformerTransforms[defId];
      if (!target) continue;
      target.dx += delta.dx;
      target.dy += delta.dy;
      target.rotation += delta.rotation;
      target.scaleY *= Math.max(0.2, 1 + delta.scaleY);
      target.meshWarp.bendX += delta.bendX;
      target.meshWarp.bendY += delta.bendY;
    }
    for (const [layerId, delta] of Object.entries(phys.layers)) {
      const target = layerTransforms[layerId];
      if (!target) continue;
      target.dx += delta.dx;
      target.dy += delta.dy;
      target.rotation += delta.rotation;
      target.scaleY *= Math.max(0.2, 1 + delta.scaleY);
      target.meshWarp.bendX += delta.bendX;
      target.meshWarp.bendY += delta.bendY;
    }
  }

  return {
    deformerTransforms,
    layerTransforms,
    physicsParamOffsets: phys.parameters,
  };
}

export interface Point2D {
  x: number;
  y: number;
}

export interface MeshVertex {
  u: number;
  v: number;
  x: number;
  y: number;
}

export function applyTransformAroundPivot(
  pt: Point2D,
  pivotX: number,
  pivotY: number,
  t: EvaluatedTargetState
): Point2D {
  let lx = pt.x - pivotX;
  let ly = pt.y - pivotY;

  lx *= t.scaleX;
  ly *= t.scaleY;

  const skewXRad = (t.skewX * Math.PI) / 180;
  const skewYRad = (t.skewY * Math.PI) / 180;
  const skX = lx + Math.tan(skewXRad) * ly;
  const skY = ly + Math.tan(skewYRad) * lx;

  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = skX * cos - skY * sin;
  const ry = skX * sin + skY * cos;

  return {
    x: pivotX + rx + t.dx,
    y: pivotY + ry + t.dy,
  };
}

export function applyMeshWarpLocal(
  nx: number,
  ny: number,
  halfW: number,
  halfH: number,
  warp: MeshWarp,
  anchorBendAtPivotZero = false
): Point2D {
  const bendWeight = anchorBendAtPivotZero
    ? Math.max(0, Math.min(1.25, ny))
    : (ny + 1) * 0.5;
  const bendOffsetX =
    warp.bendX * halfW * (anchorBendAtPivotZero ? 0.36 : 0.45) * bendWeight * bendWeight;
  const bendOffsetY = warp.bendY * halfH * 0.4 * (1 - nx * nx);
  const scaleFromSqueezeX = 1 + warp.squeezeX * nx * 0.45;
  const scaleFromSqueezeY = 1 + warp.squeezeY * ny * 0.45;

  return {
    x: nx * halfW * scaleFromSqueezeY + bendOffsetX,
    y: ny * halfH * scaleFromSqueezeX + bendOffsetY,
  };
}

/**
 * Propagates a point inside a layer through the layer's local transform, any parent-layer bone chain,
 * and the root layer's parent deformer chain.
 */
export function transformLayerPointToModel(
  ptLocal: Point2D,
  layer: ArtMeshLayer,
  deformersById: Record<string, DeformerNode>,
  rigResult: EvaluatedRigResult,
  layersById?: Record<string, ArtMeshLayer>
): Point2D {
  const layerState =
    rigResult.layerTransforms[layer.id] ?? createZeroTargetState();
  const halfW = layer.width * 0.5;
  const halfH = layer.height * 0.5;
  const layerPivotX = layer.x - halfW + layer.width * layer.pivotX;
  const layerPivotY = layer.y - halfH + layer.height * layer.pivotY;

  let pt = applyTransformAroundPivot(
    ptLocal,
    layerPivotX,
    layerPivotY,
    layerState
  );

  // Walk parent-layer Bone Parenting chain (if any)
  let rootLayer: ArtMeshLayer = layer;
  if (layersById && layer.parentLayerId) {
    const visitedLayers = new Set<string>([layer.id]);
    let parentCursor: ArtMeshLayer | undefined = layersById[layer.parentLayerId];
    while (parentCursor && !visitedLayers.has(parentCursor.id)) {
      visitedLayers.add(parentCursor.id);
      const pHalfW = parentCursor.width * 0.5;
      const pHalfH = parentCursor.height * 0.5;
      const pPivotX = parentCursor.x - pHalfW + parentCursor.width * parentCursor.pivotX;
      const pPivotY = parentCursor.y - pHalfH + parentCursor.height * parentCursor.pivotY;
      const pBone = parentCursor.boneTransform;
      pt = applyTransformAroundPivot(pt, pPivotX, pPivotY, {
        ...createZeroTargetState(),
        dx: pBone?.dx ?? 0,
        dy: pBone?.dy ?? 0,
        rotation: pBone?.rotation ?? 0,
        scaleX: pBone?.scaleX ?? 1,
        scaleY: pBone?.scaleY ?? 1,
      });
      rootLayer = parentCursor;
      parentCursor = parentCursor.parentLayerId
        ? layersById[parentCursor.parentLayerId]
        : undefined;
    }
  }

  let cursor: DeformerNode | undefined =
    deformersById[rootLayer.parentDeformerId];
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    const defState =
      rigResult.deformerTransforms[cursor.id] ?? createZeroTargetState();

    if (
      cursor.type === 'warp' &&
      (Math.abs(defState.meshWarp.bendX) > 0.0001 ||
        Math.abs(defState.meshWarp.bendY) > 0.0001 ||
        Math.abs(defState.meshWarp.squeezeX) > 0.0001 ||
        Math.abs(defState.meshWarp.squeezeY) > 0.0001)
    ) {
      const dHalfW = Math.max(10, cursor.width * 0.5);
      const dHalfH = Math.max(10, cursor.height * 0.5);
      const dnx = Math.max(-1.5, Math.min(1.5, (pt.x - cursor.pivotX) / dHalfW));
      const dny = Math.max(-1.5, Math.min(1.5, (pt.y - cursor.pivotY) / dHalfH));
      const defWarped = applyMeshWarpLocal(
        dnx,
        dny,
        dHalfW,
        dHalfH,
        defState.meshWarp,
        true
      );
      pt = {
        x: cursor.pivotX + defWarped.x,
        y: cursor.pivotY + defWarped.y,
      };
    }

    pt = applyTransformAroundPivot(pt, cursor.pivotX, cursor.pivotY, defState);
    cursor = cursor.parentId ? deformersById[cursor.parentId] : undefined;
  }

  return pt;
}

/**
 * Generates deformed model-space vertices incorporating:
 * 1) Layer meshWarp, 2) Custom Brush/Vertex offsets, 3) Custom Morph Pins (RBF),
 * 4) Basic Morphing lattice box warp, 5) Bone transform, Parent Layer Bone chain & Deformer chain.
 */
export function buildDeformedMeshVertices(
  layer: ArtMeshLayer,
  deformersById: Record<string, DeformerNode>,
  rigResult: EvaluatedRigResult,
  layersById?: Record<string, ArtMeshLayer>
): MeshVertex[] {
  const cols = Math.max(1, layer.meshCols);
  const rows = Math.max(1, layer.meshRows);
  const layerState =
    rigResult.layerTransforms[layer.id] ?? createZeroTargetState();

  const halfW = layer.width * 0.5;
  const halfH = layer.height * 0.5;
  const vertices: MeshVertex[] = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const ny = v * 2 - 1;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const nx = u * 2 - 1;
      const idx = r * (cols + 1) + c;
      const customOff = layer.vertexOffsets[idx] ?? { dx: 0, dy: 0 };

      const warped = applyMeshWarpLocal(
        nx,
        ny,
        halfW,
        halfH,
        layerState.meshWarp
      );
      const pinOff = evaluateMorphPinsDisplacement(
        layer.morphPins,
        u,
        v,
        layer.width,
        layer.height
      );
      const latticeOff = evaluateBasicLatticeDisplacement(
        layer.basicLattice,
        u,
        v
      );

      const localPt: Point2D = {
        x: layer.x + warped.x + customOff.dx + pinOff.dx + latticeOff.dx,
        y: layer.y + warped.y + customOff.dy + pinOff.dy + latticeOff.dy,
      };

      const worldPt = transformLayerPointToModel(
        localPt,
        layer,
        deformersById,
        rigResult,
        layersById
      );
      vertices.push({ u, v, x: worldPt.x, y: worldPt.y });
    }
  }

  return vertices;
}

export function computeEffectiveLayerOpacity(
  layer: ArtMeshLayer,
  deformersById: Record<string, DeformerNode>,
  rigResult: EvaluatedRigResult
): number {
  let op = rigResult.layerTransforms[layer.id]?.opacity ?? layer.opacity;
  let cursor: DeformerNode | undefined = deformersById[layer.parentDeformerId];
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    op *= rigResult.deformerTransforms[cursor.id]?.opacity ?? 1;
    cursor = cursor.parentId ? deformersById[cursor.parentId] : undefined;
  }
  return Math.max(0, Math.min(1, op));
}

/**
 * Computes the total world-space rotation (degrees) applied to a layer by its parent layers,
 * parent deformers, and any keyform/physics rotations, excluding the layer's own manual boneTransform.rotation.
 */
export function getLayerNonBoneWorldRotationDeg(
  layer: ArtMeshLayer,
  deformersById: Record<string, DeformerNode>,
  rigResult: EvaluatedRigResult,
  layersById?: Record<string, ArtMeshLayer>
): number {
  const layerState = rigResult.layerTransforms[layer.id];
  const boneRot = layer.boneTransform?.rotation ?? 0;
  let rot = layerState ? layerState.rotation - boneRot : 0;

  let rootLayer: ArtMeshLayer = layer;
  if (layersById && layer.parentLayerId) {
    const visitedLayers = new Set<string>([layer.id]);
    let parentCursor: ArtMeshLayer | undefined = layersById[layer.parentLayerId];
    while (parentCursor && !visitedLayers.has(parentCursor.id)) {
      visitedLayers.add(parentCursor.id);
      rot += parentCursor.boneTransform?.rotation ?? 0;
      rootLayer = parentCursor;
      parentCursor = parentCursor.parentLayerId
        ? layersById[parentCursor.parentLayerId]
        : undefined;
    }
  }

  let cursor: DeformerNode | undefined =
    deformersById[rootLayer.parentDeformerId];
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    rot += rigResult.deformerTransforms[cursor.id]?.rotation ?? 0;
    cursor = cursor.parentId ? deformersById[cursor.parentId] : undefined;
  }
  return rot;
}
