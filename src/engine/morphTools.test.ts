import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BONE_ARROW_BASE_LEN,
  PIN_GIZMO_BASE_RING_PX,
  addKeyformPointToParameter,
  applyBrushMorphToOffsets,
  applyKeyformPresetToParameter,
  clampMeshDimension,
  computeBoneGizmoGeometry,
  computeBoneTransformFromArrowPointer,
  computeMorphPinGizmoGeometry,
  computeMorphPinRotationFromPointer,
  computeMorphPinScaleFromPointer,
  copyMultiKeyframes,
  createDefaultBasicLattice,
  deleteKeyformPointFromParameter,
  deleteMultiKeyframes,
  evaluateBasicLatticeDisplacement,
  evaluateMorphPinsDisplacement,
  formatVideoStartTime,
  getParameterKeyformStatus,
  hitTestBoneGizmo,
  hitTestMorphPinGizmo,
  isMorphPinMoved,
  moveMultiKeyframes,
  parseClampedParameterInput,
  parseVideoStartTime,
  pasteKeyframesAtFrame,
  resetKeyformPoint,
  swapKeyformPoints,
  upsertKeyframeAtFrame,
} from './morphTools';
import { syncParametersToFrame } from './rigging';
import {
  buildLosslessRgbaMovBytes,
  rgbaToAlphaMattePixels,
  rgbaToQuickTimeArgb,
} from './videoExporter';
import { cacheManager, getPreviewResolutionScale } from './cacheManager';
import {
  computePhysicsOutputDeltas,
  createInitialPhysicsState,
  stepPhysicsSimulation,
} from './physics';
import {
  createDefaultPuppetDocument,
  createDefaultPuppetEffect,
  createInitialComposition,
} from '../state/defaultProject';
import { getBelowCompositionLayers } from './compositionBg';
import { buildAeSdkFiles, buildApplyKeyframesJsx } from './aeSdkGenerator';
import {
  RPF_HEADER_BYTES,
  RPF_MAGIC,
  buildAppliedParamsTxt,
  computeRpfRenderDimensions,
  decodeRpfHeader,
  encodeRgbaToRpf,
} from './rpfCodec';

test('Morph Pins: moving rest position with dx=0/dy=0 produces zero mesh deformation', () => {
  const disp = evaluateMorphPinsDisplacement(
    [{ id: 'p1', restU: 0.72, restV: 0.35, dx: 0, dy: 0 }],
    0.72,
    0.35,
    300,
    300
  );
  assert.equal(disp.dx, 0);
  assert.equal(disp.dy, 0);
});

test('Morph Pins: deforming a pin smoothly displaces nearby vertices with Gaussian falloff', () => {
  const pins = [{ id: 'p1', restU: 0.5, restV: 0.5, dx: 24, dy: -12 }];
  const atPin = evaluateMorphPinsDisplacement(pins, 0.5, 0.5, 300, 300);
  const far = evaluateMorphPinsDisplacement(pins, 0.0, 0.0, 300, 300);
  assert.ok(Math.abs(atPin.dx - 24) < 1e-6);
  assert.ok(Math.abs(atPin.dy - -12) < 1e-6);
  assert.ok(Math.abs(far.dx) < Math.abs(atPin.dx) * 0.5);
});

test('Morph Pins: supports local rotation and scale deformation around a pin', () => {
  // Single pin at center rotated +90 deg clockwise -> point directly above (u=0.5, v=0.4) rotates right (+dx, +dy)
  const rotPins = [{ id: 'p1', restU: 0.5, restV: 0.5, dx: 0, dy: 0, rotation: 90, scale: 1 }];
  const aboveRot = evaluateMorphPinsDisplacement(rotPins, 0.5, 0.4, 300, 300);
  assert.ok(aboveRot.dx > 20, `Expected +90deg rotation to push top point right, got dx=${aboveRot.dx}`);
  assert.ok(aboveRot.dy > 20, `Expected +90deg rotation to pull top point down, got dy=${aboveRot.dy}`);

  // Single pin at center scaled 1.5x -> point to the right (u=0.6, v=0.5) expands outward (+dx)
  const scalePins = [{ id: 'p1', restU: 0.5, restV: 0.5, dx: 0, dy: 0, rotation: 0, scale: 1.5 }];
  const rightScaled = evaluateMorphPinsDisplacement(scalePins, 0.6, 0.5, 300, 300);
  assert.ok(rightScaled.dx > 10, `Expected 1.5x scale to expand right point outward, got dx=${rightScaled.dx}`);
  assert.ok(Math.abs(rightScaled.dy) < 1e-6);
});

test('Morph Pins: unmoved pins act as fixed anchor points unaffected by other moved/rotated/scaled pins', () => {
  const pins = [
    // Pin A: unmoved anchor point at (0.25, 0.5)
    { id: 'anchor', restU: 0.25, restV: 0.5, dx: 0, dy: 0, rotation: 0, scale: 1 },
    // Pin B: moved + rotated + scaled at (0.75, 0.5)
    { id: 'moved', restU: 0.75, restV: 0.5, dx: 40, dy: -20, rotation: 45, scale: 1.4 },
  ];

  assert.equal(isMorphPinMoved(pins[0]), false);
  assert.equal(isMorphPinMoved(pins[1]), true);

  // At unmoved anchor Pin A: strictly (0, 0) displacement
  const atAnchor = evaluateMorphPinsDisplacement(pins, 0.25, 0.5, 400, 400);
  assert.equal(atAnchor.dx, 0);
  assert.equal(atAnchor.dy, 0);

  // Immediately adjacent to unmoved anchor Pin A: locked down near zero (< 0.5px despite 40px+ deformation on Pin B)
  const nearAnchor = evaluateMorphPinsDisplacement(pins, 0.27, 0.5, 400, 400);
  assert.ok(
    Math.hypot(nearAnchor.dx, nearAnchor.dy) < 0.5,
    `Expected area near unmoved anchor to stay fixed, got (${nearAnchor.dx}, ${nearAnchor.dy})`
  );

  // At moved Pin B: strictly matches Pin B's exact displacement
  const atMoved = evaluateMorphPinsDisplacement(pins, 0.75, 0.5, 400, 400);
  assert.ok(Math.abs(atMoved.dx - 40) < 1e-6);
  assert.ok(Math.abs(atMoved.dy - -20) < 1e-6);

  // Midpoint blends smoothly between anchor (0) and moved pin
  const mid = evaluateMorphPinsDisplacement(pins, 0.5, 0.5, 400, 400);
  assert.ok(Math.hypot(mid.dx, mid.dy) > 5, 'Expected midpoint to blend smoothly toward moved pin');
});

test('Advanced Pin Gizmo: center dot moves, hollow box on circle scales, and blue square/ring rotates', () => {
  const center = { x: 500, y: 400 };
  const vpScale = 0.8;
  const geom = computeMorphPinGizmoGeometry(center, 0, 1, vpScale, 0);

  // At 0 deg, both blue rotation square and hollow green scale box sit directly above center
  assert.ok(Math.abs(geom.scaleBoxX - center.x) < 1e-5);
  assert.ok(geom.scaleBoxY < center.y);
  assert.ok(Math.abs(geom.rotHandleX - center.x) < 1e-5);
  assert.ok(geom.rotHandleY < center.y && geom.rotHandleY > geom.scaleBoxY);

  // Hit-testing accurately distinguishes each handle:
  // Center green dot = move, Hollow green box on circle = scale, Blue square & outer ring = rotate
  assert.equal(hitTestMorphPinGizmo(center, geom, vpScale), 'move');
  assert.equal(
    hitTestMorphPinGizmo({ x: geom.scaleBoxX, y: geom.scaleBoxY }, geom, vpScale),
    'scale'
  );
  assert.equal(
    hitTestMorphPinGizmo({ x: geom.rotHandleX, y: geom.rotHandleY }, geom, vpScale),
    'rotate'
  );
  assert.equal(
    hitTestMorphPinGizmo({ x: center.x + geom.ringRadius, y: center.y }, geom, vpScale),
    'rotate'
  );

  // Dragging blue square / ring clockwise by 90 deg updates rotation cleanly
  const rot90 = computeMorphPinRotationFromPointer(
    center,
    { x: center.x + geom.ringRadius, y: center.y },
    -90,
    0
  );
  assert.equal(rot90, 90);

  // Dragging hollow green box on the circle outward by +1 ring radius doubles uniform scale (1.0 -> 2.0)
  const startDist = Math.hypot(geom.scaleBoxX - center.x, geom.scaleBoxY - center.y);
  const grownScale = computeMorphPinScaleFromPointer(
    center,
    { x: geom.scaleBoxX, y: geom.scaleBoxY - PIN_GIZMO_BASE_RING_PX / vpScale },
    startDist,
    1.0,
    vpScale
  );
  assert.equal(grownScale, 2.0);

  // Dragging hollow green box inward shrinks scale smoothly (< 1.0)
  const shrunkScale = computeMorphPinScaleFromPointer(
    center,
    { x: geom.scaleBoxX, y: geom.scaleBoxY + (PIN_GIZMO_BASE_RING_PX * 0.5) / vpScale },
    startDist,
    1.0,
    vpScale
  );
  assert.equal(shrunkScale, 0.5);
});

test('Custom Mesh Create: clampMeshDimension sanitizes and clamps user-entered grid sizes to [1, 24]', () => {
  assert.equal(clampMeshDimension(10), 10);
  assert.equal(clampMeshDimension('12'), 12);
  assert.equal(clampMeshDimension('0'), 1);
  assert.equal(clampMeshDimension('-5'), 1);
  assert.equal(clampMeshDimension('99'), 24);
  assert.equal(clampMeshDimension('abc', 6), 6);
});

test('Basic Morphing Lattice: bilinearly interpolates handle displacement', () => {
  const lattice = createDefaultBasicLattice(3, 3);
  lattice.offsets[0] = { dx: 20, dy: 10 }; // top-left (u=0, v=0)
  const corner = evaluateBasicLatticeDisplacement(lattice, 0, 0);
  const mid = evaluateBasicLatticeDisplacement(lattice, 1 / 6, 0);
  assert.equal(corner.dx, 20);
  assert.equal(corner.dy, 10);
  assert.ok(Math.abs(mid.dx - 10) < 1e-6);
  assert.ok(Math.abs(mid.dy - 5) < 1e-6);
});

test('Brush Morph: applies displacement inside brush radius and leaves outside vertices untouched', () => {
  const doc = createDefaultPuppetDocument();
  const layer = doc.layers[0];
  const verts = layer.vertexOffsets.map((_, i) => ({
    x: i === 0 ? 500 : 900,
    y: i === 0 ? 500 : 900,
  }));
  const next = applyBrushMorphToOffsets(layer, verts, 500, 500, 10, -6, 60, 0.6);
  assert.equal(next[0].dx, 10);
  assert.equal(next[0].dy, -6);
  assert.equal(next[1].dx, 0);
  assert.equal(next[1].dy, 0);
});

test('Parameter Keyform Presets: 2point, 3point, and clear update target keyforms accurately', () => {
  const doc = createDefaultPuppetDocument();
  const param = doc.parameters[0];
  const res2 = applyKeyformPresetToParameter(
    param,
    doc.keyforms,
    'deformer',
    'def_head',
    '2point'
  );
  const headKfs2 = res2.keyforms.filter(
    (k) => k.parameterId === param.id && k.targetId === 'def_head'
  );
  assert.equal(headKfs2.length, 2);

  const res3 = applyKeyformPresetToParameter(
    param,
    res2.keyforms,
    'deformer',
    'def_head',
    '3point'
  );
  const headKfs3 = res3.keyforms.filter(
    (k) => k.parameterId === param.id && k.targetId === 'def_head'
  );
  assert.equal(headKfs3.length, 3);

  const resClear = applyKeyformPresetToParameter(
    param,
    res3.keyforms,
    'deformer',
    'def_head',
    'clear'
  );
  const headKfsClear = resClear.keyforms.filter(
    (k) => k.parameterId === param.id && k.targetId === 'def_head'
  );
  assert.equal(headKfsClear.length, 0);
});

test('Keyform Edit: swapKeyformPoints and resetKeyformPoint behave deterministically', () => {
  const doc = createDefaultPuppetDocument();
  const swapped = swapKeyformPoints(doc.keyforms, 'ParamAngleX', -30, 30);
  const leftHead = swapped.find((k) => k.id === 'kf_ax_head_l');
  assert.equal(leftHead?.keyformValue, 30);

  const reset = resetKeyformPoint(swapped, 'ParamAngleX', 30);
  const resetHead = reset.find((k) => k.id === 'kf_ax_head_l');
  assert.equal(resetHead?.dx, 0);
  assert.equal(resetHead?.skewY, 0);
});

test('Animation Clipboard: pasteKeyframesAtFrame inserts sorted keyframes at target frame', () => {
  const next = pasteKeyframesAtFrame(
    {},
    [{ parameterId: 'ParamAngleX', frameOffset: 0, value: 15, easing: 'easeInOut' }],
    42
  );
  assert.equal(next.ParamAngleX.stopwatchEnabled, true);
  assert.equal(next.ParamAngleX.keyframes.length, 1);
  assert.equal(next.ParamAngleX.keyframes[0].frame, 42);
  assert.equal(next.ParamAngleX.keyframes[0].value, 15);
});

test('Cubism Parameter-to-Parameter Physics: moving ParamAngleX drives secondary ParamHairFrontSway', () => {
  const doc = createDefaultPuppetDocument();
  let sim = createInitialPhysicsState(doc.physicsGroups);
  for (let i = 0; i < 20; i++) {
    sim = stepPhysicsSimulation(doc.physicsGroups, sim, {
      dt: 1 / 30,
      time: i / 30,
      paramValues: { ParamAngleX: i < 10 ? 25 : -25, ParamAngleZ: 12 },
      windStrength: 0.4,
      windTurbulence: 0.2,
      strengthMultiplier: 1.0,
    });
  }
  const deltas = computePhysicsOutputDeltas(doc.physicsGroups, sim, 1.0);
  assert.ok(
    Math.abs(deltas.parameters.ParamHairFrontSway ?? 0) > 0.01,
    'Expected ParamHairFrontSway to be driven by physics'
  );
  assert.ok(
    Math.abs(deltas.parameters.ParamTwinTailSway ?? 0) > 0.01,
    'Expected ParamTwinTailSway to be driven by physics'
  );
});

test('AE Shared Cache Manager: tracks RAM/Disk cache and purges cleanly to 0 bytes', () => {
  cacheManager.registerTexture('tex_test_1', 512, 512);
  cacheManager.registerPhysicsFrames(180, 4);
  const before = cacheManager.getStats();
  assert.ok(before.ramBytes > 0);
  assert.ok(before.diskCacheBytes > 0);
  assert.ok(before.cacheFolderPath.includes('RiokaPuppetingTools_Cache'));

  let textureCallbackFired = false;
  const after = cacheManager.purgeAllMemoryAndDiskCache(() => {
    textureCallbackFired = true;
  });
  assert.equal(textureCallbackFired, true);
  assert.equal(after.ramBytes, 0);
  assert.equal(after.diskCacheBytes, 0);
  assert.equal(after.cachedTextures, 0);
  assert.equal(getPreviewResolutionScale('half', 100), 0.5);
  assert.equal(getPreviewResolutionScale('custom', 60), 0.6);
});

test('Use After Effects Composition background: resolves strictly visible below-layers bottom-to-top', () => {
  const base = createInitialComposition();
  const puppetLayer = base.layers[0];
  const backdropLayer = base.layers[1];

  const compWithStack = {
    ...base,
    currentFrame: 30,
    selectedLayerId: puppetLayer.id,
    layers: [
      {
        ...backdropLayer,
        id: 'layer_above_overlay',
        name: 'Top Overlay Solid',
        type: 'solid' as const,
        solidColor: '#ff0000',
      },
      puppetLayer,
      {
        ...backdropLayer,
        id: 'layer_below_mid',
        name: 'Mid Solid Below',
        type: 'solid' as const,
        solidColor: '#224466',
      },
      {
        ...backdropLayer,
        id: 'layer_below_hidden',
        name: 'Hidden Below',
        type: 'solid' as const,
        visible: false,
      },
      {
        ...backdropLayer,
        id: 'layer_below_out_of_range',
        name: 'Out Of Range Below',
        type: 'solid' as const,
        inFrame: 60,
        outFrame: 120,
      },
      backdropLayer,
    ],
  };

  const resolved = getBelowCompositionLayers(compWithStack, puppetLayer.id);
  // Excludes Top Overlay (above), Puppet Solid (self), Hidden, and Out Of Range.
  // Returns bottom-most backdrop first, then Mid Solid Below on top of it.
  assert.deepEqual(
    resolved.map((l) => l.id),
    [backdropLayer.id, 'layer_below_mid']
  );
});

test('Connect to Parameter & Interactive Multi-Keyframe Ops: upsert, copy, move, paste, delete', () => {
  let tracks = upsertKeyframeAtFrame({}, 'ParamAngleX', 10, 12);
  tracks = upsertKeyframeAtFrame(tracks, 'ParamAngleX', 25, -18);
  tracks = upsertKeyframeAtFrame(tracks, 'ParamAngleY', 10, 8);

  const kfAx10 = tracks.ParamAngleX.keyframes.find((k) => k.frame === 10)!;
  const kfAx25 = tracks.ParamAngleX.keyframes.find((k) => k.frame === 25)!;
  const kfAy10 = tracks.ParamAngleY.keyframes.find((k) => k.frame === 10)!;

  const selection = [
    { parameterId: 'ParamAngleX', keyframeId: kfAx10.id },
    { parameterId: 'ParamAngleX', keyframeId: kfAx25.id },
    { parameterId: 'ParamAngleY', keyframeId: kfAy10.id },
  ];

  // Copy preserves relative frame offsets
  const copied = copyMultiKeyframes(tracks, selection);
  assert.equal(copied.length, 3);
  assert.equal(
    copied.find((c) => c.parameterId === 'ParamAngleX' && c.value === 12)?.frameOffset,
    0
  );
  assert.equal(
    copied.find((c) => c.parameterId === 'ParamAngleX' && c.value === -18)?.frameOffset,
    15
  );

  // Move shifts selected keyframes together cleanly
  const moved = moveMultiKeyframes(tracks, selection, 5, 180);
  assert.deepEqual(
    moved.ParamAngleX.keyframes.map((k) => k.frame),
    [15, 30]
  );
  assert.deepEqual(
    moved.ParamAngleY.keyframes.map((k) => k.frame),
    [15]
  );

  // Paste at frame 60 places keyframes at 60 and 75
  const pasted = pasteKeyframesAtFrame(moved, copied, 60, 180);
  assert.deepEqual(
    pasted.ParamAngleX.keyframes.map((k) => k.frame),
    [15, 30, 60, 75]
  );

  // Delete removes only selected keyframes
  const kfAx60 = pasted.ParamAngleX.keyframes.find((k) => k.frame === 60)!;
  const afterDel = deleteMultiKeyframes(pasted, [
    { parameterId: 'ParamAngleX', keyframeId: kfAx60.id },
  ]);
  assert.deepEqual(
    afterDel.ParamAngleX.keyframes.map((k) => k.frame),
    [15, 30, 75]
  );
});

test('Video Background Start Time: formats & parses between Timestamp and Frame modes', () => {
  assert.equal(formatVideoStartTime(2.5, 30, 'timecode'), '00:02.50');
  assert.equal(formatVideoStartTime(2.5, 30, 'frame'), '75f');
  assert.ok(Math.abs(parseVideoStartTime('00:02.50', 30, 'timecode') - 2.5) < 1e-6);
  assert.ok(Math.abs(parseVideoStartTime('75f', 30, 'frame') - 2.5) < 1e-6);
});

test('Lossless RGBA .MOV Muxer & Double MP4 Alpha Matte conversion', () => {
  const rgba = new Uint8Array([
    255, 128, 64, 200, // pixel 0
    10, 20, 30, 0,     // pixel 1 (transparent)
  ]);
  const argb = rgbaToQuickTimeArgb(rgba);
  assert.deepEqual(Array.from(argb), [200, 255, 128, 64, 0, 10, 20, 30]);

  const matte = rgbaToAlphaMattePixels(rgba);
  assert.deepEqual(Array.from(matte), [200, 200, 200, 255, 0, 0, 0, 255]);

  const mov = buildLosslessRgbaMovBytes([rgba, rgba], 2, 1, 30);
  const ascii = Buffer.from(mov).toString('latin1');
  assert.ok(ascii.includes('ftyp'), 'Expected ftyp QuickTime atom');
  assert.ok(ascii.includes('mdat'), 'Expected mdat pixel atom');
  assert.ok(ascii.includes('moov'), 'Expected moov metadata atom');
  assert.ok(ascii.includes('raw '), 'Expected raw 32-bit ARGB codec tag');
});

test('Bone Gizmo: upward arrow rotates left/right and scales up/down around null circle', () => {
  const pivot = { x: 500, y: 400 };
  const neutral = computeBoneGizmoGeometry(pivot, 0, 1, 0);
  assert.ok(Math.abs(neutral.tipX - 500) < 1e-6);
  assert.ok(Math.abs(neutral.tipY - (400 - BONE_ARROW_BASE_LEN)) < 1e-6);

  // Rotating arrow to the right (+90 deg)
  const right = computeBoneTransformFromArrowPointer(
    pivot,
    { x: pivot.x + BONE_ARROW_BASE_LEN, y: pivot.y },
    0
  );
  assert.equal(right.rotation, 90);
  assert.equal(right.scale, 1);

  // Rotating arrow to the left (-90 deg)
  const left = computeBoneTransformFromArrowPointer(
    pivot,
    { x: pivot.x - BONE_ARROW_BASE_LEN, y: pivot.y },
    0
  );
  assert.equal(left.rotation, -90);
  assert.equal(left.scale, 1);

  // Moving arrow upward grows object (> 1.0)
  const grown = computeBoneTransformFromArrowPointer(
    pivot,
    { x: pivot.x, y: pivot.y - BONE_ARROW_BASE_LEN * 1.5 },
    0
  );
  assert.equal(grown.rotation, 0);
  assert.equal(grown.scale, 1.5);

  // Moving arrow downward toward circle shrinks object (< 1.0)
  const shrunk = computeBoneTransformFromArrowPointer(
    pivot,
    { x: pivot.x, y: pivot.y - BONE_ARROW_BASE_LEN * 0.5 },
    0
  );
  assert.equal(shrunk.rotation, 0);
  assert.equal(shrunk.scale, 0.5);

  // Hit-testing separates arrow handle vs null circle
  assert.equal(
    hitTestBoneGizmo({ x: neutral.tipX, y: neutral.tipY }, neutral, 0.6),
    'arrow'
  );
  assert.equal(
    hitTestBoneGizmo({ x: pivot.x, y: pivot.y }, neutral, 0.6),
    'circle'
  );
});

test('Timeline Scrub Sync: syncParametersToFrame updates active tracks and leaves static params intact', () => {
  const doc = createDefaultPuppetDocument();
  const tracks = {
    ParamAngleX: {
      parameterId: 'ParamAngleX',
      stopwatchEnabled: true,
      keyframes: [
        { id: 'k1', frame: 0, value: -20, easing: 'linear' as const },
        { id: 'k2', frame: 40, value: 20, easing: 'linear' as const },
      ],
    },
  };
  const syncedAt20 = syncParametersToFrame(doc.parameters, tracks, 20);
  assert.equal(
    syncedAt20.find((p) => p.id === 'ParamAngleX')?.value,
    0
  );
  const syncedAt40 = syncParametersToFrame(doc.parameters, tracks, 40);
  assert.equal(
    syncedAt40.find((p) => p.id === 'ParamAngleX')?.value,
    20
  );
  // Untracked parameter keeps its original value
  const origSmile = doc.parameters.find((p) => p.id === 'ParamMouthSmile')?.value;
  assert.equal(
    syncedAt40.find((p) => p.id === 'ParamMouthSmile')?.value,
    origSmile
  );
});

test('Parameter Keyform Indicators: blue when parameter has points, gray when empty, and updates on add/delete/clear', () => {
  const doc = createDefaultPuppetDocument();
  const hairFront = doc.layers.find((l) => l.parentDeformerId === 'def_hair_front');
  const mouth = doc.layers.find((l) => l.parentDeformerId === 'def_mouth');
  const angleX = doc.parameters.find((p) => p.id === 'ParamAngleX')!;
  const eyeLOpen = doc.parameters.find((p) => p.id === 'ParamEyeLOpen')!;
  const mouthOpen = doc.parameters.find((p) => p.id === 'ParamMouthOpenY')!;

  assert.ok(hairFront && mouth);

  // Rigged parameters with keyform points are blue (hasAnyKeyform === true) regardless of which layer is selected
  const hairAngleX = getParameterKeyformStatus(doc.keyforms, hairFront, angleX);
  assert.equal(hairAngleX.hasAnyKeyform, true);
  assert.equal(hairAngleX.hasLayerKeyform, true);
  assert.deepEqual(hairAngleX.boundValues, [-30, 0, 30]);
  assert.equal(hairAngleX.displayPoints.every((pt) => pt.isBound), true);

  const eyeStatusWithHairSelected = getParameterKeyformStatus(doc.keyforms, hairFront, eyeLOpen);
  assert.equal(eyeStatusWithHairSelected.hasAnyKeyform, true);
  assert.equal(eyeStatusWithHairSelected.hasLayerKeyform, false);
  assert.deepEqual(eyeStatusWithHairSelected.boundValues, [0, 0.5, 1]);
  assert.equal(eyeStatusWithHairSelected.displayPoints.every((pt) => pt.isBound), true);

  const mouthStatusWithHairSelected = getParameterKeyformStatus(doc.keyforms, hairFront, mouthOpen);
  assert.equal(mouthStatusWithHairSelected.hasAnyKeyform, true);
  assert.deepEqual(mouthStatusWithHairSelected.boundValues, [0, 0.5, 1]);

  // A brand-new custom parameter with no points stays gray (hasAnyKeyform === false)
  const customParam = {
    id: 'ParamCustomEmpty',
    name: 'Custom Empty',
    group: 'Custom' as const,
    folderId: null,
    min: -1,
    max: 1,
    defaultValue: 0,
    value: 0,
    keyforms: [] as number[],
  };
  const emptyStatus = getParameterKeyformStatus(doc.keyforms, hairFront, customParam);
  assert.equal(emptyStatus.hasAnyKeyform, false);
  assert.deepEqual(emptyStatus.boundValues, []);
  assert.deepEqual(emptyStatus.displayPoints, []);

  // Adding a single point to the empty gray parameter immediately turns it blue
  const addedSingle = addKeyformPointToParameter(
    customParam,
    doc.keyforms,
    'deformer',
    'def_hair_front',
    0.25
  );
  const statusAfterAdd = getParameterKeyformStatus(
    addedSingle.keyforms,
    hairFront,
    addedSingle.parameter
  );
  assert.equal(statusAfterAdd.hasAnyKeyform, true);
  assert.deepEqual(statusAfterAdd.boundValues, [0.25]);
  assert.equal(
    statusAfterAdd.displayPoints.find((pt) => Math.abs(pt.value - 0.25) < 1e-3)?.isBound,
    true
  );

  // Deleting that single point removes both its KeyformDelta and marker dot and turns it back to gray
  const afterDeleteSingle = deleteKeyformPointFromParameter(
    addedSingle.parameter,
    addedSingle.keyforms,
    hairFront,
    0.25,
    'parameter'
  );
  const statusAfterDeleteSingle = getParameterKeyformStatus(
    afterDeleteSingle.keyforms,
    hairFront,
    afterDeleteSingle.parameter
  );
  assert.equal(statusAfterDeleteSingle.hasAnyKeyform, false);
  assert.deepEqual(statusAfterDeleteSingle.displayPoints, []);

  // Parameter-scoped Clear turns Eye L Open gray even when Hair Front Bangs is selected
  const clearedEye = applyKeyformPresetToParameter(
    eyeLOpen,
    doc.keyforms,
    'deformer',
    'def_hair_front',
    'clear',
    'parameter'
  );
  const eyeAfterClear = getParameterKeyformStatus(
    clearedEye.keyforms,
    hairFront,
    clearedEye.parameter
  );
  assert.equal(eyeAfterClear.hasAnyKeyform, false);
  assert.deepEqual(eyeAfterClear.displayPoints, []);

  // Applying 2-point preset on cleared Eye L Open turns it blue again with 2 bound points
  const eye2pt = applyKeyformPresetToParameter(
    clearedEye.parameter,
    clearedEye.keyforms,
    'deformer',
    'def_eye_l',
    '2point'
  );
  const statusEye2pt = getParameterKeyformStatus(eye2pt.keyforms, mouth, eye2pt.parameter);
  assert.equal(statusEye2pt.hasAnyKeyform, true);
  assert.deepEqual(
    statusEye2pt.displayPoints.map((pt) => ({ v: pt.value, b: pt.isBound })),
    [
      { v: 0, b: true },
      { v: 1, b: true },
    ]
  );

  // Target-scoped delete on shared ParamAngleX unbinds Hair Front Bangs while keeping Head intact
  const headLayer = doc.layers.find((l) => l.parentDeformerId === 'def_head')!;
  const afterTargetDel = deleteKeyformPointFromParameter(
    angleX,
    doc.keyforms,
    hairFront,
    0,
    'target'
  );
  const hairAfterTargetDel = getParameterKeyformStatus(
    afterTargetDel.keyforms,
    hairFront,
    afterTargetDel.parameter
  );
  const headAfterTargetDel = getParameterKeyformStatus(
    afterTargetDel.keyforms,
    headLayer,
    afterTargetDel.parameter
  );
  assert.equal(
    hairAfterTargetDel.displayPoints.find((pt) => Math.abs(pt.value - 0) < 1e-3)?.isBoundToLayer,
    false
  );
  assert.equal(
    headAfterTargetDel.displayPoints.find((pt) => Math.abs(pt.value - 0) < 1e-3)?.isBoundToLayer,
    true
  );
});

test('Initial Load Clean Timeline: starts at frame 0 with zero animation keyframes while preserving rig keyforms', () => {
  const comp = createInitialComposition();
  assert.equal(comp.currentFrame, 0);

  const effect = createDefaultPuppetEffect();
  const trackList = Object.values(effect.tracks);
  assert.ok(trackList.length > 0);
  for (const track of trackList) {
    assert.equal(track.stopwatchEnabled, false, `Track ${track.parameterId} stopwatch should start off`);
    assert.equal(track.keyframes.length, 0, `Track ${track.parameterId} should start with 0 keyframes`);
  }
  assert.ok(effect.puppet.keyforms.length > 0);
});

test('Offline Standalone Studio & AE Keyframe JSX Export: generates local loopback bridge and runnable ExtendScript', () => {
  const comp = createInitialComposition();
  const eff = comp.layers[0].effect!;
  eff.tracks.ParamAngleX = {
    parameterId: 'ParamAngleX',
    stopwatchEnabled: true,
    keyframes: [
      { id: 'k1', frame: 0, value: -15, easing: 'easeInOut' },
      { id: 'k2', frame: 30, value: 18, easing: 'easeInOut' },
    ],
  };

  const jsx = buildApplyKeyframesJsx(comp, eff);
  assert.ok(jsx.includes('RIOKA_PARAMS'));
  assert.ok(jsx.includes('"frame": 30'));
  assert.ok(jsx.includes('"time": 1'));
  assert.ok(jsx.includes('setValueAtTime'));

  const sdkFiles = buildAeSdkFiles(comp, eff.puppet);
  const studioMain = sdkFiles.find((f) => f.path === 'src/RiokaStudioMain.cpp');
  const applyJsxFile = sdkFiles.find((f) => f.path === 'project/Apply_Keyframes_To_AE.jsx');
  assert.ok(studioMain, 'RiokaStudioMain.cpp should be included in AE SDK bundle');
  assert.ok(studioMain.content.includes('/api/standalone-info'));
  assert.ok(studioMain.content.includes('/api/apply-rig-json'));
  assert.ok(studioMain.content.includes('/api/apply-keyframes-jsx'));
  assert.ok(studioMain.content.includes('INADDR_LOOPBACK'));
  assert.ok(applyJsxFile, 'Apply_Keyframes_To_AE.jsx should be included in AE SDK bundle');
});

test('Parameter Inline Numeric Input: parses dot & comma decimals, clamps to range, and rejects invalid text', () => {
  assert.equal(parseClampedParameterInput('22.5', -30, 30), 22.5);
  assert.equal(parseClampedParameterInput('-12,5', -30, 30), -12.5);
  assert.equal(parseClampedParameterInput('  0,45  ', 0, 1), 0.45);
  assert.equal(parseClampedParameterInput('999', -30, 30), 30);
  assert.equal(parseClampedParameterInput('-999', -30, 30), -30);
  assert.equal(parseClampedParameterInput('', -30, 30), null);
  assert.equal(parseClampedParameterInput('abc', -30, 30), null);
});

test('AE Solid Layer RPF Codec & Live Apply Bridge: encodes KRPF binary frames, params txt, and C++ solid-layer renderer', () => {
  const dims = computeRpfRenderDimensions(1920, 1080, 1280);
  assert.equal(dims.width, 1280);
  assert.equal(dims.height, 720);

  const rgba = new Uint8ClampedArray([
    255, 10, 20, 255,
    0, 128, 255, 128,
    12, 34, 56, 0,
    99, 88, 77, 200,
  ]);
  const rpf = encodeRgbaToRpf(rgba, 2, 2);
  assert.equal(rpf.byteLength, RPF_HEADER_BYTES + 16);

  const hdr = decodeRpfHeader(rpf);
  assert.ok(hdr);
  assert.equal(hdr.magic, RPF_MAGIC);
  assert.equal(hdr.width, 2);
  assert.equal(hdr.height, 2);
  assert.equal(hdr.pixelByteLength, 16);
  assert.equal(rpf[RPF_HEADER_BYTES], 255);
  assert.equal(rpf[RPF_HEADER_BYTES + 7], 128);
  assert.equal(decodeRpfHeader(rpf.subarray(0, 12)), null);

  const comp = createInitialComposition();
  const eff = comp.layers[0].effect!;
  eff.puppet.parameters[0].value = 17.5;
  const paramsTxt = buildAppliedParamsTxt(comp, eff, 24);
  assert.ok(paramsTxt.includes('fps=30'));
  assert.ok(paramsTxt.includes('frameCount=24'));
  assert.ok(paramsTxt.includes('param_1=17.5000'));

  const sdkFiles = buildAeSdkFiles(comp, eff.puppet);
  const pluginCpp = sdkFiles.find((f) => f.path === 'src/RiokasPuppetingTools.cpp');
  const studioCpp = sdkFiles.find((f) => f.path === 'src/RiokaStudioMain.cpp');
  assert.ok(pluginCpp);
  assert.ok(studioCpp);
  assert.ok(pluginCpp.content.includes('LoadRpfImageCached'));
  assert.ok(pluginCpp.content.includes('WritePremulPixel'));
  assert.ok(pluginCpp.content.includes('default_puppet.rpf'));
  assert.ok(pluginCpp.content.includes('RenderFallbackCharacter'));
  assert.ok(pluginCpp.content.includes('LaunchPuppetStudioWindowModal'));
  assert.ok(pluginCpp.content.includes('PF_OutFlag_FORCE_RERENDER | PF_OutFlag_REFRESH_UI'));
  assert.ok(studioCpp.content.includes('/api/apply-frame-rgba'));
  assert.ok(studioCpp.content.includes('/api/apply-params-txt'));
  assert.ok(studioCpp.content.includes('/api/clear-anim-frames'));
  assert.ok(studioCpp.content.includes('/api/apply-anim-frame'));
  assert.ok(studioCpp.content.includes('/api/close-studio'));
  assert.ok(studioCpp.content.includes('WriteFileAtomic'));
});
